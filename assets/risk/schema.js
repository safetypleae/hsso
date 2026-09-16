export const CUSTOM_TYPES = { single_choice: '객관식', multiple_choice: '체크박스', dropdown: '드롭다운', short_text: '단답형', long_text: '장문형' };
export const LIKELIHOOD = ['매우낮음', '낮음', '보통', '높음', '매우높음'];
export const SEVERITY = ['비치료', '병원치료(통원)', '병원치료(입원)', '사망'];
export const DEFAULT_QUESTIONS = [
  { id: 'q1', type: 'hazard_gate', text: '현재 작업 중 위험요인이 있다고 생각하십니까?', options: ['예', '아니오'] },
  { id: 'q2', type: 'hazard_types', text: '어떤 위험요인에 해당합니까?', options: ['추락','미끄러짐·넘어짐','끼임','부딪힘','낙하·비래','화재·폭발','전기','화학물질','근골격계','차량·지게차','기타'] },
  { id: 'q3', type: 'hazard_description', text: '위험한 상황을 구체적으로 작성해주세요.' },
  { id: 'q4', type: 'hazard_location', text: '위험 장소를 작성해주세요.', description: '위험요인이 있는 위치를 건물명, 층, 구역 등 구체적으로 작성해주세요.' },
  { id: 'q5', type: 'pre_risk', text: '개선 전 위험성' },
  { id: 'q6', type: 'improvement', text: '어떻게 개선하면 좋을지 의견을 작성해주세요.' },
  { id: 'q7', type: 'post_risk', text: '개선 후 예상 위험성' },
  { id: 'safe_reason', type: 'safe_reason', text: '현재 작업환경이 안전하다고 생각하는 가장 큰 이유는 무엇입니까?', options: ['작업절차가 잘 지켜지고 있다','보호구가 적절하게 지급·착용되고 있다','설비 및 작업장 상태가 양호하다','위험요인에 대한 개선조치가 잘 이루어지고 있다','관리감독자의 안전관리가 잘 이루어지고 있다','안전교육이 충분하다','동료 간 안전수칙 준수가 잘 이루어지고 있다','위험한 작업이 많지 않다','기타'] }
].map(q => ({ required: true, options: [], ...q }));
export function legacyQuestions(stored = []) {
  // Older public forms always displayed the complete fixed template, even if JSON was partial.
  return DEFAULT_QUESTIONS.map(base => {
    const old = stored.find(q => q.id === base.id);
    return { ...base, text: old?.text || base.text, description: old?.description ?? base.description ?? '', options: old?.options?.length ? old.options : base.options };
  });
}
export function choiceType(q) { return ['single_choice','multiple_choice','dropdown','hazard_gate','hazard_types','safe_reason'].includes(q.type); }
export function multipleType(q) { return ['multiple_choice', 'hazard_types'].includes(q.type); }
export function visibleQuestion(q, questions, answers, settings) {
  if (!questions.some(v => v.id === 'q1')) return true;
  if (q.id === 'safe_reason') return answers.q1 === '아니오';
  if (/^q[2-7]$/.test(q.id)) return answers.q1 === '예';
  return true;
}
export function legacyAnswers(r) {
  return { q1: r.hasHazard == null ? '' : r.hasHazard ? '예' : '아니오', q2: r.hazardTypes || [], q3: r.hazardDescription || '', q4: r.location || '',
    q5: r.preLikelihood == null ? null : { likelihood: r.preLikelihood, severity: r.preSeverity }, q6: r.improvementSuggestion || '',
    q7: r.postLikelihood == null ? null : { likelihood: r.postLikelihood, severity: r.postSeverity }, safe_reason: r.safeReason || '' };
}
export function questionKey(q) { return JSON.stringify([q.id, q.type, q.text, q.options || []]); }
