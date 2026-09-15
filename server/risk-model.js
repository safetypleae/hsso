import { DEFAULT_QUESTIONS, CUSTOM_TYPES, choiceType, multipleType, visibleQuestion, legacyQuestions } from '../assets/risk/schema.js';

export async function extensionsAvailable(env) {
  return Boolean(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind('risk_survey_metadata').first());
}
export async function surveyExtension(env, id, stored) {
  if (await extensionsAvailable(env)) {
    const meta = await env.DB.prepare('SELECT company_name AS companyName,departments_json AS departmentsJson,revision FROM risk_survey_metadata WHERE survey_id=?').bind(id).first();
    if (meta) return { schemaVersion: 2, companyName: meta.companyName, departments: JSON.parse(meta.departmentsJson), revision: meta.revision, questions: stored };
  }
  return { schemaVersion: 1, companyName: '', departments: [], revision: 0, questions: legacyQuestions(stored) };
}
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export function validDefinition(input) {
  if (input.schemaVersion !== 2 || !text(input.companyName, 200) || !Array.isArray(input.departments) || input.departments.length > 100 || input.departments.some(d => !text(d, 100) || d !== d.trim()) || new Set(input.departments).size !== input.departments.length) return false;
  if (input.settings.collectDepartment && !input.departments.length) return false;
  const questions = input.questions;
  if (!Array.isArray(questions) || !questions.length || questions.length > 30 || new Set(questions.map(q => q.id)).size !== questions.length) return false;
  return questions.every(q => {
    if (!q || !text(q.id, 50) || !/^[a-zA-Z0-9_-]+$/.test(q.id) || !text(q.text, 500) || typeof q.required !== 'boolean') return false;
    const special = DEFAULT_QUESTIONS.find(v => v.id === q.id);
    if (special ? q.type !== special.type : !q.id.startsWith('c_') || !Object.hasOwn(CUSTOM_TYPES, q.type)) return false;
    if (q.type === 'hazard_gate' && JSON.stringify(q.options) !== JSON.stringify(['예','아니오'])) return false;
    if (q.type === 'photo' && q.required && !input.settings.allowPhoto) return false;
    return !choiceType(q) || Array.isArray(q.options) && q.options.length > 0 && q.options.length <= 30 && q.options.every(v => text(v, 100) && v === v.trim()) && new Set(q.options).size === q.options.length;
  });
}

export function normalizeAnswers(input, definition, settings, photoCount) {
  if (!input || input.schemaVersion !== 2 || input.revision !== definition.revision || !input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers)) throw new Error('SURVEY_CHANGED');
  const allowed = ['schemaVersion','revision','answers','respondentName','department','employeeId','isAnonymous'];
  if (Object.keys(input).some(k => !allowed.includes(k)) || typeof input.isAnonymous !== 'boolean') throw new Error('INVALID_RESPONSE');
  if (input.isAnonymous && !settings.allowAnonymous) throw new Error('INVALID_RESPONSE');
  for (const key of ['respondentName','department','employeeId']) if (typeof (input[key] ?? '') !== 'string' || (input[key] || '').length > 300) throw new Error('INVALID_RESPONSE');
  if (!input.isAnonymous && settings.collectName && !input.respondentName?.trim()) throw new Error('INVALID_RESPONSE');
  if (!input.isAnonymous && settings.collectEmployeeId && !input.employeeId?.trim()) throw new Error('INVALID_RESPONSE');
  const department = (input.department || '').trim();
  if (definition.departments.length && department && !definition.departments.includes(department)) throw new Error('INVALID_DEPARTMENT');
  if (!definition.departments.length && department) throw new Error('INVALID_DEPARTMENT');
  if (!input.isAnonymous && settings.collectDepartment && definition.departments.length && !department) throw new Error('INVALID_DEPARTMENT');
  if (Object.keys(input.answers).some(id => !definition.questions.some(q => q.id === id && q.type !== 'photo'))) throw new Error('INVALID_RESPONSE');
  const answers = {};
  for (const q of definition.questions) {
    if (!visibleQuestion(q, definition.questions, input.answers, settings)) continue;
    const value = input.answers[q.id];
    if (q.type === 'photo') { if (q.required && !photoCount) throw new Error('PHOTO_REQUIRED'); continue; }
    const empty = value == null || value === '' || Array.isArray(value) && !value.length;
    if (empty) { if (q.required) throw new Error('INVALID_RESPONSE'); continue; }
    if (choiceType(q)) {
      if (multipleType(q)) { if (!Array.isArray(value) || value.length > q.options.length || new Set(value).size !== value.length || value.some(v => !q.options.includes(v))) throw new Error('INVALID_RESPONSE'); }
      else if (!q.options.includes(value)) throw new Error('INVALID_RESPONSE');
    } else if (['pre_risk','post_risk'].includes(q.type)) {
      if (!value || !Number.isInteger(value.likelihood) || value.likelihood < 1 || value.likelihood > 5 || !Number.isInteger(value.severity) || value.severity < 1 || value.severity > 4 || Object.keys(value).some(k => !['likelihood','severity'].includes(k))) throw new Error('INVALID_RESPONSE');
    } else if (!text(value, ['short_text','hazard_location'].includes(q.type) ? 300 : 5000)) throw new Error('INVALID_RESPONSE');
    answers[q.id] = value;
  }
  const hasHazard = answers.q1 ? answers.q1 === '예' : null;
  return { schemaVersion: 2, revision: definition.revision, questionSnapshot: definition.questions, answers,
    respondentName: input.isAnonymous || !settings.collectName ? null : input.respondentName?.trim() || null,
    department: input.isAnonymous || !settings.collectDepartment ? null : department || null,
    employeeId: input.isAnonymous || !settings.collectEmployeeId ? null : input.employeeId?.trim() || null, isAnonymous: input.isAnonymous,
    hasHazard, hazardTypes: answers.q2 || [], hazardDescription: answers.q3 || null, location: answers.q4 || null,
    preLikelihood: answers.q5?.likelihood ?? null, preSeverity: answers.q5?.severity ?? null, preRiskScore: answers.q5 ? answers.q5.likelihood * answers.q5.severity : null,
    improvementSuggestion: answers.q6 || null, postLikelihood: answers.q7?.likelihood ?? null, postSeverity: answers.q7?.severity ?? null,
    postRiskScore: answers.q7 ? answers.q7.likelihood * answers.q7.severity : null, safeReason: answers.safe_reason || null };
}
