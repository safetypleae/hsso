import { json, errorResponse, guardRequest, readSessionToken, hashToken, publicUser } from '../../../server/auth-session.js';
import { authenticate } from '../../../server/documents.js';

// Match the existing signup limits and required profile fields.
const PROFILE_LIMITS = { name: 50, companyName: 100, departmentName: 100, position: 50 };

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
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 4 ||
      Object.keys(input).some(key => !Object.hasOwn(PROFILE_LIMITS, key))) return errorResponse('INVALID_INPUT', 400);
    const values = {};
    for (const [key, max] of Object.entries(PROFILE_LIMITS)) {
      if (typeof input[key] !== 'string') return errorResponse('INVALID_INPUT', 400);
      values[key] = input[key].trim();
      if (!values[key] || Array.from(values[key]).length > max) return errorResponse(key === 'name' ? 'INVALID_NAME' : 'INVALID_INPUT', 400);
    }
    const user = await env.DB.prepare(`UPDATE users SET name = ?, company_name = ?, department_name = ?, position = ?, updated_at = ?
      WHERE id = ? AND EXISTS (
        SELECT 1 FROM sessions WHERE user_id = users.id AND token_hash = ?
          AND julianday(expires_at) > julianday('now')
      ) RETURNING id, email, name, company_name, department_name, position`)
      .bind(values.name, values.companyName, values.departmentName, values.position, new Date().toISOString(), userId, await hashToken(readSessionToken(request))).first();
    if (!user) return errorResponse('UNAUTHENTICATED', 401);
    return json({ ok: true, user: publicUser(user) });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}
