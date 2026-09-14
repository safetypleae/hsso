const CODE_TTL = 10 * 60 * 1000;
const PROOF_TTL = 10 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const fail = (error, status = 400) => json({ ok: false, error }, status);

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  const local = email.split('@')[0];
  return email.length <= 254 && EMAIL_PATTERN.test(email) && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') ? email : null;
}

function secretReady(env) {
  return typeof env?.EMAIL_VERIFICATION_SECRET === 'string' && env.EMAIL_VERIFICATION_SECRET.trim().length >= 32;
}

async function hmacKey(env) {
  if (!secretReady(env)) throw new Error('Email verification unavailable');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.EMAIL_VERIFICATION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function mac(env, value) {
  return hex(await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(value)));
}

export async function hashVerificationProof(proof) {
  if (typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)) return null;
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof)));
}

function generateCode() {
  // Rejection sampling avoids modulo bias; includes leading zeroes.
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= 4294000000);
  return String(value[0] % 1000000).padStart(6, '0');
}

// Dependency injection is only a server-side function argument, never a request/env switch.
export async function sendVerificationEmail(env, { email, code, id }, fetcher = fetch) {
  const response = await fetcher('https://api.resend.com/emails', {
    // Workers supports manual redirects; the non-2xx check rejects redirects without following them.
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `signup/${id}` },
    body: JSON.stringify({
      from: env.EMAIL_FROM, to: [email], subject: 'HSSO 회원가입 이메일 인증',
      text: `HSSO 회원가입 이메일 인증\n\n인증번호: ${code}\n\n인증번호는 10분 동안 유효합니다.\n본인이 요청하지 않았다면 이 메일을 무시해주세요.`,
      html: `<h1>HSSO 회원가입 이메일 인증</h1><p>인증번호</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px">${code}</p><p>인증번호는 10분 동안 유효합니다.</p><p>본인이 요청하지 않았다면 이 메일을 무시해주세요.</p>`
    })
  });
  if (!response.ok) throw new Error('Email delivery unavailable');
  const result = await response.json();
  if (typeof result?.id !== 'string' || !result.id) throw new Error('Email delivery unavailable');
}

async function parse(context) {
  const { request } = context;
  if (request.method !== 'POST') return { response: json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' }) };
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== new URL(request.url).origin) return { response: fail('ORIGIN_NOT_ALLOWED', 403) };
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return { response: fail('INVALID_CONTENT_TYPE') };
  let input;
  try { input = await request.json(); } catch { return { response: fail('INVALID_JSON') }; }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { response: fail('INVALID_INPUT') };
  const email = normalizeEmail(input.email);
  if (!email) return { response: fail('INVALID_EMAIL') };
  return { input, email };
}

async function rateLimitResponse(db, email, ipMac, now) {
  const recent = await db.prepare(`SELECT
    (SELECT MAX(resend_available_at) FROM email_verifications WHERE email = ?) AS resend,
    (SELECT COUNT(*) FROM email_verifications WHERE email = ? AND created_at > ?) AS email_count,
    (SELECT MIN(created_at) FROM email_verifications WHERE email = ? AND created_at > ?) AS email_first,
    (SELECT COUNT(*) FROM email_verifications WHERE ip_mac = ? AND created_at > ?) AS ip_count,
    (SELECT MIN(created_at) FROM email_verifications WHERE ip_mac = ? AND created_at > ?) AS ip_first`
  ).bind(email, email, now - HOUR, email, now - HOUR, ipMac, now - HOUR, ipMac, now - HOUR).first();
  const emailLimited = recent.email_count >= 5;
  const ipLimited = recent.ip_count >= 20;
  const until = Math.max(now + 1000, recent.resend || 0, emailLimited ? recent.email_first + HOUR : 0, ipLimited ? recent.ip_first + HOUR : 0);
  const retryAfter = Math.ceil((until - now) / 1000);
  return json({ ok: false, error: emailLimited ? 'EMAIL_RATE_LIMITED' : ipLimited ? 'IP_RATE_LIMITED' : 'RESEND_TOO_SOON', retryAfter }, 429, { 'Retry-After': String(retryAfter) });
}

export async function requestEmailCode(context, sendEmail = sendVerificationEmail) {
  const parsed = await parse(context);
  if (parsed.response) return parsed.response;
  const { email } = parsed;
  const env = context.env;
  if (!env?.DB || !secretReady(env) || typeof env.RESEND_API_KEY !== 'string' || !env.RESEND_API_KEY.trim() || typeof env.EMAIL_FROM !== 'string' || !env.EMAIL_FROM.trim()) return fail('EMAIL_SERVICE_UNAVAILABLE', 503);
  try {
    const db = env.DB;
    if (await db.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').bind(email).first()) return fail('EMAIL_ALREADY_EXISTS', 409);
    const now = Date.now();
    const id = crypto.randomUUID();
    const code = generateCode();
    // Trust only Cloudflare's edge-provided header. Missing IPs share one limited bucket.
    const ipMac = await mac(env, JSON.stringify(['ip', context.request.headers.get('CF-Connecting-IP') || 'unknown']));
    const codeMac = await mac(env, JSON.stringify(['code', id, email, code]));
    // Retain at most 24h of inactive verification history (cleanup on send traffic).
    await db.prepare('DELETE FROM email_verifications WHERE created_at < ?').bind(now - 24 * HOUR).run();
    // Reservation and all rolling limits are checked in ONE atomic write, before sending.
    const result = await db.prepare(`INSERT INTO email_verifications
      (id, email, ip_mac, code_mac, created_at, expires_at, resend_available_at)
      SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ?)
        AND NOT EXISTS (SELECT 1 FROM email_verifications WHERE email = ? AND resend_available_at > ?)
        AND (SELECT COUNT(*) FROM email_verifications WHERE email = ? AND created_at > ?) < 5
        AND (SELECT COUNT(*) FROM email_verifications WHERE ip_mac = ? AND created_at > ?) < 20`
    ).bind(id, email, ipMac, codeMac, now, now + CODE_TTL, now + 60000, email, email, now, email, now - HOUR, ipMac, now - HOUR).run();
    if (!result.success) throw new Error('Reservation failed');
    if (result.meta?.changes !== 1) {
      if (await db.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').bind(email).first()) return fail('EMAIL_ALREADY_EXISTS', 409);
      return await rateLimitResponse(db, email, ipMac, Date.now());
    }
    try { await sendEmail(env, { email, code, id }); }
    catch { return json({ ok: false, error: 'EMAIL_SEND_FAILED', retryAfter: 60 }, 503, { 'Retry-After': '60' }); }
    // Failed/uncertain delivery never enables verification and still counts against quotas.
    const delivered = await db.prepare('UPDATE email_verifications SET delivered_at = ? WHERE id = ?').bind(Date.now(), id).run();
    if (!delivered.success || delivered.meta?.changes !== 1) throw new Error('Delivery update failed');
    return json({ ok: true, requestId: id, expiresAt: now + CODE_TTL, resendAvailableAt: now + 60000, serverTime: Date.now() });
  } catch { return fail('INTERNAL_SERVER_ERROR', 500); }
}

export async function verifyEmailCode(context) {
  const parsed = await parse(context);
  if (parsed.response) return parsed.response;
  const { input, email } = parsed;
  if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId) || typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) return fail('INVALID_CODE');
  if (!context.env?.DB || !secretReady(context.env)) return fail('EMAIL_SERVICE_UNAVAILABLE', 503);
  try {
    const db = context.env.DB;
    const row = await db.prepare('SELECT * FROM email_verifications WHERE id = ? AND email = ?').bind(input.requestId, email).first();
    if (!row || row.delivered_at === null || row.verified_at !== null || row.consumed_at !== null) return fail('CODE_UNAVAILABLE');
    if (row.attempts >= 5) return fail('CODE_ATTEMPTS_EXCEEDED');
    if (row.expires_at <= Date.now()) return fail('CODE_EXPIRED');
    const signature = Uint8Array.from(row.code_mac.match(/.{2}/g), byte => parseInt(byte, 16));
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(context.env), signature, new TextEncoder().encode(JSON.stringify(['code', row.id, email, input.code])));
    const proof = valid ? hex(crypto.getRandomValues(new Uint8Array(32))) : null;
    const proofHash = valid ? await hashVerificationProof(proof) : null;
    const now = Date.now();
    // Conditional write prevents parallel attempts, code replay and older resends winning.
    const updated = await db.prepare(`UPDATE email_verifications SET
      attempts = attempts + ?, verified_at = ?, proof_hash = ?, proof_expires_at = ?
      WHERE id = ? AND email = ? AND delivered_at IS NOT NULL AND verified_at IS NULL
        AND consumed_at IS NULL AND attempts < 5 AND expires_at > ?
        AND sequence = (SELECT MAX(sequence) FROM email_verifications WHERE email = ?)
      RETURNING attempts, verified_at`
    ).bind(valid ? 0 : 1, valid ? now : null, proofHash, valid ? now + PROOF_TTL : null, row.id, email, now, email).first();
    if (!updated) return fail('CODE_UNAVAILABLE');
    if (!valid) return json({ ok: false, error: updated.attempts >= 5 ? 'CODE_ATTEMPTS_EXCEEDED' : 'INVALID_CODE', attemptsRemaining: 5 - updated.attempts }, 400);
    return json({ ok: true, proof, proofExpiresAt: now + PROOF_TTL, serverTime: now });
  } catch { return fail('INTERNAL_SERVER_ERROR', 500); }
}
