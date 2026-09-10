import { json, errorResponse, guardRequest, readSessionToken, hashToken, clearSessionCookie } from '../../../server/auth-session.js';

export async function onRequest({ request, env }) {
  const rejected = guardRequest(request, 'POST');
  if (rejected) return rejected;
  try {
    const token = readSessionToken(request);
    if (token) {
      if (!env?.DB) return errorResponse('INTERNAL_SERVER_ERROR', 500);
      const result = await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hashToken(token)).run();
      if (!result.success) return errorResponse('INTERNAL_SERVER_ERROR', 500);
    }
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  } catch {
    return errorResponse('INTERNAL_SERVER_ERROR', 500);
  }
}
