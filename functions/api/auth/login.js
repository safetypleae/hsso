import { SESSION_SECONDS, json, errorResponse, guardRequest, verifyPassword, hex, hashToken, sessionCookie, publicUser } from '../../../server/auth-session.js';

export async function onRequest({ request, env }) {
  const rejected = guardRequest(request, 'POST');
  if (rejected) return rejected;
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return errorResponse('INVALID_CONTENT_TYPE', 400);
  }
  let input;
  try {
    input = await request.json();
  } catch {
    return errorResponse('INVALID_JSON', 400);
  }
  if (!input || typeof input.email !== 'string' || typeof input.password !== 'string') {
    return errorResponse('INVALID_CREDENTIALS', 401);
  }
  const email = input.email.trim().toLowerCase();
  const password = input.password; // Preserve all whitespace, exactly as signup does.
  if (!email || Array.from(email).length > 254 || !password.trim() || Array.from(password).length < 8 || Array.from(password).length > 128) {
    return errorResponse('INVALID_CREDENTIALS', 401);
  }
  try {
    if (!env?.DB) return errorResponse('INTERNAL_SERVER_ERROR', 500);
    const user = await env.DB.prepare('SELECT id, email, password_hash, name, company_name, department_name, position FROM users WHERE email = ? LIMIT 1').bind(email).first();
    const valid = await verifyPassword(password, user?.password_hash);
    if (!user || !valid) return errorResponse('INVALID_CREDENTIALS', 401);

    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
    const result = await env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), user.id, tokenHash, expiresAt).run();
    if (!result.success || result.meta?.changes !== 1) return errorResponse('INTERNAL_SERVER_ERROR', 500);
    return json({ ok: true, user: publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(token, expiresAt) });
  } catch {
    return errorResponse('INTERNAL_SERVER_ERROR', 500);
  }
}
