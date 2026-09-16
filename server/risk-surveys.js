import { json, errorResponse } from './auth-session.js';
import { authenticate } from './documents.js';
import { extensionsAvailable, surveyExtension, validDefinition, normalizeAnswers } from './risk-model.js';

export { SELECT_RESPONSE, responseView };

export const MAX_SURVEY_BODY_BYTES = 65536;
export const MAX_RESPONSE_BODY_BYTES = 32768;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9-]{36}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
const boolean = value => typeof value === 'boolean';

function methodGuard(request, methods, originMethods = []) {
  if (!methods.includes(request.method)) return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: methods.join(', ') });
  const origin = request.headers.get('Origin');
  if (originMethods.includes(request.method) && origin !== null && origin !== new URL(request.url).origin) return errorResponse('ORIGIN_NOT_ALLOWED', 403);
  return null;
}

async function body(request, maximum) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('INVALID_CONTENT_TYPE');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INVALID_JSON');
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > maximum) { await reader.cancel(); throw new Error('PAYLOAD_TOO_LARGE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('INVALID_JSON'); }
}

function bodyError(error) {
  if (error.message === 'PAYLOAD_TOO_LARGE') return errorResponse('PAYLOAD_TOO_LARGE', 413);
  return errorResponse(error.message === 'INVALID_CONTENT_TYPE' ? 'INVALID_CONTENT_TYPE' : 'INVALID_JSON', 400);
}

function validDates(start, end) {
  const real = value => {
    if (!DATE.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number), parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  };
  return real(start) && real(end) && start <= end;
}

function validSettings(settings) {
  return object(settings) && ['collectName','collectDepartment','collectEmployeeId','allowAnonymous','allowDuplicates','allowEdit'].every(key => boolean(settings[key]));
}

function validQuestions(questions) {
  return Array.isArray(questions) && questions.length >= 1 && questions.length <= 30 && questions.every(q => object(q) && string(q.id, 50, true) && string(q.type, 30, true) && q.type !== 'photo' && string(q.text, 500, true) && string(q.description ?? '', 2000) && (!Object.hasOwn(q, 'options') || (Array.isArray(q.options) && q.options.length <= 30 && q.options.every(v => string(v, 100, true)))));
}

function validSurvey(input) {
  return object(input) && string(input.title, 200, true) && string(input.target, 300, true) && string(input.guidance, 5000) && validDates(input.startDate, input.endDate) && validSettings(input.settings) && validQuestions(input.questions) && boolean(input.isActive) && (input.schemaVersion === undefined || validDefinition(input));
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function statusFor(row, today = kstToday()) {
  if (!row.isActive) return 'inactive';
  if (today < row.startDate) return 'scheduled';
  if (today > row.endDate) return 'ended';
  return 'active';
}

function kstToday(now = Date.now()) {
  return new Date(now + 9 * 3600000).toISOString().slice(0, 10);
}

function surveyView(row, includeToken = true) {
  const result = { id: row.id, title: row.title, target: row.target || '', startDate: row.startDate, endDate: row.endDate, guidance: row.guidance || '', settings: JSON.parse(row.settingsJson), questions: JSON.parse(row.questionsJson), isActive: Boolean(row.isActive), status: statusFor(row), createdAt: row.createdAt, updatedAt: row.updatedAt };
  if (includeToken) result.publicToken = row.publicToken;
  if (row.responseCount !== undefined) result.responseCount = Number(row.responseCount);
  return result;
}

const SELECT_SURVEY = 'SELECT id,owner_user_id AS ownerUserId,public_token AS publicToken,title,target,start_date AS startDate,end_date AS endDate,guidance,settings_json AS settingsJson,questions_json AS questionsJson,is_active AS isActive,created_at AS createdAt,updated_at AS updatedAt';

async function extendedSurvey(env, row, token = true) {
  return { ...surveyView(row, token), ...await surveyExtension(env, row.id, JSON.parse(row.questionsJson)) };
}

export async function surveyCollection({ request, env }) {
  const rejected = methodGuard(request, ['GET','POST'], ['POST']); if (rejected) return rejected;
  try {
    const owner = await authenticate(request, env); if (!owner) return errorResponse('UNAUTHENTICATED', 401);
    if (request.method === 'POST') {
      let input; try { input = await body(request, MAX_SURVEY_BODY_BYTES); } catch (error) { return bodyError(error); }
      if (!validSurvey(input)) return errorResponse('INVALID_SURVEY', 400);
      if (input.schemaVersion === 2 && !await extensionsAvailable(env)) return errorResponse('MIGRATION_REQUIRED', 503);
      const id = crypto.randomUUID(), publicToken = randomToken(), now = new Date().toISOString();
      const insert = env.DB.prepare('INSERT INTO risk_surveys (id,owner_user_id,public_token,title,target,start_date,end_date,guidance,settings_json,questions_json,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id, owner, publicToken, input.title.trim(), input.target.trim(), input.startDate, input.endDate, input.guidance, JSON.stringify(input.settings), JSON.stringify(input.questions), input.isActive ? 1 : 0, now, now);
      const result = input.schemaVersion === 2 ? (await env.DB.batch([insert,
        env.DB.prepare('INSERT INTO risk_survey_metadata (survey_id,company_name,departments_json,revision) VALUES (?,?,?,1)').bind(id, input.companyName.trim(), JSON.stringify(input.departments)),
        env.DB.prepare('INSERT INTO risk_survey_versions (survey_id,revision,definition_json) VALUES (?,1,?)').bind(id, JSON.stringify(input))
      ]))[0] : await insert.run();
      if (!result.success || result.meta?.changes !== 1) throw new Error('insert');
      return json({ ok: true, survey: { id, publicToken, title: input.title.trim(), isActive: input.isActive, status: statusFor({ isActive: input.isActive, startDate: input.startDate, endDate: input.endDate }), createdAt: now } }, 201);
    }
    const rows = await env.DB.prepare(`${SELECT_SURVEY},(SELECT COUNT(*) FROM risk_responses r WHERE r.survey_id=risk_surveys.id) AS responseCount FROM risk_surveys WHERE owner_user_id=? ORDER BY created_at DESC,id DESC`).bind(owner).all();
    const surveys = await Promise.all(rows.results.map(row => extendedSurvey(env, row)));
    return json({ ok: true, surveys, summary: { total: surveys.length, active: surveys.filter(v => v.status === 'active').length, ended: surveys.filter(v => ['ended','inactive'].includes(v.status)).length, responses: surveys.reduce((sum, v) => sum + v.responseCount, 0) }, serverDateKst: kstToday() });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function surveyItem({ request, env, params }) {
  const rejected = methodGuard(request, ['GET','PATCH','DELETE'], ['PATCH','DELETE']); if (rejected) return rejected;
  try {
    const owner = await authenticate(request, env); if (!owner) return errorResponse('UNAUTHENTICATED', 401);
    if (!UUID.test(params.id || '')) return errorResponse('NOT_FOUND', 404);
    const existing = await env.DB.prepare(`${SELECT_SURVEY} FROM risk_surveys WHERE id=? AND owner_user_id=?`).bind(params.id, owner).first();
    if (!existing) return errorResponse('NOT_FOUND', 404);
    if (request.method === 'DELETE') {
      let input; try { input = await body(request, MAX_SURVEY_BODY_BYTES); } catch (error) { return bodyError(error); }
      if (input?.confirmTitle !== existing.title) return errorResponse('CONFIRMATION_REQUIRED', 400);
      await env.DB.prepare('DELETE FROM risk_surveys WHERE id=? AND owner_user_id=?').bind(params.id, owner).run();
      return json({ ok: true });
    }
    if (request.method === 'PATCH') {
      let input; try { input = await body(request, MAX_SURVEY_BODY_BYTES); } catch (error) { return bodyError(error); }
      if (input?.schemaVersion === 2) {
        if (!validSurvey(input)) return errorResponse('INVALID_SURVEY', 400);
        if (!await extensionsAvailable(env)) return errorResponse('MIGRATION_REQUIRED', 503);
        const current = await extendedSurvey(env, existing);
        if (input.revision !== current.revision) return errorResponse('SURVEY_CHANGED', 409);
        const revision = current.revision + 1;
        try { await env.DB.batch([
          env.DB.prepare('INSERT OR IGNORE INTO risk_survey_versions (survey_id,revision,definition_json) VALUES (?,?,?)').bind(params.id, current.revision, JSON.stringify(current)),
          env.DB.prepare('INSERT INTO risk_survey_versions (survey_id,revision,definition_json) VALUES (?,?,?)').bind(params.id, revision, JSON.stringify(input)),
          env.DB.prepare('INSERT INTO risk_survey_metadata (survey_id,company_name,departments_json,revision) VALUES (?,?,?,?) ON CONFLICT(survey_id) DO UPDATE SET company_name=excluded.company_name,departments_json=excluded.departments_json,revision=excluded.revision').bind(params.id, input.companyName.trim(), JSON.stringify(input.departments), revision),
          env.DB.prepare('UPDATE risk_surveys SET title=?,target=?,start_date=?,end_date=?,guidance=?,settings_json=?,questions_json=?,is_active=?,updated_at=? WHERE id=? AND owner_user_id=?').bind(input.title.trim(), input.target.trim(), input.startDate, input.endDate, input.guidance, JSON.stringify(input.settings), JSON.stringify(input.questions), input.isActive ? 1 : 0, new Date().toISOString(), params.id, owner)
        ]); } catch (error) { if (/UNIQUE|constraint/i.test(error.message)) return errorResponse('SURVEY_CHANGED', 409); throw error; }
      } else {
      if (!object(input) || Object.keys(input).length !== 1 || !boolean(input.isActive)) return errorResponse('INVALID_UPDATE', 400);
      const result = await env.DB.prepare('UPDATE risk_surveys SET is_active=?,updated_at=? WHERE id=? AND owner_user_id=?').bind(input.isActive ? 1 : 0, new Date().toISOString(), params.id, owner).run();
      if (!result.success) throw new Error('update');
      if (result.meta?.changes !== 1) return errorResponse('NOT_FOUND', 404);
      }
    }
    const row = await env.DB.prepare(`${SELECT_SURVEY},(SELECT COUNT(*) FROM risk_responses r WHERE r.survey_id=risk_surveys.id) AS responseCount FROM risk_surveys WHERE id=? AND owner_user_id=?`).bind(params.id, owner).first();
    return row ? json({ ok: true, survey: await extendedSurvey(env, row) }) : errorResponse('NOT_FOUND', 404);
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

function publicAvailability(row) {
  const status = statusFor(row);
  if (status === 'inactive') return ['SURVEY_INACTIVE', 403];
  if (status === 'scheduled') return ['SURVEY_NOT_STARTED', 403];
  if (status === 'ended') return ['SURVEY_ENDED', 403];
  return null;
}

async function publicRow(env, token) {
  if (!TOKEN.test(token || '')) return null;
  return env.DB.prepare(`${SELECT_SURVEY} FROM risk_surveys WHERE public_token=?`).bind(token).first();
}

export async function publicSurvey({ request, env, params }) {
  const rejected = methodGuard(request, ['GET']); if (rejected) return rejected;
  try {
    const row = await publicRow(env, params.token); if (!row) return errorResponse('NOT_FOUND', 404);
    const unavailable = publicAvailability(row); if (unavailable) return errorResponse(...unavailable);
    const survey = await extendedSurvey(env, row, false); delete survey.id; delete survey.createdAt; delete survey.updatedAt;
    return json({ ok: true, survey, serverDateKst: kstToday() });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

const responseFields = ['respondentName','department','employeeId','isAnonymous','hasHazard','hazardTypes','hazardDescription','location','preLikelihood','preSeverity','improvementSuggestion','postLikelihood','postSeverity','safeReason'];
function validResponse(input, settings) {
  if (!object(input) || Object.keys(input).some(key => !responseFields.includes(key)) || !boolean(input.isAnonymous) || !boolean(input.hasHazard)) return false;
  for (const key of ['respondentName','department','employeeId','hazardDescription','location','improvementSuggestion','safeReason']) if (!string(input[key] ?? '', key === 'hazardDescription' || key === 'improvementSuggestion' ? 5000 : 300)) return false;
  if (!Array.isArray(input.hazardTypes) || input.hazardTypes.length > 20 || input.hazardTypes.some(v => !string(v, 100, true))) return false;
  if (input.isAnonymous && !settings.allowAnonymous) return false;
  if (!input.isAnonymous && settings.collectName && !input.respondentName?.trim()) return false;
  if (!input.isAnonymous && settings.collectDepartment && !input.department?.trim()) return false;
  if (!input.isAnonymous && settings.collectEmployeeId && !input.employeeId?.trim()) return false;
  if (!input.hasHazard) return Boolean(input.safeReason?.trim()) && [input.preLikelihood,input.preSeverity,input.postLikelihood,input.postSeverity].every(v => v == null);
  const rating = (v, max) => Number.isInteger(v) && v >= 1 && v <= max;
  return input.hazardTypes.length > 0 && input.hazardDescription?.trim() && input.location?.trim() && input.improvementSuggestion?.trim() && rating(input.preLikelihood, 5) && rating(input.preSeverity, 4) && rating(input.postLikelihood, 5) && rating(input.postSeverity, 4);
}

export async function publicResponses({ request, env, params }) {
  const rejected = methodGuard(request, ['POST'], ['POST']); if (rejected) return rejected;
  try {
    const row = await publicRow(env, params.token); if (!row) return errorResponse('NOT_FOUND', 404);
    const unavailable = publicAvailability(row); if (unavailable) return errorResponse(...unavailable);
    let input; try { input = await body(request, MAX_RESPONSE_BODY_BYTES); } catch (error) { return bodyError(error); }
    const settings = JSON.parse(row.settingsJson), definition = await surveyExtension(env, row.id, JSON.parse(row.questionsJson));
    if (input?.schemaVersion === 2) return submitDefinedResponse(env, row, definition, settings, input);
    if (definition.schemaVersion === 2) return errorResponse('SURVEY_CHANGED', 409);
    if (!validResponse(input, settings)) return errorResponse('INVALID_RESPONSE', 400);
    const anonymous = input.isAnonymous;
    const employeeId = anonymous ? null : (input.employeeId || '').trim() || null;
    if (!settings.allowDuplicates && settings.collectEmployeeId && employeeId) {
      const duplicate = await env.DB.prepare('SELECT id FROM risk_responses WHERE survey_id=? AND employee_id=? LIMIT 1').bind(row.id, employeeId).first();
      if (duplicate) return errorResponse('DUPLICATE_RESPONSE', 409);
    }
    const normalized = { ...input, respondentName: anonymous ? null : (input.respondentName || '').trim() || null, department: anonymous ? null : (input.department || '').trim() || null, employeeId, preRiskScore: input.hasHazard ? input.preLikelihood * input.preSeverity : null, postRiskScore: input.hasHazard ? input.postLikelihood * input.postSeverity : null };
    const id = crypto.randomUUID(), submittedAt = new Date().toISOString();
    const result = await env.DB.prepare('INSERT INTO risk_responses (id,survey_id,respondent_name,department,employee_id,is_anonymous,has_hazard,hazard_types_json,hazard_description,location,pre_likelihood,pre_severity,pre_risk_score,improvement_suggestion,post_likelihood,post_severity,post_risk_score,safe_reason,response_data,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id,row.id,normalized.respondentName,normalized.department,normalized.employeeId,anonymous?1:0,input.hasHazard?1:0,JSON.stringify(input.hasHazard?input.hazardTypes:[]),input.hasHazard?input.hazardDescription.trim():null,input.hasHazard?input.location.trim():null,input.hasHazard?input.preLikelihood:null,input.hasHazard?input.preSeverity:null,normalized.preRiskScore,input.hasHazard?input.improvementSuggestion.trim():null,input.hasHazard?input.postLikelihood:null,input.hasHazard?input.postSeverity:null,normalized.postRiskScore,input.hasHazard?null:input.safeReason.trim(),JSON.stringify(normalized),submittedAt).run();
    if (!result.success || result.meta?.changes !== 1) throw new Error('insert');
    return json({ ok: true, submittedAt }, 201);
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

async function submitDefinedResponse(env, row, definition, settings, input) {
  try {
    const normalized = normalizeAnswers(input, definition, settings);
    if (!settings.allowDuplicates && normalized.employeeId) {
      const duplicate = await env.DB.prepare('SELECT id FROM risk_responses WHERE survey_id=? AND employee_id=? LIMIT 1').bind(row.id, normalized.employeeId).first();
      if (duplicate) return errorResponse('DUPLICATE_RESPONSE', 409);
    }
    const id = crypto.randomUUID(), submittedAt = new Date().toISOString();
    const insert = env.DB.prepare('INSERT INTO risk_responses (id,survey_id,respondent_name,department,employee_id,is_anonymous,has_hazard,hazard_types_json,hazard_description,location,pre_likelihood,pre_severity,pre_risk_score,improvement_suggestion,post_likelihood,post_severity,post_risk_score,safe_reason,response_data,submitted_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT id FROM risk_surveys WHERE id=? AND updated_at=? AND is_active=1)')
      .bind(id,row.id,normalized.respondentName,normalized.department,normalized.employeeId,normalized.isAnonymous?1:0,normalized.hasHazard?1:0,JSON.stringify(normalized.hazardTypes),normalized.hazardDescription,normalized.location,normalized.preLikelihood,normalized.preSeverity,normalized.preRiskScore,normalized.improvementSuggestion,normalized.postLikelihood,normalized.postSeverity,normalized.postRiskScore,normalized.safeReason,JSON.stringify(normalized),submittedAt,row.id,row.updatedAt);
    const result = await insert.run();
    if (result.meta?.changes !== 1) throw new Error('SURVEY_CHANGED');
    return json({ ok: true, submittedAt }, 201);
  } catch (error) {
    if (['SURVEY_CHANGED','DUPLICATE_RESPONSE'].includes(error.message)) return errorResponse(error.message, 409);
    if (['INVALID_RESPONSE','INVALID_DEPARTMENT'].includes(error.message)) return errorResponse(error.message, 400);
    return errorResponse('INTERNAL_SERVER_ERROR', 500);
  }
}

function responseView(row) {
  const raw = JSON.parse(row.responseData || '{}');
  const extra = raw.schemaVersion === 2 ? { answers: raw.answers, questionSnapshot: (raw.questionSnapshot || []).filter(q=>q.type!=='photo'), revision: raw.revision } : {};
  return { ...extra, id: row.id, submittedAt: row.submittedAt, isAnonymous: Boolean(row.isAnonymous), respondentName: row.isAnonymous ? null : row.respondentName, department: row.isAnonymous ? null : row.department, employeeId: row.isAnonymous ? null : row.employeeId, hasHazard: raw.schemaVersion === 2 ? raw.hasHazard : Boolean(row.hasHazard), hazardTypes: JSON.parse(row.hazardTypesJson || '[]'), hazardDescription: row.hazardDescription, location: row.location, preLikelihood: row.preLikelihood, preSeverity: row.preSeverity, preRiskScore: row.preRiskScore, improvementSuggestion: row.improvementSuggestion, postLikelihood: row.postLikelihood, postSeverity: row.postSeverity, postRiskScore: row.postRiskScore, safeReason: row.safeReason };
}
const SELECT_RESPONSE = 'SELECT r.id,r.response_data AS responseData,r.respondent_name AS respondentName,r.department,r.employee_id AS employeeId,r.is_anonymous AS isAnonymous,r.has_hazard AS hasHazard,r.hazard_types_json AS hazardTypesJson,r.hazard_description AS hazardDescription,r.location,r.pre_likelihood AS preLikelihood,r.pre_severity AS preSeverity,r.pre_risk_score AS preRiskScore,r.improvement_suggestion AS improvementSuggestion,r.post_likelihood AS postLikelihood,r.post_severity AS postSeverity,r.post_risk_score AS postRiskScore,r.safe_reason AS safeReason,r.submitted_at AS submittedAt';

export async function adminResponses({ request, env, params }) {
  const rejected = methodGuard(request, ['GET']); if (rejected) return rejected;
  try {
    const owner = await authenticate(request, env); if (!owner) return errorResponse('UNAUTHENTICATED', 401);
    if (!UUID.test(params.id || '')) return errorResponse('NOT_FOUND', 404);
    const query = new URL(request.url).searchParams, rawLimit = query.get('limit') || '20', rawOffset = query.get('offset') || '0';
    if (!/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset) || Number(rawLimit) < 1 || !Number.isSafeInteger(Number(rawOffset))) return errorResponse('INVALID_FILTER', 400);
    const limit = Math.min(Number(rawLimit), 100), offset = Number(rawOffset);
    const survey = await env.DB.prepare('SELECT id FROM risk_surveys WHERE id=? AND owner_user_id=?').bind(params.id, owner).first(); if (!survey) return errorResponse('NOT_FOUND', 404);
    const rows = await env.DB.prepare(`${SELECT_RESPONSE} FROM risk_responses r WHERE r.survey_id=? ORDER BY r.submitted_at DESC,r.id DESC LIMIT ? OFFSET ?`).bind(params.id, limit + 1, offset).all();
    return json({ ok: true, responses: rows.results.slice(0, limit).map(responseView), hasMore: rows.results.length > limit, limit, offset });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function adminResponseItem({ request, env, params }) {
  const rejected = methodGuard(request, ['GET']); if (rejected) return rejected;
  try {
    const owner = await authenticate(request, env); if (!owner) return errorResponse('UNAUTHENTICATED', 401);
    if (!UUID.test(params.id || '') || !UUID.test(params.responseId || '')) return errorResponse('NOT_FOUND', 404);
    const row = await env.DB.prepare(`${SELECT_RESPONSE} FROM risk_responses r INNER JOIN risk_surveys s ON s.id=r.survey_id WHERE r.id=? AND r.survey_id=? AND s.owner_user_id=?`).bind(params.responseId, params.id, owner).first();
    return row ? json({ ok: true, response: responseView(row) }) : errorResponse('NOT_FOUND', 404);
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

function csvCell(value) {
  let text = value == null ? '' : Array.isArray(value) ? value.join(', ') : String(value);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export async function responseCsv({ request, env, params }) {
  const rejected = methodGuard(request, ['GET']); if (rejected) return rejected;
  try {
    const owner = await authenticate(request, env); if (!owner) return errorResponse('UNAUTHENTICATED', 401);
    if (!UUID.test(params.id || '')) return errorResponse('NOT_FOUND', 404);
    const survey = await env.DB.prepare('SELECT title FROM risk_surveys WHERE id=? AND owner_user_id=?').bind(params.id, owner).first(); if (!survey) return errorResponse('NOT_FOUND', 404);
    const rows = await env.DB.prepare(`${SELECT_RESPONSE} FROM risk_responses r WHERE r.survey_id=? ORDER BY r.submitted_at DESC,r.id DESC`).bind(params.id).all();
    const headers = ['제출일','이름','부서','사번','위험요인 여부','위험유형','위험상황','작업장소','개선 전 발생가능성','개선 전 중대성','개선 전 위험성','개선의견','개선 후 발생가능성','개선 후 중대성','개선 후 위험성','안전 사유'];
    const lines = [headers, ...rows.results.map(responseView).map(r => [r.submittedAt,r.isAnonymous?'익명':r.respondentName,r.isAnonymous?'':r.department,r.isAnonymous?'':r.employeeId,r.hasHazard?'있음':'없음',r.hazardTypes,r.hazardDescription,r.location,r.preLikelihood,r.preSeverity,r.preRiskScore,r.improvementSuggestion,r.postLikelihood,r.postSeverity,r.postRiskScore,r.safeReason])].map(row => row.map(csvCell).join(','));
    const filename = `risk-assessment_${kstToday()}.csv`;
    return new Response('\uFEFF' + lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(`위험성평가_${survey.title}_${kstToday()}.csv`)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}
