import { authenticate } from './documents.js';
import { errorResponse, json } from './auth-session.js';
import { extensionsAvailable } from './risk-model.js';
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS = 3;

export async function readMultipart(request) {
  const reader = request.body?.getReader(), chunks = []; let size = 0;
  if (!reader) throw new Error('INVALID_JSON');
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_PHOTOS * MAX_PHOTO_BYTES + 131072) { await reader.cancel(); throw new Error('PAYLOAD_TOO_LARGE'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('Content-Type') } }).formData();
  if ([...form.keys()].some(k => !['payload','photos'].includes(k)) || form.getAll('payload').length !== 1 || typeof form.get('payload') !== 'string' || form.get('payload').length > 65536) throw new Error('INVALID_RESPONSE');
  const files = form.getAll('photos'); if (files.length > MAX_PHOTOS) throw new Error('TOO_MANY_PHOTOS');
  return { input: JSON.parse(form.get('payload')), files };
}
export async function validatePhotos(files) {
  const result = [];
  for (const file of files) {
    if (!file || typeof file.arrayBuffer !== 'function' || file.size > MAX_PHOTO_BYTES || file.size < 24) throw new Error('INVALID_PHOTO');
    const bytes = new Uint8Array(await file.arrayBuffer()), view = new DataView(bytes.buffer);
    let type, width, height;
    if (bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10' && String.fromCharCode(...bytes.slice(12,16)) === 'IHDR' && String.fromCharCode(...bytes.slice(-8,-4)) === 'IEND') {
      type = 'image/png'; width = view.getUint32(16); height = view.getUint32(20);
    } else if (bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
      type = 'image/jpeg'; let offset = 2;
      while (offset + 8 < bytes.length && bytes[offset] === 255) {
        const marker = bytes[offset + 1]; if (marker === 218) break;
        const length = view.getUint16(offset + 2); if (length < 2 || offset + 2 + length > bytes.length) break;
        if ([192,193,194].includes(marker)) { height = view.getUint16(offset + 5); width = view.getUint16(offset + 7); break; }
        offset += 2 + length;
      }
    }
    if (!type || type !== file.type || !width || !height || width * height > 40000000) throw new Error('INVALID_PHOTO');
    result.push({ bytes, type, size: bytes.length });
  }
  return result;
}
export async function uploadPhotos(env, surveyId, responseId, files) {
  if (!files.length) return [];
  if (!env.RISK_PHOTOS || !await extensionsAvailable(env)) throw new Error('PHOTO_STORAGE_UNAVAILABLE');
  const photos = await validatePhotos(files), uploaded = [];
  try {
    for (const photo of photos) {
      const id = crypto.randomUUID(), key = `risk/${surveyId}/${responseId}/${id}`;
      // Queue first, so an interrupted request cannot leave an untracked object forever.
      await env.DB.prepare('INSERT INTO risk_photo_deletions (object_key,ready_after) VALUES (?,?)').bind(key, new Date(Date.now() + 86400000).toISOString()).run();
      uploaded.push({ id, key, type: photo.type, size: photo.size });
      await env.RISK_PHOTOS.put(key, photo.bytes, { httpMetadata: { contentType: photo.type }, customMetadata: { surveyId, responseId } });
    }
    return uploaded;
  } catch (error) { await discardPhotos(env, uploaded); throw error; }
}
export async function discardPhotos(env, photos) {
  for (const photo of photos) { try { await env.RISK_PHOTOS.delete(photo.key); await env.DB.prepare('DELETE FROM risk_photo_deletions WHERE object_key=?').bind(photo.key).run(); } catch { /* Retained for scheduled cleanup. */ } }
}
export function photoStatements(env, surveyId, responseId, photos) {
  return photos.flatMap(p => [
    env.DB.prepare('INSERT INTO risk_response_photos (id,survey_id,response_id,object_key,content_type,size_bytes,created_at) VALUES (?,?,?,?,?,?,?)').bind(p.id, surveyId, responseId, p.key, p.type, p.size, new Date().toISOString()),
    env.DB.prepare('DELETE FROM risk_photo_deletions WHERE object_key=?').bind(p.key)
  ]);
}
export async function cleanupPhotos(env) {
  if (!env.RISK_PHOTOS || !await extensionsAvailable(env)) return;
  const pending = await env.DB.prepare('SELECT object_key FROM risk_photo_deletions WHERE ready_after<=? LIMIT 100').bind(new Date().toISOString()).all();
  for (const row of pending.results) {
    // A committed attachment always wins over a stale cleanup job.
    const used = await env.DB.prepare('SELECT id FROM risk_response_photos WHERE object_key=?').bind(row.object_key).first();
    if (!used) await env.RISK_PHOTOS.delete(row.object_key);
    await env.DB.prepare('DELETE FROM risk_photo_deletions WHERE object_key=?').bind(row.object_key).run();
  }
}
export async function responsePhoto({ request, env, params }) {
  if (request.method !== 'GET') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
  try {
    const owner = await authenticate(request, env); if (!owner) return errorResponse('UNAUTHENTICATED', 401);
    if (!await extensionsAvailable(env)) return errorResponse('NOT_FOUND', 404);
    const photo = await env.DB.prepare('SELECT p.object_key,p.content_type FROM risk_response_photos p JOIN risk_surveys s ON s.id=p.survey_id WHERE p.id=? AND p.survey_id=? AND p.response_id=? AND s.owner_user_id=?').bind(params.photoId, params.id, params.responseId, owner).first();
    if (!photo) return errorResponse('NOT_FOUND', 404);
    if (!env.RISK_PHOTOS) return errorResponse('PHOTO_STORAGE_UNAVAILABLE', 503);
    const object = await env.RISK_PHOTOS.get(photo.object_key); if (!object) return errorResponse('NOT_FOUND', 404);
    return new Response(object.body, { headers: { 'Content-Type': photo.content_type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline' } });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}
