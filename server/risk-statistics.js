import { json, errorResponse } from './auth-session.js';
import { authenticate } from './documents.js';
import { SELECT_RESPONSE, responseView } from './risk-surveys.js';
import { riskWorkbook } from './risk-xlsx.js';
import { surveyExtension, extensionsAvailable } from './risk-model.js';
import { summarize, questionVariants } from './risk-summary.js';
import { CUSTOM_TYPES, legacyQuestions, questionKey } from '../assets/risk/schema.js';
export { summarize as summarizeQuestions } from './risk-summary.js';

async function loadResults({ request, env, params }) {
  if (request.method !== 'GET') return { error: json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' }) };
  const owner = await authenticate(request, env); if (!owner) return { error: errorResponse('UNAUTHENTICATED', 401) };
  if (!/^[a-f0-9-]{36}$/.test(params.id || '')) return { error: errorResponse('NOT_FOUND', 404) };
  const survey = await env.DB.prepare('SELECT id,title,questions_json AS questionsJson FROM risk_surveys WHERE id=? AND owner_user_id=?').bind(params.id, owner).first();
  if (!survey) return { error: errorResponse('NOT_FOUND', 404) };
  Object.assign(survey, await surveyExtension(env, survey.id, JSON.parse(survey.questionsJson)));
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => !['department','company','workplace'].includes(key)) || ['department','company','workplace'].some(key => query.getAll(key).length > 1)) return { error: errorResponse('INVALID_FILTER', 400) };
  const department = query.get('department') || '', company = query.get('company') || '';
  if (query.get('workplace')) return { error: errorResponse('WORKPLACE_FILTER_UNSUPPORTED', 400) };
  if (department.length > 300 || company.length > 200) return { error: errorResponse('INVALID_FILTER', 400) };
  const bindings = [survey.id]; let where = 'r.survey_id=?';
  if (department) { where += ' AND r.is_anonymous=0 AND r.department=?'; bindings.push(department); }
  if (company && company !== survey.companyName) where += ' AND 1=0';
  const rows = await env.DB.prepare(SELECT_RESPONSE + ' FROM risk_responses r WHERE ' + where + ' ORDER BY r.submitted_at DESC,r.id DESC').bind(...bindings).all();
  let originalQuestions = legacyQuestions(JSON.parse(survey.questionsJson));
  if (await extensionsAvailable(env)) {
    const original = await env.DB.prepare('SELECT definition_json FROM risk_survey_versions WHERE survey_id=? AND revision=0').bind(survey.id).first();
    if (original) originalQuestions = JSON.parse(original.definition_json).questions;
  }
  const responses = rows.results.map(responseView).map(r => ({ ...r, questionSnapshot: r.questionSnapshot || originalQuestions }));
  return { survey, responses, filters: { department, company } };
}

export async function surveyStatistics(context) {
  try {
    const data = await loadResults(context); if (data.error) return data.error;
    const departments = await context.env.DB.prepare("SELECT DISTINCT department FROM risk_responses WHERE survey_id=? AND is_anonymous=0 AND department IS NOT NULL AND department<>'' ORDER BY department").bind(data.survey.id).all();
    return json({ ok: true, survey: { id: data.survey.id, title: data.survey.title, companyName: data.survey.companyName }, total: data.responses.length,
      filters: data.filters, availableFilters: { workplaceSupported: false, companies: data.survey.companyName ? [data.survey.companyName] : [], departments: [...new Set([...data.survey.departments, ...departments.results.map(r => r.department)])] },
      questions: summarize(data.survey.questions, data.responses) });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function responseXlsx(context) {
  try {
    const data = await loadResults(context); if (data.error) return data.error;
    const custom = questionVariants(data.survey.questions, data.responses).filter(q => Object.hasOwn(CUSTOM_TYPES, q.type));
    const headers = ['응답 ID','제출일시 (UTC)','이름','부서','사번','익명 응답','위험요인 여부','위험유형 (복수 선택)','위험상황','작업장소','개선 전 발생가능성','개선 전 중대성','개선 전 위험성','개선의견','개선 후 예상 발생가능성','개선 후 예상 중대성','개선 후 예상 위험성','안전 사유', '회사명', ...custom.map(q => q.text + (q.archived ? ' (이전 문항)' : '') + ' [' + q.id + ']')];
    const rows = data.responses.map(r => [r.id,r.submittedAt,r.isAnonymous?'익명':r.respondentName,r.department,r.employeeId,r.isAnonymous?'예':'아니오',r.hasHazard==null?'':r.hasHazard?'예':'아니오',r.hazardTypes.join(', '),r.hazardDescription,r.location,r.preLikelihood,r.preSeverity,r.preRiskScore,r.improvementSuggestion,r.postLikelihood,r.postSeverity,r.postRiskScore,r.safeReason,data.survey.companyName || '회사 미등록',
      ...custom.map(q => r.questionSnapshot.some(old => questionKey(old) === q.key) ? (Array.isArray(r.answers?.[q.id]) ? r.answers[q.id].join(', ') : r.answers?.[q.id] ?? '') : '')]);
    const filename = '위험성평가_' + data.survey.title.slice(0,80) + '_' + (data.filters.department || '전체').slice(0,60) + '.xlsx';
    return new Response(riskWorkbook(headers, rows), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="risk-responses.xlsx"; filename*=UTF-8\'\'' + encodeURIComponent(filename), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}
