import { json, errorResponse } from './auth-session.js';
import { requireCompanyAdmin } from './company-workspaces.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_BODY_BYTES = 32768;
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function guard(request, methods, mutations = []) {
  if (!methods.includes(request.method)) return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: methods.join(', ') });
  const origin = request.headers.get('Origin');
  if (mutations.includes(request.method) && origin !== null && origin !== new URL(request.url).origin) return errorResponse('ORIGIN_NOT_ALLOWED', 403);
  return null;
}

async function body(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('INVALID_CONTENT_TYPE');
  const value = await request.text();
  if (new TextEncoder().encode(value).byteLength > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
  try { return JSON.parse(value); } catch { throw new Error('INVALID_JSON'); }
}

function bodyError(error) {
  if (error.message === 'PAYLOAD_TOO_LARGE') return errorResponse('PAYLOAD_TOO_LARGE', 413);
  return errorResponse(error.message === 'INVALID_CONTENT_TYPE' ? 'INVALID_CONTENT_TYPE' : 'INVALID_JSON', 400);
}

const fields = ['departmentId','workProcess','hazardFactor','hazardSituation','currentMeasures','likelihood','severity','riskScore','reductionMeasures'];
function validFields(input, includeSource) {
  const keys = includeSource ? ['sourceResponseId', ...fields] : fields;
  return exact(input, keys) && (input.departmentId === null || UUID.test(input.departmentId || '')) &&
    text(input.workProcess, 500) && text(input.hazardFactor, 1000) && text(input.hazardSituation, 5000) &&
    text(input.currentMeasures, 5000) && Number.isInteger(input.likelihood) && input.likelihood >= 1 && input.likelihood <= 5 &&
    Number.isInteger(input.severity) && input.severity >= 1 && input.severity <= 4 &&
    (input.riskScore === null || Number.isInteger(input.riskScore)) && text(input.reductionMeasures, 5000) &&
    (!includeSource || input.sourceResponseId === null || UUID.test(input.sourceResponseId || ''));
}

const ITEM_SELECT = `SELECT i.id,i.company_id AS companyId,i.department_id AS departmentId,i.department_name AS departmentName,
  i.source_response_id AS sourceResponseId,i.source_survey_id AS sourceSurveyId,i.work_process AS workProcess,i.hazard_factor AS hazardFactor,
  i.hazard_situation AS hazardSituation,i.current_measures AS currentMeasures,i.likelihood,i.severity,i.risk_score AS riskScore,
  i.reduction_measures AS reductionMeasures,i.created_by_user_id AS createdBy,i.updated_by_user_id AS updatedBy,
  i.created_at AS createdAt,i.updated_at AS updatedAt,r.location AS sourceLocation,r.hazard_types_json AS sourceHazardTypesJson,
  r.hazard_description AS sourceHazardDescription,r.improvement_suggestion AS sourceImprovementSuggestion,r.department AS sourceDepartment,
  r.submitted_at AS sourceSubmittedAt,ir.id AS improvementRequestId,ir.status AS improvementStatus,ir.department_name_snapshot AS improvementDepartmentName,ir.due_date AS improvementDueDate`;

function itemView(row) {
  const item = { id: row.id, companyId: row.companyId, departmentId: row.departmentId, departmentName: row.departmentName,
    sourceType: row.sourceResponseId ? 'SURVEY' : 'DIRECT', sourceResponseId: row.sourceResponseId, sourceSurveyId: row.sourceSurveyId,
    workProcess: row.workProcess, hazardFactor: row.hazardFactor, hazardSituation: row.hazardSituation, currentMeasures: row.currentMeasures,
    likelihood: row.likelihood, severity: row.severity, riskScore: row.riskScore, reductionMeasures: row.reductionMeasures,
    createdBy: row.createdBy, updatedBy: row.updatedBy, createdAt: row.createdAt, updatedAt: row.updatedAt,
    improvement: row.improvementRequestId ? { id: row.improvementRequestId, status: row.improvementStatus, departmentName: row.improvementDepartmentName, dueDate: row.improvementDueDate } : null };
  item.source = row.sourceResponseId ? { responseId: row.sourceResponseId, surveyId: row.sourceSurveyId, department: row.sourceDepartment,
    location: row.sourceLocation, hazardTypes: JSON.parse(row.sourceHazardTypesJson || '[]'), hazardDescription: row.sourceHazardDescription,
    improvementSuggestion: row.sourceImprovementSuggestion, submittedAt: row.sourceSubmittedAt } : null;
  return item;
}

async function department(env, companyId, departmentId) {
  if (!departmentId) return null;
  return env.DB.prepare("SELECT id,name FROM company_departments WHERE id=? AND company_id=? AND status='active'").bind(departmentId, companyId).first();
}

async function access(request, env, companyId) {
  try { return await requireCompanyAdmin(request, env, companyId); } catch { return { response: errorResponse('INTERNAL_SERVER_ERROR', 500) }; }
}

export async function assessmentItemCollection({ request, env, params }) {
  const rejected = guard(request, ['GET','POST'], ['POST']); if (rejected) return rejected;
  const allowed = await access(request, env, params.companyId); if (allowed.response) return allowed.response;
  try {
    if (request.method === 'GET') {
      const query = new URL(request.url).searchParams;
      if ([...query.keys()].some(key => !['department','source','limit','offset'].includes(key)) || [...query.keys()].some(key => query.getAll(key).length !== 1)) return errorResponse('INVALID_FILTER', 400);
      const departmentName = query.get('department') || '', source = query.get('source') || '', rawLimit = query.get('limit') || '50', rawOffset = query.get('offset') || '0';
      if (departmentName.length > 100 || !['','SURVEY','DIRECT'].includes(source) || !/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset) || Number(rawLimit) < 1 || !Number.isSafeInteger(Number(rawOffset))) return errorResponse('INVALID_FILTER', 400);
      const clauses = ['i.company_id=?'], bindings = [params.companyId];
      if (departmentName) { clauses.push('i.department_name=?'); bindings.push(departmentName); }
      if (source) clauses.push(source === 'SURVEY' ? 'i.source_response_id IS NOT NULL' : 'i.source_response_id IS NULL');
      const limit = Math.min(Number(rawLimit), 100), offset = Number(rawOffset);
      const rows = await env.DB.prepare(`${ITEM_SELECT} FROM risk_assessment_items i LEFT JOIN risk_responses r ON r.id=i.source_response_id LEFT JOIN risk_improvement_requests ir ON ir.risk_assessment_item_id=i.id
        WHERE ${clauses.join(' AND ')} ORDER BY i.updated_at DESC,i.id DESC LIMIT ? OFFSET ?`).bind(...bindings, limit + 1, offset).all();
      const departments = await env.DB.prepare(`SELECT id,name FROM company_departments WHERE company_id=? AND status='active' ORDER BY name,id`).bind(params.companyId).all();
      const itemDepartments = await env.DB.prepare("SELECT DISTINCT department_name AS name FROM risk_assessment_items WHERE company_id=? AND department_name<>'' ORDER BY department_name").bind(params.companyId).all();
      return json({ ok: true, items: rows.results.slice(0, limit).map(itemView), departments: departments.results,
        departmentNames: [...new Set([...departments.results.map(row => row.name), ...itemDepartments.results.map(row => row.name)])], hasMore: rows.results.length > limit, limit, offset });
    }
    let input; try { input = await body(request); } catch (error) { return bodyError(error); }
    if (!validFields(input, true)) return errorResponse('INVALID_ASSESSMENT_ITEM', 400);
    let selectedDepartment = await department(env, params.companyId, input.departmentId);
    if (input.departmentId && !selectedDepartment) return errorResponse('DEPARTMENT_NOT_AVAILABLE', 400);
    const id = crypto.randomUUID(), now = new Date().toISOString(), score = input.likelihood * input.severity;
    const values = [id, params.companyId, input.departmentId, '', input.workProcess.trim(), input.hazardFactor.trim(), input.hazardSituation.trim(), input.currentMeasures.trim(), input.likelihood, input.severity, score, input.reductionMeasures.trim(), allowed.userId, allowed.userId, now, now];
    let result;
    try {
      if (input.sourceResponseId) {
        const source = await env.DB.prepare(`SELECT rv.response_id AS responseId,rv.survey_id AS surveyId,rv.review_status AS reviewStatus,r.department
          FROM risk_response_reviews rv INNER JOIN risk_responses r ON r.id=rv.response_id AND r.survey_id=rv.survey_id
          INNER JOIN risk_survey_company_scopes scope ON scope.survey_id=rv.survey_id AND scope.company_id=rv.company_id
          WHERE rv.response_id=? AND rv.company_id=? LIMIT 1`).bind(input.sourceResponseId, params.companyId).first();
        if (!source) return errorResponse('SOURCE_NOT_FOUND', 404);
        if (source.reviewStatus !== 'ACCEPTED') return errorResponse('SOURCE_NOT_ACCEPTED', 409);
        if (!selectedDepartment && source.department) selectedDepartment = await env.DB.prepare("SELECT id,name FROM company_departments WHERE company_id=? AND status='active' AND name=? LIMIT 1").bind(params.companyId, source.department).first();
        values[2] = selectedDepartment?.id || null; values[3] = selectedDepartment?.name || source.department || '';
        result = await env.DB.prepare(`INSERT INTO risk_assessment_items (id,company_id,department_id,department_name,source_response_id,source_survey_id,work_process,hazard_factor,hazard_situation,current_measures,likelihood,severity,risk_score,reduction_measures,created_by_user_id,updated_by_user_id,created_at,updated_at)
          SELECT ?,?,?,?,rv.response_id,rv.survey_id,?,?,?,?,?,?,?,?,?,?,?,? FROM risk_response_reviews rv
          WHERE rv.response_id=? AND rv.company_id=? AND rv.review_status='ACCEPTED'`)
          .bind(values[0],values[1],values[2],values[3],...values.slice(4),input.sourceResponseId,params.companyId).run();
        if (!result.success || result.meta?.changes !== 1) return errorResponse('SOURCE_NOT_ACCEPTED', 409);
      } else {
        if (!selectedDepartment) return errorResponse('DEPARTMENT_REQUIRED', 400);
        values[3] = selectedDepartment.name;
        result = await env.DB.prepare(`INSERT INTO risk_assessment_items (id,company_id,department_id,department_name,work_process,hazard_factor,hazard_situation,current_measures,likelihood,severity,risk_score,reduction_measures,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...values).run();
      }
    } catch (error) {
      if (/unique/i.test(String(error.message))) return errorResponse('SOURCE_ALREADY_CONVERTED', 409);
      throw error;
    }
    if (!result.success || result.meta?.changes !== 1) throw new Error('insert');
    const row = await env.DB.prepare(`${ITEM_SELECT} FROM risk_assessment_items i LEFT JOIN risk_responses r ON r.id=i.source_response_id LEFT JOIN risk_improvement_requests ir ON ir.risk_assessment_item_id=i.id WHERE i.id=? AND i.company_id=?`).bind(id, params.companyId).first();
    return json({ ok: true, item: itemView(row) }, 201);
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function assessmentItem({ request, env, params }) {
  const rejected = guard(request, ['GET','PATCH','DELETE'], ['PATCH','DELETE']); if (rejected) return rejected;
  const allowed = await access(request, env, params.companyId); if (allowed.response) return allowed.response;
  if (!UUID.test(params.itemId || '')) return errorResponse('NOT_FOUND', 404);
  try {
    const existing = await env.DB.prepare(`${ITEM_SELECT} FROM risk_assessment_items i LEFT JOIN risk_responses r ON r.id=i.source_response_id LEFT JOIN risk_improvement_requests ir ON ir.risk_assessment_item_id=i.id WHERE i.id=? AND i.company_id=?`).bind(params.itemId, params.companyId).first();
    if (!existing) return errorResponse('NOT_FOUND', 404);
    if (request.method === 'GET') return json({ ok: true, item: itemView(existing) });
    if (request.method === 'DELETE') {
      if (existing.improvementRequestId) return errorResponse('IMPROVEMENT_REQUEST_EXISTS', 409);
      const result = await env.DB.prepare('DELETE FROM risk_assessment_items WHERE id=? AND company_id=?').bind(params.itemId, params.companyId).run();
      return result.success && result.meta?.changes === 1 ? json({ ok: true }) : errorResponse('NOT_FOUND', 404);
    }
    let input; try { input = await body(request); } catch (error) { return bodyError(error); }
    if (!validFields(input, false)) return errorResponse('INVALID_ASSESSMENT_ITEM', 400);
    const selectedDepartment = await department(env, params.companyId, input.departmentId);
    if (input.departmentId && !selectedDepartment) return errorResponse('DEPARTMENT_NOT_AVAILABLE', 400);
    if (!existing.sourceResponseId && !selectedDepartment) return errorResponse('DEPARTMENT_REQUIRED', 400);
    const departmentName = selectedDepartment?.name || existing.departmentName, now = new Date().toISOString(), score = input.likelihood * input.severity;
    const result = await env.DB.prepare(`UPDATE risk_assessment_items SET department_id=?,department_name=?,work_process=?,hazard_factor=?,hazard_situation=?,current_measures=?,likelihood=?,severity=?,risk_score=?,reduction_measures=?,updated_by_user_id=?,updated_at=? WHERE id=? AND company_id=?`)
      .bind(input.departmentId,departmentName,input.workProcess.trim(),input.hazardFactor.trim(),input.hazardSituation.trim(),input.currentMeasures.trim(),input.likelihood,input.severity,score,input.reductionMeasures.trim(),allowed.userId,now,params.itemId,params.companyId).run();
    if (!result.success || result.meta?.changes !== 1) return errorResponse('NOT_FOUND', 404);
    const row = await env.DB.prepare(`${ITEM_SELECT} FROM risk_assessment_items i LEFT JOIN risk_responses r ON r.id=i.source_response_id LEFT JOIN risk_improvement_requests ir ON ir.risk_assessment_item_id=i.id WHERE i.id=? AND i.company_id=?`).bind(params.itemId, params.companyId).first();
    return json({ ok: true, item: itemView(row) });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}
