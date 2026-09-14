import { isValidSignupPassword } from '../../../password-policy.js';
import { hashVerificationProof } from '../../../server/email-verification.js';

// Workers' reported native PBKDF2 cap is 100,000, below OWASP's 600,000
// SHA-256 recommendation. Revisit when the runtime limit changes:
// https://github.com/cloudflare/workerd/issues/1346
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const FIELD_LIMITS = { email: 254, password: 128, name: 50, companyName: 100, departmentName: 100, position: 50 };
const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

function json(body, status, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function failure(error, status, field) {
  return json(field ? { ok: false, error, field } : { ok: false, error }, status);
}

function toHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, HASH_BITS);
  // v1: UTF-8 password without normalization, lowercase hex salt and 32-byte hash.
  return `v1$pbkdf2_sha256$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(new Uint8Array(bits))}`;
}

function isDuplicateEmail(error) {
  // Match only users.email, not other UNIQUE failures such as a user ID collision.
  return [error?.message, error?.cause?.message].some(message =>
    typeof message === 'string' && /UNIQUE constraint failed:\s*users\.email(?:\s|:|$)/i.test(message));
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
  }

  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== new URL(request.url).origin) {
    return failure('ORIGIN_NOT_ALLOWED', 403);
  }

  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return failure('INVALID_CONTENT_TYPE', 400);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return failure('INVALID_JSON', 400);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return failure('INVALID_INPUT', 400);
  }

  const values = {};
  for (const [field, maxLength] of Object.entries(FIELD_LIMITS)) {
    if (field === 'password') {
      if (!isValidSignupPassword(input.password)) return failure('INVALID_PASSWORD', 400, 'password');
      values.password = input.password;
      continue;
    }
    if (typeof input[field] !== 'string' || !input[field].trim()) {
      return failure('INVALID_INPUT', 400, field);
    }
    const value = field === 'password' ? input[field] : input[field].trim();
    const length = Array.from(value).length;
    if (length > maxLength) {
      return failure('INVALID_INPUT', 400, field);
    }
    values[field] = value;
  }
  values.email = values.email.toLowerCase();
  const localPart = values.email.split('@')[0];
  if (!EMAIL_PATTERN.test(values.email) || localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
    return failure('INVALID_INPUT', 400, 'email');
  }

  try {
    const db = context.env?.DB;
    if (!db) return failure('INTERNAL_SERVER_ERROR', 500);

    const existing = await db.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').bind(values.email).first();
    if (existing) return failure('EMAIL_ALREADY_EXISTS', 409);

    const proofHash = await hashVerificationProof(input.emailVerificationProof);
    if (!proofHash) return failure('EMAIL_VERIFICATION_REQUIRED', 400);
    // Reject invalid proof before expensive password hashing; the batch rechecks for races.
    const verified = await db.prepare(`SELECT id FROM email_verifications
      WHERE email = ? AND proof_hash = ? AND verified_at IS NOT NULL
        AND consumed_at IS NULL AND proof_expires_at > ?
        AND sequence = (SELECT MAX(sequence) FROM email_verifications WHERE email = ?)`
    ).bind(values.email, proofHash, Date.now(), values.email).first();
    if (!verified) return failure('EMAIL_VERIFICATION_REQUIRED', 400);

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(values.password);
    try {
      const now = Date.now();
      // D1 batch is transactional: account creation and proof consumption succeed together.
      const [result, consumed] = await db.batch([
        db.prepare(`INSERT INTO users (id, email, password_hash, name, company_name, department_name, position)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
            SELECT 1 FROM email_verifications WHERE email = ? AND proof_hash = ?
              AND verified_at IS NOT NULL AND consumed_at IS NULL AND proof_expires_at > ?
              AND sequence = (SELECT MAX(sequence) FROM email_verifications WHERE email = ?)
          )`).bind(id, values.email, passwordHash, values.name, values.companyName, values.departmentName, values.position, values.email, proofHash, now, values.email),
        db.prepare(`UPDATE email_verifications SET consumed_at = ?
          WHERE email = ? AND proof_hash = ? AND consumed_at IS NULL
            AND EXISTS (SELECT 1 FROM users WHERE id = ? AND email = ?)`
        ).bind(now, values.email, proofHash, id, values.email)
      ]);
      if (!result.success || !consumed.success) return failure('INTERNAL_SERVER_ERROR', 500);
      if (result.meta?.changes !== 1) return failure('EMAIL_VERIFICATION_REQUIRED', 400);
      if (consumed.meta?.changes !== 1) return failure('INTERNAL_SERVER_ERROR', 500);
    } catch (error) {
      if (isDuplicateEmail(error)) return failure('EMAIL_ALREADY_EXISTS', 409);
      return failure('INTERNAL_SERVER_ERROR', 500);
    }

    return json({
      ok: true,
      user: { id, email: values.email, name: values.name, companyName: values.companyName, departmentName: values.departmentName, position: values.position }
    }, 201);
  } catch {
    return failure('INTERNAL_SERVER_ERROR', 500);
  }
}
