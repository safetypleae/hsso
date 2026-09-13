import { json, errorResponse } from './auth-session.js';
import { authenticate } from './documents.js';
import { requireAdmin, userRole } from './admin-auth.js';

export const MAX_BOARD_BODY_BYTES = 65536;
const UUID = /^[a-f0-9-]{36}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, maximum, required = false) => typeof value === 'string' && Array.from(value).length <= maximum && (!required || value.trim().length > 0);

function guard(request, methods, protectedMethods = []) {
  if (!methods.includes(request.method)) return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: methods.join(', ') });
  const origin = request.headers.get('Origin');
  if (protectedMethods.includes(request.method) && origin !== null && origin !== new URL(request.url).origin) return errorResponse('ORIGIN_NOT_ALLOWED', 403);
  return null;
}

async function readBody(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('INVALID_CONTENT_TYPE');
  const reader = request.body?.getReader(); if (!reader) throw new Error('INVALID_JSON');
  const chunks = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BOARD_BODY_BYTES) { await reader.cancel(); throw new Error('PAYLOAD_TOO_LARGE'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('INVALID_JSON'); }
}

function bodyError(error) {
  return errorResponse(error.message === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : error.message === 'INVALID_CONTENT_TYPE' ? 'INVALID_CONTENT_TYPE' : 'INVALID_JSON', error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400);
}

function postView(row, viewerId = null, admin = false) {
  return { id: row.id, boardType: row.boardType, title: row.title, ...(row.content === undefined ? {} : { content: row.content }), authorName: row.authorName || '탈퇴한 사용자', ...(row.content === undefined ? {} : { canEdit: row.boardType === 'notice' ? admin : viewerId === row.authorUserId, canDelete: row.boardType === 'notice' && admin }), viewCount: Number(row.viewCount), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

const SELECT_LIST = 'SELECT p.id,p.board_type AS boardType,p.title,u.name AS authorName,p.view_count AS viewCount,p.created_at AS createdAt,p.updated_at AS updatedAt FROM board_posts p LEFT JOIN users u ON u.id=p.author_user_id';
const SELECT_DETAIL = 'SELECT p.id,p.board_type AS boardType,p.title,p.content,p.author_user_id AS authorUserId,u.name AS authorName,p.view_count AS viewCount,p.created_at AS createdAt,p.updated_at AS updatedAt FROM board_posts p LEFT JOIN users u ON u.id=p.author_user_id';

export async function boardCollection({ request, env }) {
  const rejected = guard(request, ['GET','POST'], ['POST']); if (rejected) return rejected;
  try {
    if (request.method === 'POST') {
      const userId = await authenticate(request, env); if (!userId) return errorResponse('UNAUTHENTICATED', 401);
      let input; try { input = await readBody(request); } catch (error) { return bodyError(error); }
      if (!object(input) || !['notice','free'].includes(input.boardType) || !text(input.title, 200, true) || !text(input.content, 10000, true)) return errorResponse('INVALID_POST', 400);
      if (input.boardType === 'notice') {
        const admin = await requireAdmin(request, env); if (admin.response) return admin.response;
      }
      const id = crypto.randomUUID(), now = new Date().toISOString();
      const result = await env.DB.prepare('INSERT INTO board_posts (id,board_type,author_user_id,title,content,view_count,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?)').bind(id,input.boardType,userId,input.title.trim(),input.content.trim(),now,now).run();
      if (!result.success || result.meta?.changes !== 1) throw new Error('insert');
      return json({ ok:true, post:{ id,boardType:input.boardType,title:input.title.trim(),viewCount:0,createdAt:now,updatedAt:now } },201);
    }
    const params = new URL(request.url).searchParams, type = params.get('type'), q = (params.get('q') || '').trim(), rawLimit = params.get('limit') || '20', rawOffset = params.get('offset') || '0';
    if (!['notice','free'].includes(type) || !text(q,200) || !/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset) || Number(rawLimit)<1 || !Number.isSafeInteger(Number(rawOffset))) return errorResponse('INVALID_FILTER',400);
    const limit=Math.min(Number(rawLimit),50),offset=Number(rawOffset),pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
    const rows=await env.DB.prepare(`${SELECT_LIST} WHERE p.board_type=? AND (?='' OR p.title LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\') ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?`).bind(type,q,pattern,pattern,limit+1,offset).all();
    const total=await env.DB.prepare("SELECT COUNT(*) AS count FROM board_posts p LEFT JOIN users u ON u.id=p.author_user_id WHERE p.board_type=? AND (?='' OR p.title LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')").bind(type,q,pattern,pattern).first();
    return json({ok:true,posts:rows.results.slice(0,limit).map(postView),hasMore:rows.results.length>limit,total:Number(total.count),limit,offset});
  } catch { return errorResponse('INTERNAL_SERVER_ERROR',500); }
}

export async function boardItem({ request, env, params }) {
  const rejected=guard(request,['GET','PATCH','DELETE'],['PATCH','DELETE']);if(rejected)return rejected;
  try {
    if (!UUID.test(params.id || '')) return errorResponse('NOT_FOUND',404);
    const viewerId = await authenticate(request, env);
    if (request.method !== 'GET' && !viewerId) return errorResponse('UNAUTHENTICATED',401);
    const existing = await env.DB.prepare(`${SELECT_DETAIL} WHERE p.id=?`).bind(params.id).first();
    if (!existing) return errorResponse('NOT_FOUND',404);
    let admin = false;
    if (existing.boardType === 'notice') {
      if (request.method !== 'GET') {
        const access = await requireAdmin(request, env); if (access.response) return access.response;
        admin = true;
      } else if (viewerId) admin = await userRole(env, viewerId) === 'admin';
    }
    if (request.method === 'DELETE') {
      if (existing.boardType !== 'notice') return errorResponse('FORBIDDEN',403);
      const result = await env.DB.prepare("DELETE FROM board_posts WHERE id=? AND board_type='notice'").bind(params.id).run();
      if (!result.success) throw new Error('delete');
      return result.meta?.changes === 1 ? json({ok:true}) : errorResponse('NOT_FOUND',404);
    }
    if (request.method === 'PATCH') {
      if (existing.boardType === 'free' && existing.authorUserId !== viewerId) return errorResponse('NOT_FOUND',404);
      let input;try{input=await readBody(request);}catch(error){return bodyError(error);}
      if(!object(input)||!text(input.title,200,true)||!text(input.content,10000,true))return errorResponse('INVALID_POST',400);
      const result = existing.boardType === 'notice'
        ? await env.DB.prepare("UPDATE board_posts SET title=?,content=?,updated_at=? WHERE id=? AND board_type='notice'").bind(input.title.trim(),input.content.trim(),new Date().toISOString(),params.id).run()
        : await env.DB.prepare("UPDATE board_posts SET title=?,content=?,updated_at=? WHERE id=? AND board_type='free' AND author_user_id=?").bind(input.title.trim(),input.content.trim(),new Date().toISOString(),params.id,viewerId).run();
      if(!result.success)throw new Error('update');if(result.meta?.changes!==1)return errorResponse('NOT_FOUND',404);
    } else {
      const updated=await env.DB.prepare('UPDATE board_posts SET view_count=view_count+1 WHERE id=?').bind(params.id).run();
      if(!updated.success)throw new Error('view');if(updated.meta?.changes!==1)return errorResponse('NOT_FOUND',404);
    }
    const row=await env.DB.prepare(`${SELECT_DETAIL} WHERE p.id=?`).bind(params.id).first();
    return row?json({ok:true,post:postView(row,viewerId,admin)}):errorResponse('NOT_FOUND',404);
  } catch { return errorResponse('INTERNAL_SERVER_ERROR',500); }
}
