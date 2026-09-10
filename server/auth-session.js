// Shared by the session endpoints only; signup's existing hash implementation is unchanged.
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_COOKIE = 'hsso_session';
const PASSWORD_ITERATIONS = 100_000;

export function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export function errorResponse(error, status) {
  return json({ ok: false, error }, status);
}

export function guardRequest(request, method) {
  if (request.method !== method) return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: method });
  const origin = request.headers.get('Origin');
  if (method === 'POST' && origin !== null && origin !== new URL(request.url).origin) {
    return errorResponse('ORIGIN_NOT_ALLOWED', 403);
  }
  return null;
}

export function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value) {
  return Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
}

async function equalHash(actual, expected) {
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(actual, expected);
  }
  // Portable Web Crypto fallback (e.g. local Node tests): use the native HMAC verifier,
  // not an early-exit string/array comparison or a claimed constant-time JavaScript loop.
  const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', key, expected);
  return crypto.subtle.verify('HMAC', key, signature, actual);
}

export async function verifyPassword(password, encoded) {
  const match = typeof encoded === 'string' && /^v1\$pbkdf2_sha256\$([0-9]+)\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded);
  const supported = Boolean(match && match[1] === String(PASSWORD_ITERATIONS));
  // Missing users and unsupported hashes still perform the same PBKDF2 work.
  const salt = supported ? fromHex(match[2]) : new Uint8Array(16);
  const expected = supported ? fromHex(match[3]) : new Uint8Array(32);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const actual = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS }, key, 256);
  const matches = await equalHash(actual, expected);
  return supported && matches;
}

export function readSessionToken(request) {
  const entries = (request.headers.get('Cookie') || '').split(';').map(part => part.trim());
  const matches = entries.filter(part => part.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(SESSION_COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export async function hashToken(token) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
}

export function sessionCookie(token, expiresAt) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}; Expires=${new Date(expiresAt).toUTCString()}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, companyName: user.company_name, departmentName: user.department_name, position: user.position };
}
