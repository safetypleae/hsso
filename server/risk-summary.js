import { DEFAULT_QUESTIONS, CUSTOM_TYPES, multipleType, choiceType, legacyAnswers, questionKey, LIKELIHOOD, SEVERITY } from '../assets/risk/schema.js';

export function questionVariants(questions, responses) {
  const current = questions.map(q => ({ ...q, key: questionKey(q), archived: false })), seen = new Set(current.map(q => q.key));
  for (const r of responses) for (const q of r.questionSnapshot || []) {
    const key = questionKey(q); if (!seen.has(key)) { seen.add(key); current.push({ ...q, key, archived: true }); }
  }
  return current;
}
function distribution(values, options) {
  const counts = new Map(options.map(v => [String(v), 0]));
  for (const value of values) for (const v of new Set(Array.isArray(value) ? value : [String(value)])) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count, percent: values.length ? Math.round(count / values.length * 1000) / 10 : 0 }));
}
export function summarize(questions, responses) {
  return questionVariants(questions, responses).map(q => {
    const type = DEFAULT_QUESTIONS.find(v => v.id === q.id)?.type || q.type;
    const definition = { ...q, type };
    const eligible = responses.filter(r => !r.questionSnapshot || r.questionSnapshot.some(old => questionKey(old) === q.key));
    const values = eligible.map(r => (r.answers || legacyAnswers(r))[q.id]).filter(v => v != null && v !== '' && (!Array.isArray(v) || v.length));
    const result = { id: q.id, key: q.key, title: q.text + (q.archived ? ' (이전 문항)' : ''), archived: q.archived, answered: values.length };
    if (type === 'photo') return { ...result, kind: 'photos', answered: eligible.filter(r => r.photos?.length).length, photos: eligible.flatMap(r => (r.photos || []).map(p => ({ ...p, submittedAt: r.submittedAt }))) };
    if (['pre_risk', 'post_risk'].includes(type)) {
      const ratings = values.filter(v => v.likelihood != null && v.severity != null), scores = ratings.map(v => v.likelihood * v.severity);
      return { ...result, kind: 'score', answered: ratings.length, average: scores.length ? Math.round(scores.reduce((sum, v) => sum + v, 0) / scores.length * 100) / 100 : null,
        distribution: distribution(scores, Array.from({ length: 20 }, (_, i) => i + 1)),
        dimensions: [
          { id: q.id + '-likelihood', title: '발생가능성 분포', kind: 'choice', answered: ratings.length, distribution: distribution(ratings.map(v => `${v.likelihood} · ${LIKELIHOOD[v.likelihood - 1]}`), LIKELIHOOD.map((v,i) => `${i+1} · ${v}`)) },
          { id: q.id + '-severity', title: '중대성 분포', kind: 'choice', answered: ratings.length, distribution: distribution(ratings.map(v => `${v.severity} · ${SEVERITY[v.severity - 1]}`), SEVERITY.map((v,i) => `${i+1} · ${v}`)) }
        ] };
    }
    if (choiceType(definition)) return { ...result, kind: multipleType(definition) ? 'multiple' : 'choice', distribution: distribution(values, q.options || []) };
    if (Object.hasOwn(CUSTOM_TYPES, type) || ['hazard_description','hazard_location','improvement'].includes(type)) return { ...result, kind: 'text', answers: values };
    return { ...result, kind: 'unsupported', note: '연결되지 않은 문항입니다.' };
  });
}
