export async function onRequest(context) {
  const json = (body, status = 200, headers = {}) => Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers }
  });

  if (context.request.method !== 'GET') {
    return json({ ok: false, error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }

  const db = context.env?.DB;
  if (!db) {
    return json({ ok: false, error: 'database_unavailable' }, 503);
  }

  try {
    const result = await db.prepare('SELECT 1 AS ok').first();
    if (result?.ok !== 1) {
      return json({ ok: false, error: 'database_check_failed' }, 500);
    }

    return json({ ok: true, database: 'connected' });
  } catch {
    return json({ ok: false, error: 'database_check_failed' }, 500);
  }
}
