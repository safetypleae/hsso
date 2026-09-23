import { json, errorResponse } from './auth-session.js';
import { authenticate } from './documents.js';
import { SELECT_RESPONSE, responseView } from './risk-surveys.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const STATUSES = new Set(['UNREVIEWED', 'ACCEPTED', 'HOLD', 'REJECTED']);
const STORED_STATUSES = new Set(['ACCEPTED', 'HOLD', 'REJECTED']);
const REASONS = new Set(['ALREADY_REFLECTED', 'IMPROVEMENT_COMPLETED', 'DUPLICATE', 'NOT_A_HAZARD', 'OTHER']);
const MAX_BODY_BYTES = 8192;
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function guard(request, methods, mutations = []) {
  if (!methods.includes(request.method)) return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: methods.join(', ') });
  const origin = request.headers.get('Origin');
  if (mutations.includes(request.method) && origin !== null && origin !== new URL(request.url).origin) return errorResponse('ORIGIN_NOT_ALLOWED', 403);
  return null;
}

async function body(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('INVALID_CONTENT_TYPE');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
  try { return JSON.parse(text); } catch { throw new Error('INVALID_JSON'); }
}

function bodyError(error) {
  if (error.message === 'PAYLOAD_TOO_LARGE') return errorResponse('PAYLOAD_TOO_LARGE', 413);
  return errorResponse(error.message === 'INVALID_CONTENT_TYPE' ? 'INVALID_CONTENT_TYPE' : 'INVALID_JSON', 400);
}

async function access(request, env, surveyId) {
  const userId = await authenticate(request, env);
  if (!userId) return { response: errorResponse('UNAUTHENTICATED', 401) };
  if (!UUID.test(surveyId || '')) return { response: errorResponse('NOT_FOUND', 404) };
  const survey = await env.DB.prepare(`SELECT s.id,s.owner_user_id AS ownerUserId,scope.company_id AS companyId,c.name AS companyName,c.status AS companyStatus,
    m.role,m.status AS membershipStatus
    FROM risk_surveys s LEFT JOIN risk_survey_company_scopes scope ON scope.survey_id=s.id
    LEFT JOIN companies c ON c.id=scope.company_id
    LEFT JOIN company_memberships m ON m.company_id=scope.company_id AND m.user_id=?
    WHERE s.id=? LIMIT 1`).bind(userId, surveyId).first();
  if (!survey) return { response: errorResponse('NOT_FOUND', 404) };
  if (!survey.companyId) return survey.ownerUserId === userId ? { response: errorResponse('REVIEW_SCOPE_REQUIRED', 409) } : { response: errorResponse('NOT_FOUND', 404) };
  if (!survey.role) return { response: errorResponse('NOT_FOUND', 404) };
  if (survey.companyStatus !== 'active') return { response: errorResponse('COMPANY_INACTIVE', 403) };
  if (survey.membershipStatus !== 'active' || survey.role !== 'company_admin') return { response: errorResponse('COMPANY_ADMIN_REQUIRED', 403) };
  return { userId, survey };
}

const REVIEW_SELECT = `,COALESCE(rv.review_status,'UNREVIEWED') AS reviewStatus,rv.rejection_reason AS rejectionReason,
  COALESCE(rv.review_note,'') AS reviewNote,rv.reviewed_by_user_id AS reviewedBy,rv.reviewed_at AS reviewedAt,rai.id AS assessmentItemId`;

function reviewedResponse(row) {
  return { ...responseView(row), reviewStatus: row.reviewStatus, rejectionReason: row.rejectionReason, reviewNote: row.reviewNote, reviewedBy: row.reviewedBy, reviewedAt: row.reviewedAt, assessmentItemId: row.assessmentItemId || null };
}

function filters(url) {
  const query = new URL(url).searchParams;
  if ([...query.keys()].some(key => !['department', 'status', 'q', 'limit', 'offset'].includes(key)) || [...query.keys()].some(key => query.getAll(key).length !== 1)) throw new Error('INVALID_FILTER');
  const department = query.get('department') || '', status = query.get('status') || '', search = (query.get('q') || '').trim();
  const rawLimit = query.get('limit') || '50', rawOffset = query.get('offset') || '0';
  if (department.length > 300 || search.length > 100 || status && !STATUSES.has(status) || !/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset) || Number(rawLimit) < 1 || !Number.isSafeInteger(Number(rawOffset))) throw new Error('INVALID_FILTER');
  return { department, status, search, limit: Math.min(Number(rawLimit), 100), offset: Number(rawOffset) };
}

function filteredWhere(surveyId, values, includeStatus) {
  const clauses = ['r.survey_id=?'], bindings = [surveyId];
  if (values.department) { clauses.push('r.is_anonymous=0 AND r.department=?'); bindings.push(values.department); }
  if (values.search) {
    clauses.push(`(COALESCE(r.hazard_description,'') LIKE ? OR COALESCE(r.location,'') LIKE ? OR COALESCE(r.improvement_suggestion,'') LIKE ? OR COALESCE(r.safe_reason,'') LIKE ? OR r.response_data LIKE ?)`);
    const pattern = `%${values.search}%`; bindings.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (includeStatus && values.status) {
    clauses.push(values.status === 'UNREVIEWED' ? 'rv.response_id IS NULL' : 'rv.review_status=?');
    if (values.status !== 'UNREVIEWED') bindings.push(values.status);
  }
  return { sql: clauses.join(' AND '), bindings };
}

export async function reviewScope({ request, env, params }) {
  const rejected = guard(request, ['POST'], ['POST']); if (rejected) return rejected;
  let input; try { input = await body(request); } catch (error) { return bodyError(error); }
  if (!exact(input, ['companyId']) || !UUID.test(input.companyId || '') || !UUID.test(params.id || '')) return errorResponse('INVALID_SCOPE', 400);
  try {
    const userId = await authenticate(request, env); if (!userId) return errorResponse('UNAUTHENTICATED', 401);
    const eligible = await env.DB.prepare(`SELECT s.id FROM risk_surveys s INNER JOIN company_memberships m ON m.user_id=s.owner_user_id
      INNER JOIN companies c ON c.id=m.company_id WHERE s.id=? AND s.owner_user_id=? AND c.id=? AND c.status='active' AND m.status='active' AND m.role='company_admin' LIMIT 1`)
      .bind(params.id, userId, input.companyId).first();
    if (!eligible) return errorResponse('NOT_FOUND', 404);
    const existing = await env.DB.prepare('SELECT company_id AS companyId FROM risk_survey_company_scopes WHERE survey_id=?').bind(params.id).first();
    if (existing) return existing.companyId === input.companyId ? json({ ok: true, companyId: existing.companyId }) : errorResponse('REVIEW_SCOPE_CONFLICT', 409);
    const now = new Date().toISOString();
    try {
      const result = await env.DB.prepare('INSERT INTO risk_survey_company_scopes (survey_id,company_id,linked_by_user_id,linked_at) VALUES (?,?,?,?)').bind(params.id, input.companyId, userId, now).run();
      if (!result.success || result.meta?.changes !== 1) throw new Error('insert');
    } catch (error) {
      if (/unique|constraint/i.test(String(error.message))) return errorResponse('REVIEW_SCOPE_CONFLICT', 409);
      throw error;
    }
    return json({ ok: true, companyId: input.companyId, linkedAt: now }, 201);
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function reviewCollection({ request, env, params }) {
  const rejected = guard(request, ['GET']); if (rejected) return rejected;
  try {
    const allowed = await access(request, env, params.id); if (allowed.response) return allowed.response;
    let selected; try { selected = filters(request.url); } catch { return errorResponse('INVALID_FILTER', 400); }
    const listWhere = filteredWhere(params.id, selected, true), summaryWhere = filteredWhere(params.id, selected, false);
    const rows = await env.DB.prepare(`${SELECT_RESPONSE}${REVIEW_SELECT} FROM risk_responses r LEFT JOIN risk_response_reviews rv ON rv.response_id=r.id
      LEFT JOIN risk_assessment_items rai ON rai.source_response_id=r.id
      WHERE ${listWhere.sql} ORDER BY r.submitted_at DESC,r.id DESC LIMIT ? OFFSET ?`).bind(...listWhere.bindings, selected.limit + 1, selected.offset).all();
    const summary = await env.DB.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN rv.response_id IS NULL THEN 1 ELSE 0 END) AS unreviewed,
      SUM(CASE WHEN rv.review_status='ACCEPTED' THEN 1 ELSE 0 END) AS accepted,SUM(CASE WHEN rv.review_status='HOLD' THEN 1 ELSE 0 END) AS hold,
      SUM(CASE WHEN rv.review_status='REJECTED' THEN 1 ELSE 0 END) AS rejected
      FROM risk_responses r LEFT JOIN risk_response_reviews rv ON rv.response_id=r.id WHERE ${summaryWhere.sql}`).bind(...summaryWhere.bindings).first();
    const departments = await env.DB.prepare("SELECT DISTINCT department FROM risk_responses WHERE survey_id=? AND is_anonymous=0 AND department IS NOT NULL AND department<>'' ORDER BY department").bind(params.id).all();
    return json({ ok: true, survey: { id: params.id, companyId: allowed.survey.companyId, companyName: allowed.survey.companyName },
      summary: Object.fromEntries(['total','unreviewed','accepted','hold','rejected'].map(key => [key, Number(summary[key] || 0)])),
      filters: { department: selected.department, status: selected.status, q: selected.search }, departments: departments.results.map(row => row.department),
      responses: rows.results.slice(0, selected.limit).map(reviewedResponse), hasMore: rows.results.length > selected.limit, limit: selected.limit, offset: selected.offset });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function reviewItem({ request, env, params }) {
  const rejected = guard(request, ['PATCH'], ['PATCH']); if (rejected) return rejected;
  if (!UUID.test(params.responseId || '')) return errorResponse('NOT_FOUND', 404);
  let input; try { input = await body(request); } catch (error) { return bodyError(error); }
  if (!exact(input, ['reviewStatus', 'rejectionReason', 'reviewNote']) || !STORED_STATUSES.has(input.reviewStatus) || typeof input.reviewNote !== 'string' || input.reviewNote.length > 2000) return errorResponse('INVALID_REVIEW', 400);
  if (input.reviewStatus === 'REJECTED' ? !REASONS.has(input.rejectionReason) : input.rejectionReason !== null) return errorResponse('INVALID_REVIEW', 400);
  if (input.reviewStatus === 'REJECTED' && input.rejectionReason === 'OTHER' && !input.reviewNote.trim()) return errorResponse('REVIEW_NOTE_REQUIRED', 400);
  if (input.reviewStatus === 'REJECTED' && input.rejectionReason !== 'OTHER' && input.reviewNote.trim()) return errorResponse('INVALID_REVIEW', 400);
  try {
    const allowed = await access(request, env, params.id); if (allowed.response) return allowed.response;
    const now = new Date().toISOString(), note = input.reviewNote.trim();
    const result = await env.DB.prepare(`INSERT INTO risk_response_reviews (response_id,survey_id,company_id,review_status,rejection_reason,review_note,reviewed_by_user_id,reviewed_at)
      SELECT r.id,r.survey_id,?,?,?, ?,?,? FROM risk_responses r WHERE r.id=? AND r.survey_id=?
      ON CONFLICT(response_id) DO UPDATE SET review_status=excluded.review_status,rejection_reason=excluded.rejection_reason,review_note=excluded.review_note,
      reviewed_by_user_id=excluded.reviewed_by_user_id,reviewed_at=excluded.reviewed_at`)
      .bind(allowed.survey.companyId, input.reviewStatus, input.rejectionReason, note, allowed.userId, now, params.responseId, params.id).run();
    if (!result.success || result.meta?.changes !== 1) return errorResponse('NOT_FOUND', 404);
    return json({ ok: true, review: { responseId: params.responseId, reviewStatus: input.reviewStatus, rejectionReason: input.rejectionReason, reviewNote: note, reviewedBy: allowed.userId, reviewedAt: now } });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}
