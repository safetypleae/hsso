import {
  REGULATORY_COVERAGE_V1,
  REGULATORY_EXACT_ENTRIES_V1,
  REGULATORY_GROUP_RULES_V1,
  REGULATORY_OFFICIAL_ITEMS_V1,
} from './regulatory-master-v1-data.js';

export { REGULATORY_COVERAGE_V1, REGULATORY_OFFICIAL_ITEMS_V1 };

export const REGULATORY_MASTER_VERSION = 'KR-OSH-2026-09-22-v1';

export const REGULATORY_CATEGORIES = Object.freeze({
  MANAGED: { label: '관리대상 유해물질', law: '산업안전보건기준에 관한 규칙', provision: '제420조 및 별표 12', effectiveDate: '2026-03-02', sourceUrl:'https://www.law.go.kr/법령별표서식/(산업안전보건기준에관한규칙,20260302,별표12)' },
  SPECIAL_MANAGED: { label: '특별관리물질', law: '산업안전보건기준에 관한 규칙', provision: '제420조제6호 및 별표 12', effectiveDate: '2026-03-02', sourceUrl:'https://www.law.go.kr/법령별표서식/(산업안전보건기준에관한규칙,20260302,별표12)' },
  WORK_ENVIRONMENT: { label: '작업환경측정', law: '산업안전보건법 시행규칙', provision: '제186조 및 별표 21', effectiveDate: '2026-08-01', sourceUrl:'https://www.law.go.kr/법령별표서식/(산업안전보건법시행규칙,20260801,별표21)' },
  SPECIAL_HEALTH: { label: '특수건강진단', law: '산업안전보건법 시행규칙', provision: '제201조 및 별표 22', effectiveDate: '2026-08-01', sourceUrl:'https://www.law.go.kr/법령별표서식/(산업안전보건법시행규칙,20260801,별표22)' },
});

export const REGULATORY_MASTER_V1 = Object.freeze({
  version: REGULATORY_MASTER_VERSION,
  verifiedAt: '2026-09-22',
  sources: Object.values(REGULATORY_CATEGORIES),
  entries: REGULATORY_EXACT_ENTRIES_V1,
  groupRules: REGULATORY_GROUP_RULES_V1,
  officialItems: REGULATORY_OFFICIAL_ITEMS_V1,
  coverage: REGULATORY_COVERAGE_V1,
  knownNonRegulatedCas: [
    '7732-18-5','7647-14-5','7778-54-3','9004-70-0','68038-05-1','6422-86-2','616-38-6',
    '1305-62-0','74-98-6','106-97-8','1333-86-4','60304-36-1','64-02-8','115-10-6','25068-38-6',
    '68953-36-6','112-57-2','90-72-2','69430-35-9','68515-73-1','9005-64-5','7439-98-7',
  ],
});

const normalizeName = value => String(value || '').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[\s()'’,.;:_-]+/gu,'');
const ingredientNameKeys = ingredient => [ingredient.chemicalName, ingredient.synonym].filter(Boolean).map(normalizeName);
const containsAlias = (ingredient, aliases, partial = false) => ingredientNameKeys(ingredient).some(name => aliases.some(alias => partial ? name.includes(normalizeName(alias)) : name === normalizeName(alias)));
const containsGroupAlias = (ingredient, aliases) => [ingredient.chemicalName,ingredient.synonym].filter(Boolean).some(value => {
  const raw=String(value).normalize('NFKC').toLocaleLowerCase('ko-KR');
  return aliases.some(alias => {
    const candidate=String(alias).normalize('NFKC').toLocaleLowerCase('ko-KR');
    if (/^[a-z0-9 .,'-]+$/u.test(candidate)) {
      const escaped=candidate.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`,'u').test(raw);
    }
    return normalizeName(raw).includes(normalizeName(candidate));
  });
});

function percentRange(raw) {
  const text = String(raw || '').replaceAll(',','.');
  const numbers = [...text.matchAll(/\d+(?:\.\d+)?/g)].map(match => Number(match[0])).filter(Number.isFinite);
  if (!numbers.length) return null;
  const min = Math.min(...numbers), max = Math.max(...numbers);
  if (/미만/u.test(text) && numbers.length > 1) return { min, max, upperExclusive:true };
  if (/(?:미만|<)/u.test(text) && numbers.length === 1) return { min:0, max, upperExclusive:true };
  if (/(?:이하|≤)/u.test(text) && numbers.length === 1) return { min:0, max, upperExclusive:false };
  if (/(?:이상|초과|>|≥)/u.test(text) && numbers.length === 1) return { min, max:Infinity, upperExclusive:false };
  return { min, max, upperExclusive:false };
}

function amountDecision(raw, minimumPercent) {
  const range = percentRange(raw);
  if (!range) return { state:'REVIEW_REQUIRED', reasonCode:'AMOUNT_AMBIGUOUS', reason:'MSDS 원문 함유량을 수치 조건과 안전하게 비교할 수 없습니다.' };
  if (range.min >= minimumPercent) return { state:'MATCH' };
  if (range.max < minimumPercent || (range.max === minimumPercent && range.upperExclusive)) return { state:'NO_MATCH' };
  return { state:'REVIEW_REQUIRED', reasonCode:'AMOUNT_AMBIGUOUS', reason:`함유량 범위가 법령상 ${minimumPercent}% 기준을 걸치므로 실제 함유량 확인이 필요합니다.` };
}

const evidence = (ingredient, rule, category, state, reason, matchBasis, reasonCode = null) => ({
  state,
  ingredientId: ingredient.id || null,
  chemicalName: ingredient.chemicalName,
  synonym: ingredient.synonym || null,
  casValue: ingredient.casValue || null,
  casStatus: ingredient.casStatus,
  amountRaw: ingredient.amountRaw,
  legalName: rule.legalName,
  matchedList: REGULATORY_CATEGORIES[category].label,
  matchBasis,
  legalBasis: `${REGULATORY_CATEGORIES[category].law} ${REGULATORY_CATEGORIES[category].provision}`,
  conditionText: rule.conditionText || rule.categories?.[category]?.conditionText || `혼합물 중 ${rule.categories?.[category]?.minimumPercent ?? 1}% 이상`,
  reasonCode: reasonCode || rule.reasonCode || null,
  reason: reason || null,
});

export function evaluateRegulatory(ingredients, { versionId = null } = {}) {
  const rows = Array.isArray(ingredients) ? ingredients : [], result = {};
  for (const category of Object.keys(REGULATORY_CATEGORIES)) result[category] = { state:'NO_MATCH', matches:[], reviews:[] };
  const reviewed = rows.filter(row => row.reviewStatus === 'REVIEWED' || row.reviewStatus === 'MANUALLY_ADDED');
  const pending = rows.filter(row => row.reviewStatus === 'AUTO_EXTRACTED');
  const globalReview = [];
  if (!reviewed.length) globalReview.push({ code:'IDENTITY_NOT_REVIEWED', reason:'검토 완료된 구성성분이 없어 비해당으로 확정할 수 없습니다.' });
  if (pending.length) globalReview.push({ code:'IDENTITY_NOT_REVIEWED', reason:'검토되지 않은 자동 추출 구성성분이 있습니다.' });

  for (const ingredient of reviewed) {
    let identified = false;
    const exactCategories = new Set();
    const exactMatchCategories = new Set();
    if (ingredient.casStatus !== 'KNOWN' || ingredient.tradeSecret) {
      globalReview.push({
        code:'TRADE_SECRET_OR_IDENTITY_UNKNOWN',
        reason: ingredient.tradeSecret || ingredient.casStatus === 'TRADE_SECRET'
          ? `${ingredient.chemicalName}: 영업비밀 성분의 식별정보를 확인해야 합니다.`
          : `${ingredient.chemicalName}: CAS가 없어 명칭과 물질군을 추가 확인해야 합니다.`,
      });
    }

    for (const rule of REGULATORY_MASTER_V1.entries) {
      const casMatch = ingredient.casStatus === 'KNOWN' && rule.identifiers.some(identifier => identifier.type === 'CAS' && identifier.value === ingredient.casValue);
      const exactNames = rule.matchLegalName === false ? rule.aliases : [rule.legalName, ...rule.aliases];
      const nameMatch = containsAlias(ingredient, exactNames);
      if (!casMatch && !nameMatch) continue;
      identified = true;
      for (const [category, condition] of Object.entries(rule.categories)) {
        exactCategories.add(category);
        const amount = amountDecision(ingredient.amountRaw, condition.minimumPercent);
        const item = evidence(ingredient, rule, category, amount.state, amount.reason, casMatch ? 'CAS' : '법령상 물질명/동의어', amount.reasonCode);
        if (amount.state === 'MATCH') {
          result[category].matches.push(item);
          exactMatchCategories.add(category);
        }
        else if (amount.state === 'REVIEW_REQUIRED') result[category].reviews.push(item);
      }
    }

    for (const rule of REGULATORY_MASTER_V1.groupRules) {
      const groupCasMatch=ingredient.casStatus === 'KNOWN' && rule.identifiers?.includes(ingredient.casValue);
      if (!groupCasMatch && !containsGroupAlias(ingredient, [rule.legalName, ...rule.aliases])) continue;
      identified = true;
      for (const category of rule.categories) {
        if (exactMatchCategories.has(category) || (exactCategories.has(category) && !rule.allowAfterExactNoMatch)) continue;
        if (rule.minimumPercent != null) {
          const amount=amountDecision(ingredient.amountRaw,rule.minimumPercent);
          if (amount.state === 'NO_MATCH') continue;
          if (amount.state === 'REVIEW_REQUIRED') {
            result[category].reviews.push(evidence(ingredient,rule,category,'REVIEW_REQUIRED',amount.reason,groupCasMatch?'CAS 후보':'물질군 명칭 후보',amount.reasonCode));
            continue;
          }
        }
        result[category].reviews.push(evidence(ingredient, rule, category, 'REVIEW_REQUIRED', rule.basisExplanation, groupCasMatch ? 'CAS 후보' : '물질군 명칭 후보', rule.reasonCode));
      }
    }

    if (!identified && ingredient.casStatus === 'KNOWN' && !REGULATORY_MASTER_V1.knownNonRegulatedCas.includes(ingredient.casValue)) {
      globalReview.push({ code:'MASTER_GAP', reason:`${ingredient.chemicalName}: Master v1의 공식 개별 identity 또는 분류된 물질군과 일치하지 않아 추가 확인이 필요합니다.` });
    }
  }

  for (const value of Object.values(result)) {
    if (value.matches.length) value.state = 'MATCH';
    else if (value.reviews.length || globalReview.length) value.state = 'REVIEW_REQUIRED';
    value.reviewReasons = [...new Set([...globalReview.map(item => item.reason), ...value.reviews.map(item => item.reason).filter(Boolean)])];
    value.reviewDetails = [
      ...globalReview,
      ...value.reviews.filter(item => item.reason).map(item => ({ code:item.reasonCode, reason:item.reason, ingredientId:item.ingredientId, casValue:item.casValue })),
    ];
  }
  return { masterVersion:REGULATORY_MASTER_VERSION, versionId, evaluatedFrom:'CURRENT_VERSION_REVIEWED_INGREDIENTS', categories:result };
}
