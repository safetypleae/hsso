import { json, errorResponse } from './auth-session.js';
import { authenticate } from './documents.js';
import { requireAdmin } from './admin-auth.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_BODY_BYTES = 16384;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const length = (value, max, required = true) => typeof value === 'string' && Array.from(value.trim()).length <= max && (!required || value.trim().length > 0);
const clean = value => value.trim().replace(/\s+/gu, ' ');
const nameKey = value => clean(value).normalize('NFKC').toLocaleLowerCase('ko-KR');

function guard(request, methods, mutations = []) {
  if (!methods.includes(request.method)) return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: methods.join(', ') });
  const origin = request.headers.get('Origin');
  if (mutations.includes(request.method) && origin !== null && origin !== new URL(request.url).origin) return errorResponse('ORIGIN_NOT_ALLOWED', 403);
  return null;
}

async function readBody(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('INVALID_CONTENT_TYPE');
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
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('INVALID_JSON'); }
}

function inputError(error) {
  if (error.message === 'PAYLOAD_TOO_LARGE') return errorResponse('PAYLOAD_TOO_LARGE', 413);
  return errorResponse(error.message === 'INVALID_CONTENT_TYPE' ? 'INVALID_CONTENT_TYPE' : 'INVALID_JSON', 400);
}

async function sessionUser(request, env) {
  const userId = await authenticate(request, env);
  return userId ? { userId } : { response: errorResponse('UNAUTHENTICATED', 401) };
}

async function companyAdmin(request, env, companyId) {
  const access = await sessionUser(request, env);
  if (access.response) return access;
  if (!UUID.test(companyId || '')) return { response: errorResponse('NOT_FOUND', 404) };
  const row = await env.DB.prepare(
    "SELECT c.status AS company_status,m.role,m.status AS membership_status FROM companies c INNER JOIN company_memberships m ON m.company_id=c.id WHERE c.id=? AND m.user_id=? LIMIT 1"
  ).bind(companyId, access.userId).first();
  if (!row) return { response: errorResponse('NOT_FOUND', 404) };
  if (row.company_status !== 'active') return { response: errorResponse('COMPANY_INACTIVE', 403) };
  if (row.membership_status !== 'active' || row.role !== 'company_admin') return { response: errorResponse('COMPANY_ADMIN_REQUIRED', 403) };
  return access;
}

const applicationSelect = `SELECT a.id,a.company_name AS companyName,a.department_name AS departmentName,a.position_title AS positionTitle,
  a.reason,a.additional_info AS additionalInfo,a.status,a.approved_company_id AS approvedCompanyId,a.review_note AS reviewNote,
  a.created_at AS createdAt,a.reviewed_at AS reviewedAt,u.id AS applicantUserId,u.name AS applicantName,u.email AS applicantEmail,
  reviewer.name AS reviewerName
  FROM company_admin_applications a INNER JOIN users u ON u.id=a.applicant_user_id
  LEFT JOIN users reviewer ON reviewer.id=a.reviewed_by_user_id`;

export async function applications({ request, env }) {
  const rejected = guard(request, ['GET', 'POST'], ['POST']); if (rejected) return rejected;
  try {
    const access = await sessionUser(request, env); if (access.response) return access.response;
    if (request.method === 'GET') {
      const rows = await env.DB.prepare(`${applicationSelect} WHERE a.applicant_user_id=? ORDER BY a.created_at DESC,a.id DESC`).bind(access.userId).all();
      return json({ ok: true, applications: rows.results });
    }
    let input; try { input = await readBody(request); } catch (error) { return inputError(error); }
    const keys = ['companyName', 'departmentName', 'positionTitle', 'reason', 'additionalInfo'];
    if (!exact(input, keys) || !length(input.companyName, 100) || !length(input.departmentName, 100) || !length(input.positionTitle, 50) || !length(input.reason, 2000) || !length(input.additionalInfo, 2000, false)) return errorResponse('INVALID_APPLICATION', 400);
    const values = { companyName: clean(input.companyName), departmentName: clean(input.departmentName), positionTitle: clean(input.positionTitle), reason: input.reason.trim(), additionalInfo: input.additionalInfo.trim() };
    const duplicate = await env.DB.prepare("SELECT id FROM company_admin_applications WHERE applicant_user_id=? AND company_name_key=? AND status='pending' LIMIT 1").bind(access.userId, nameKey(values.companyName)).first();
    if (duplicate) return errorResponse('PENDING_APPLICATION_EXISTS', 409);
    const id = crypto.randomUUID(), now = new Date().toISOString();
    try {
      const result = await env.DB.prepare("INSERT INTO company_admin_applications (id,applicant_user_id,company_name,company_name_key,department_name,department_name_key,position_title,reason,additional_info,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)")
        .bind(id, access.userId, values.companyName, nameKey(values.companyName), values.departmentName, nameKey(values.departmentName), values.positionTitle, values.reason, values.additionalInfo, now, now).run();
      if (!result.success || result.meta?.changes !== 1) throw new Error('insert');
    } catch (error) {
      if (String(error.message).toLowerCase().includes('unique')) return errorResponse('PENDING_APPLICATION_EXISTS', 409);
      throw error;
    }
    const application = await env.DB.prepare(`${applicationSelect} WHERE a.id=? AND a.applicant_user_id=?`).bind(id, access.userId).first();
    return json({ ok: true, application }, 201);
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function companies({ request, env }) {
  const rejected = guard(request, ['GET']); if (rejected) return rejected;
  try {
    const access = await sessionUser(request, env); if (access.response) return access.response;
    const rows = await env.DB.prepare(`SELECT c.id,c.name,c.status,m.role,m.status AS membershipStatus,m.position_title AS positionTitle,
      d.id AS primaryDepartmentId,d.name AS primaryDepartmentName
      FROM company_memberships m INNER JOIN companies c ON c.id=m.company_id
      LEFT JOIN company_departments d ON d.id=m.primary_department_id
      WHERE m.user_id=? ORDER BY c.name,c.id`).bind(access.userId).all();
    return json({ ok: true, companies: rows.results });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function adminApplications({ request, env }) {
  const rejected = guard(request, ['GET']); if (rejected) return rejected;
  const access = await requireAdmin(request, env); if (access.response) return access.response;
  try {
    const params = new URL(request.url).searchParams, status = params.get('status') || '', rawLimit = params.get('limit') || '50', rawOffset = params.get('offset') || '0';
    if (!['', 'pending', 'approved', 'rejected'].includes(status) || !/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset) || Number(rawLimit) < 1 || !Number.isSafeInteger(Number(rawOffset))) return errorResponse('INVALID_FILTER', 400);
    const limit = Math.min(Number(rawLimit), 100), offset = Number(rawOffset);
    const rows = await env.DB.prepare(`${applicationSelect} WHERE (?='' OR a.status=?) ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`).bind(status, status, limit + 1, offset).all();
    const total = await env.DB.prepare("SELECT COUNT(*) AS count FROM company_admin_applications WHERE (?='' OR status=?)").bind(status, status).first();
    return json({ ok: true, applications: rows.results.slice(0, limit), hasMore: rows.results.length > limit, total: Number(total.count), limit, offset });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function approveApplication({ request, env, params }) {
  const rejected = guard(request, ['POST'], ['POST']); if (rejected) return rejected;
  const access = await requireAdmin(request, env); if (access.response) return access.response;
  if (!UUID.test(params.id || '')) return errorResponse('NOT_FOUND', 404);
  try {
    let input; try { input = await readBody(request); } catch (error) { return inputError(error); }
    if (!exact(input, ['reviewNote']) || !length(input.reviewNote, 2000, false)) return errorResponse('INVALID_REVIEW', 400);
    const application = await env.DB.prepare("SELECT * FROM company_admin_applications WHERE id=?").bind(params.id).first();
    if (!application) return errorResponse('NOT_FOUND', 404);
    if (application.status !== 'pending') return errorResponse('APPLICATION_ALREADY_REVIEWED', 409);
    const companyId = crypto.randomUUID(), departmentId = crypto.randomUUID(), membershipId = crypto.randomUUID(), eventId = crypto.randomUUID(), now = new Date().toISOString();
    const results = await env.DB.batch([
      env.DB.prepare("INSERT INTO companies (id,name,name_key,status,initial_admin_user_id,created_at,updated_at) SELECT ?,company_name,company_name_key,'active',applicant_user_id,?,? FROM company_admin_applications WHERE id=? AND status='pending'").bind(companyId, now, now, params.id),
      env.DB.prepare("INSERT INTO company_departments (id,company_id,name,name_key,status,created_by_user_id,created_at,updated_at) SELECT ?,?,department_name,department_name_key,'active',applicant_user_id,?,? FROM company_admin_applications WHERE id=? AND status='pending' AND EXISTS (SELECT 1 FROM companies WHERE id=?)").bind(departmentId, companyId, now, now, params.id, companyId),
      env.DB.prepare("INSERT INTO company_memberships (id,company_id,user_id,role,status,primary_department_id,position_title,created_at,updated_at) SELECT ?,?,applicant_user_id,'company_admin','active',?,position_title,?,? FROM company_admin_applications WHERE id=? AND status='pending' AND EXISTS (SELECT 1 FROM company_departments WHERE id=? AND company_id=?)").bind(membershipId, companyId, departmentId, now, now, params.id, departmentId, companyId),
      env.DB.prepare("UPDATE company_admin_applications SET status='approved',approved_company_id=?,reviewed_by_user_id=?,review_note=?,reviewed_at=?,updated_at=? WHERE id=? AND status='pending' AND EXISTS (SELECT 1 FROM company_memberships WHERE id=? AND company_id=?)").bind(companyId, access.userId, input.reviewNote.trim(), now, now, params.id, membershipId, companyId),
      env.DB.prepare("INSERT INTO company_permission_events (id,company_id,department_id,actor_user_id,target_user_id,action,created_at) SELECT ?,?,?,?,applicant_user_id,'company_admin_approved',? FROM company_admin_applications WHERE id=? AND status='approved' AND approved_company_id=?").bind(eventId, companyId, departmentId, access.userId, now, params.id, companyId)
    ]);
    if (results.some(result => !result.success || result.meta?.changes !== 1)) return errorResponse('APPLICATION_ALREADY_REVIEWED', 409);
    return json({ ok: true, companyId });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function rejectApplication({ request, env, params }) {
  const rejected = guard(request, ['POST'], ['POST']); if (rejected) return rejected;
  const access = await requireAdmin(request, env); if (access.response) return access.response;
  if (!UUID.test(params.id || '')) return errorResponse('NOT_FOUND', 404);
  try {
    let input; try { input = await readBody(request); } catch (error) { return inputError(error); }
    if (!exact(input, ['reviewNote']) || !length(input.reviewNote, 2000)) return errorResponse('INVALID_REVIEW', 400);
    const now = new Date().toISOString();
    const result = await env.DB.prepare("UPDATE company_admin_applications SET status='rejected',reviewed_by_user_id=?,review_note=?,reviewed_at=?,updated_at=? WHERE id=? AND status='pending'").bind(access.userId, input.reviewNote.trim(), now, now, params.id).run();
    if (!result.success || result.meta?.changes !== 1) {
      const found = await env.DB.prepare('SELECT status FROM company_admin_applications WHERE id=?').bind(params.id).first();
      return errorResponse(found ? 'APPLICATION_ALREADY_REVIEWED' : 'NOT_FOUND', found ? 409 : 404);
    }
    return json({ ok: true });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function departments({ request, env, params }) {
  const rejected = guard(request, ['GET', 'POST'], ['POST']); if (rejected) return rejected;
  let access;
  try { access = await companyAdmin(request, env, params.companyId); } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
  if (access.response) return access.response;
  try {
    if (request.method === 'GET') {
      const rows = await env.DB.prepare('SELECT id,name,status,created_at AS createdAt,updated_at AS updatedAt FROM company_departments WHERE company_id=? ORDER BY status DESC,name,id').bind(params.companyId).all();
      return json({ ok: true, departments: rows.results });
    }
    let input; try { input = await readBody(request); } catch (error) { return inputError(error); }
    if (!exact(input, ['name']) || !length(input.name, 100)) return errorResponse('INVALID_DEPARTMENT', 400);
    const id = crypto.randomUUID(), now = new Date().toISOString(), name = clean(input.name);
    try {
      const result = await env.DB.prepare("INSERT INTO company_departments (id,company_id,name,name_key,status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,'active',?,?,?)").bind(id, params.companyId, name, nameKey(name), access.userId, now, now).run();
      if (!result.success || result.meta?.changes !== 1) throw new Error('insert');
    } catch (error) {
      if (String(error.message).toLowerCase().includes('unique')) return errorResponse('DEPARTMENT_EXISTS', 409);
      throw error;
    }
    return json({ ok: true, department: { id, name, status: 'active', createdAt: now, updatedAt: now } }, 201);
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function departmentItem({ request, env, params }) {
  const rejected = guard(request, ['PATCH'], ['PATCH']); if (rejected) return rejected;
  let access;
  try { access = await companyAdmin(request, env, params.companyId); } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
  if (access.response) return access.response;
  if (!UUID.test(params.departmentId || '')) return errorResponse('NOT_FOUND', 404);
  try {
    let input; try { input = await readBody(request); } catch (error) { return inputError(error); }
    if (!exact(input, ['name', 'status']) || !length(input.name, 100) || !['active', 'inactive'].includes(input.status)) return errorResponse('INVALID_DEPARTMENT', 400);
    const name = clean(input.name), now = new Date().toISOString();
    try {
      const result = await env.DB.prepare('UPDATE company_departments SET name=?,name_key=?,status=?,updated_at=? WHERE id=? AND company_id=?').bind(name, nameKey(name), input.status, now, params.departmentId, params.companyId).run();
      if (!result.success || result.meta?.changes !== 1) return errorResponse('NOT_FOUND', 404);
    } catch (error) {
      if (String(error.message).toLowerCase().includes('unique')) return errorResponse('DEPARTMENT_EXISTS', 409);
      throw error;
    }
    return json({ ok: true, department: { id: params.departmentId, name, status: input.status, updatedAt: now } });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}
