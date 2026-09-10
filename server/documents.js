import { json, errorResponse, readSessionToken, hashToken } from './auth-session.js';

export const MAX_BODY_BYTES = 131072;
const DAY = 86400000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length <= 30000;
const codes = (value, pattern) => Array.isArray(value) && value.length <= 9 && value.every(code => typeof code === 'string' && pattern.test(code));
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const strings = (value, keys) => exact(value, keys) && keys.every(key => text(value[key]));

// Validate the existing preview shapes without normalizing or rewriting safety text.
export function validDocument(type, data) {
  if (!object(data) || !text(data.productName) || !data.productName.trim()) return false;
  if (type === 'warning_label') return exact(data, ['productName','ghsCodes','signalWord','hazardStatements','precautions','supplierName','supplierPhone'])
    && ['signalWord','hazardStatements','supplierName','supplierPhone'].every(key => text(data[key]))
    && codes(data.ghsCodes, /^GHS0[1-9]$/) && Array.isArray(data.precautions) && data.precautions.length <= 4
    && data.precautions.every(group => exact(group, ['category','statements']) && ['예방','대응','저장','폐기'].includes(group.category)
      && Array.isArray(group.statements) && group.statements.length <= 300 && group.statements.every(text));
  if (type === 'process_guide') return exact(data, ['productName','signalWord','ghs','hazardStatements','handling','firstAid','accidentResponse','selectedPpe','ppeNone'])
    && text(data.signalWord) && text(data.hazardStatements) && codes(data.ghs, /^GHS0[1-9]$/)
    && strings(data.handling, ['safeHandling']) && strings(data.firstAid, ['eye','skin','inhalation','ingestion'])
    && strings(data.accidentResponse, ['fire','spill']) && codes(data.selectedPpe, /^30[1-9]$/) && typeof data.ppeNone === 'boolean'
    && (!data.ppeNone || data.selectedPpe.length === 0);
  return false;
}

export async function authenticate(request, env) {
  const token = readSessionToken(request);
  if (!token) return null;
  const user = await env.DB.prepare('SELECT u.id, s.expires_at FROM sessions s INNER JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? LIMIT 1').bind(await hashToken(token)).first();
  return user && Date.parse(user.expires_at) > Date.now() ? user.id : null;
}

export function guard(request, methods) {
  if (!methods.includes(request.method)) return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: methods.join(', ') });
  const origin = request.headers.get('Origin');
  if (['POST','DELETE'].includes(request.method) && origin !== null && origin !== new URL(request.url).origin) return errorResponse('ORIGIN_NOT_ALLOWED', 403);
}

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INVALID_JSON');
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('PAYLOAD_TOO_LARGE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('INVALID_JSON'); }
}

export async function collection({ request, env }) {
  const rejected = guard(request, ['GET','POST']); if (rejected) return rejected;
  try {
    const owner = await authenticate(request, env);
    if (!owner) return errorResponse('UNAUTHENTICATED', 401);
    const now = new Date(); const timestamp = now.toISOString();
    if (request.method === 'POST') {
      if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return errorResponse('INVALID_CONTENT_TYPE', 400);
      let input;
      try { input = await readBody(request); } catch (error) { return errorResponse(error.message === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON', error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400); }
      if (!object(input) || !text(input.title) || !input.title.trim() || input.title.trim().length > 200 || !validDocument(input.documentType, input.documentData)) return errorResponse('INVALID_DOCUMENT', 400);
      const id = crypto.randomUUID(); const expiry = new Date(now.getTime() + 90 * DAY).toISOString();
      const result = await env.DB.prepare('INSERT INTO saved_documents (id,user_id,document_type,title,search_text,document_data,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(id, owner, input.documentType, input.title.trim(), input.documentData.productName, JSON.stringify(input.documentData), timestamp, expiry).run();
      if (!result.success || result.meta?.changes !== 1) throw new Error('Storage failed');
      return json({ ok: true, document: { id, documentType: input.documentType, title: input.title.trim(), createdAt: timestamp, expiresAt: expiry } }, 201);
    }
    const params = new URL(request.url).searchParams;
    const type = params.get('type') || ''; const period = params.get('period') || '90'; const q = (params.get('q') || '').trim();
    if (!['','warning_label','process_guide'].includes(type) || !['today','7','30','90'].includes(period) || q.length > 200) return errorResponse('INVALID_FILTER', 400);
    const rawLimit = params.get('limit') || '20'; const rawOffset = params.get('offset') || '0';
    if (!/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset) || Number(rawLimit) < 1 || !Number.isSafeInteger(Number(rawOffset))) return errorResponse('INVALID_FILTER', 400);
    const limit = Math.min(Number(rawLimit), 50); const offset = Number(rawOffset);
    // Today is the Korean calendar day; all stored timestamps remain UTC ISO strings.
    const start = period === 'today' ? new Date(Math.floor((now.getTime() + 9 * 3600000) / DAY) * DAY - 9 * 3600000).toISOString() : new Date(now.getTime() - Number(period) * DAY).toISOString();
    const pattern = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    const rows = await env.DB.prepare("SELECT id,document_type AS documentType,title,created_at AS createdAt,expires_at AS expiresAt FROM saved_documents WHERE user_id = ? AND expires_at > ? AND created_at >= ? AND (? = '' OR document_type = ?) AND (title LIKE ? ESCAPE '\\' OR search_text LIKE ? ESCAPE '\\') ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?")
      .bind(owner, timestamp, start, type, type, pattern, pattern, limit + 1, offset).all();
    const summary = await env.DB.prepare("SELECT COUNT(CASE WHEN document_type = 'warning_label' THEN 1 END) AS warning_label, COUNT(CASE WHEN document_type = 'process_guide' THEN 1 END) AS process_guide FROM saved_documents WHERE user_id = ? AND expires_at > ? AND created_at >= ?")
      .bind(owner, timestamp, new Date(now.getTime() - 90 * DAY).toISOString()).first();
    return json({ ok: true, documents: rows.results.slice(0, limit), hasMore: rows.results.length > limit, limit, offset, summary, serverNow: timestamp });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function item({ request, env, params }) {
  const rejected = guard(request, ['GET','DELETE']); if (rejected) return rejected;
  try {
    const owner = await authenticate(request, env);
    if (!owner) return errorResponse('UNAUTHENTICATED', 401);
    if (typeof params.id !== 'string' || !/^[a-f0-9-]{36}$/.test(params.id)) return errorResponse('NOT_FOUND', 404);
    const now = new Date().toISOString();
    if (request.method === 'DELETE') {
      const result = await env.DB.prepare('DELETE FROM saved_documents WHERE id = ? AND user_id = ? AND expires_at > ?').bind(params.id, owner, now).run();
      if (!result.success) throw new Error('Delete failed');
      return result.meta?.changes === 1 ? json({ ok: true }) : errorResponse('NOT_FOUND', 404);
    }
    const row = await env.DB.prepare('SELECT id,document_type AS documentType,title,document_data AS documentData,created_at AS createdAt,expires_at AS expiresAt FROM saved_documents WHERE id = ? AND user_id = ? AND expires_at > ?').bind(params.id, owner, now).first();
    if (!row) return errorResponse('NOT_FOUND', 404);
    row.documentData = JSON.parse(row.documentData);
    return json({ ok: true, document: row });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}
