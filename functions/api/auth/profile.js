import { json, errorResponse, guardRequest, readSessionToken, hashToken, publicUser } from '../../../server/auth-session.js';
import { authenticate } from '../../../server/documents.js';

export async function onRequest({ request, env }) {
  const rejected = guardRequest(request, 'POST');
  if (rejected) return rejected;
  try {
    if (!env?.DB) return errorResponse('INTERNAL_SERVER_ERROR', 500);
    const userId = await authenticate(request, env);
    if (!userId) return errorResponse('UNAUTHENTICATED', 401);
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return errorResponse('INVALID_CONTENT_TYPE', 400);
    let input;
    try {
      const reader = request.body?.getReader();
      if (!reader) return errorResponse('INVALID_JSON', 400);
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096) { await reader.cancel(); return errorResponse('INVALID_INPUT', 400); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      input = JSON.parse(new TextDecoder().decode(bytes));
    } catch { return errorResponse('INVALID_JSON', 400); }
    // Reject identity/role/email/password overrides rather than trusting a body ID.
    if (!input || Array.isArray(input) || Object.keys(input).length !== 1 || typeof input.name !== 'string') return errorResponse('INVALID_INPUT', 400);
    const name = input.name.trim();
    if (!name || Array.from(name).length > 50) return errorResponse('INVALID_NAME', 400);
    const user = await env.DB.prepare(`UPDATE users SET name = ?, updated_at = ?
      WHERE id = ? AND EXISTS (
        SELECT 1 FROM sessions WHERE user_id = users.id AND token_hash = ?
          AND julianday(expires_at) > julianday('now')
      ) RETURNING id, email, name, company_name, department_name, position`)
      .bind(name, new Date().toISOString(), userId, await hashToken(readSessionToken(request))).first();
    if (!user) return errorResponse('UNAUTHENTICATED', 401);
    return json({ ok: true, user: publicUser(user) });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}
