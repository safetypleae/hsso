import { json, errorResponse, guardRequest, readSessionToken, hashToken, publicUser } from '../../../server/auth-session.js';

export async function onRequest({ request, env }) {
  const rejected = guardRequest(request, 'GET');
  if (rejected) return rejected;
  const token = readSessionToken(request);
  if (!token) return errorResponse('UNAUTHENTICATED', 401);
  try {
    if (!env?.DB) return errorResponse('INTERNAL_SERVER_ERROR', 500);
    const now = new Date().toISOString();
    const user = await env.DB.prepare(
      'SELECT u.id, u.email, u.name, u.company_name, u.department_name, u.position, s.expires_at AS session_expires_at FROM sessions s INNER JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND julianday(s.expires_at) > julianday(?) LIMIT 1'
    ).bind(await hashToken(token), now).first();
    if (!user || !(Date.parse(user.session_expires_at) > Date.now())) return errorResponse('UNAUTHENTICATED', 401);
    return json({ ok: true, user: publicUser(user) });
  } catch {
    return errorResponse('INTERNAL_SERVER_ERROR', 500);
  }
}
