import { authenticate } from './documents.js';
import { errorResponse } from './auth-session.js';

// The caller supplies only a user ID resolved from a validated server session.
// Missing roles are ordinary users; database failures propagate and never grant access.
export async function userRole(env, userId) {
  const row = await env.DB.prepare('SELECT role FROM user_roles WHERE user_id = ?').bind(userId).first();
  return row?.role === 'admin' ? 'admin' : 'user';
}

export async function requireAdmin(request, env) {
  try {
    const userId = await authenticate(request, env);
    if (!userId) return { response: errorResponse('UNAUTHENTICATED', 401) };
    if (await userRole(env, userId) !== 'admin') return { response: errorResponse('ADMIN_REQUIRED', 403) };
    return { userId };
  } catch {
    return { response: errorResponse('INTERNAL_SERVER_ERROR', 500) };
  }
}
