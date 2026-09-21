const clean = value => String(value || '').replace(/\s+/gu, ' ').trim();
const compact = value => clean(value).normalize('NFKC').toLowerCase().replace(/[\s·ㆍ・:：|()（）.[\]{}\-–—_/]/gu, '');
const rawLine = line => clean(typeof line === 'string' ? line : line?.rawText || line?.text || '');
const NO_VALUE = /^(?:자료\s*(?:없음|없슴)|해당\s*없음|없음|미상|정보)\s*[.]?$/i;
const DATE = /(2\s*0\s*\d\s*\d)\s*(?:년|[.\/-])\s*(\d\s*\d?)\s*(?:월|[.\/-])\s*(\d\s*\d?)\s*일?/;

const sectionHeading = (value, number) => {
  const normalized = compact(value).replace(new RegExp(`^(?:제?${number}(?:항|장)?)`), '');
  if (number === 1) return /^(?:화학제품(?:과|및)?회사(?:에관한)?정보|identification)$/.test(normalized);
  if (number === 2) return /^(?:유해성?위험성|hazards?identification)$/.test(normalized);
  return false;
};

export function identifyMsdsSections(source) {
  const lines = source.map((line, index) => ({ raw: rawLine(line), index, source: line })).filter(line => line.raw);
  const one = lines.findIndex(line => sectionHeading(line.raw, 1));
  const two = lines.findIndex((line, index) => index > one && sectionHeading(line.raw, 2));
  return { lines, one, two, company: one >= 0 ? lines.slice(one + 1, two > one ? two : Math.min(lines.length, one + 40)) : lines.slice(0, 40) };
}

function valueAfter(raw, pattern, join = false) {
  const match = raw.match(pattern);
  if (!match) return null;
  const rest = raw.slice((match.index || 0) + match[0].length).replace(/^\s*[|:：-]\s*/, '').trim();
  if (!rest) return '';
  const cells = rest.split(/\s*\|\s*/).map(clean).filter(Boolean);
  return join ? cells.join(' / ') : cells[0] || '';
}

const knownLabel = value => /^(?:(?:[가-하]|\d+(?:\.\d+)*)\.?\s*)?(?:제품\s*명|제품의\s*명칭|화학제품명|물질명|제품\s*코드|제품\s*번호|제조자|제조사|제조회사명|공급자|공급사|유통업자|회사명|주소|전화|담당부서|용도|사용상의\s*제한|최초\s*작성일|제정일|개정일|최종\s*개정일|제출번호)\b/i.test(clean(value));
const invalidValue = value => {
  const text = clean(value);
  return !text || NO_VALUE.test(text) || sectionHeading(text, 1) || sectionHeading(text, 2) || knownLabel(text)
    || /^\(\s*(?:관용명|이명|영문명)\s*\)$/i.test(text)
    || /^(?:https?:\/\/|www\.)/i.test(text) || /^[\d\s().+~-]+$/.test(text);
};
const invalidCompany = value => invalidValue(value) || /(?:^|\s)(?:주소|전화|fax|e-?mail|홈페이지)\s*[:：]?/i.test(value)
  || /@|https?:\/\/|www\./i.test(value) || /^(?:제조자|공급자|수입자|유통업자|회사명)?\s*정보\s*[:：]?$/i.test(clean(value));
const confidence = score => score >= 110 ? 'high' : score >= 85 ? 'medium' : 'low';
const candidate = (value, score, matchedLabel, sourceText) => ({ value: clean(value).replace(/^[○▶■\-]\s*/, ''), score, confidence: confidence(score), matchedLabel, sourceText });
const best = candidates => candidates.filter(item => item.value).sort((a, b) => b.score - a.score || a.order - b.order)[0] || null;
const publicField = selected => selected ? { value: selected.confidence === 'low' ? '' : selected.value, confidence: selected.confidence, matchedLabel: selected.matchedLabel, sourceText: selected.sourceText } : { value: '', confidence: 'none', matchedLabel: '', sourceText: '' };

function labeledCandidates(lines, pattern, label, validator = invalidValue) {
  const found = [];
  lines.forEach((line, index) => {
    const direct = valueAfter(line.raw, pattern);
    if (direct === null) return;
    if (direct && !validator(direct)) found.push({ ...candidate(direct, 120, label, line.raw), order: index });
    if (direct) return;
    for (let offset = 1; offset <= 2 && index + offset < lines.length; offset += 1) {
      const next = lines[index + offset].raw;
      if (!next || knownLabel(next) || sectionHeading(next, 2)) break;
      if (!validator(next)) found.push({ ...candidate(next.split(/\s*\|\s*/)[0], 105, label, `${line.raw} → ${next}`), order: index });
      break;
    }
  });
  return found;
}

function companyCandidates(lines) {
  const result = { manufacturer: [], supplier: [] };
  let context = [];
  const add = (roles, value, label, line, order) => {
    if (invalidCompany(value)) return;
    for (const role of roles) result[role].push({ ...candidate(value, 125, label, line), order });
  };
  lines.forEach((line, index) => {
    const raw = line.raw, normalized = compact(raw);
    if (/제조자(?:수입자)?(?:공급자)?유통업자정보|제조자공급자유통(?:업자)?정보/.test(normalized)) context = ['manufacturer', 'supplier'];
    else if (/공급자(?:수입품의경우.*)?정보|공급자유통(?:업자|자)?정보/.test(normalized)) context = ['supplier'];
    else if (/제조자정보/.test(normalized)) context = ['manufacturer'];

    const definitions = [
      { pattern: /^(?:[○▶■\-]\s*)?(?:생산\s*및\s*공급\s*회사명)\s*(?:[|:：]\s*)?/i, roles: ['manufacturer', 'supplier'], label: '생산 및 공급 회사명', join: true },
      { pattern: /^(?:[○▶■\-]\s*)?(?:제조회사명|제조사명?|제조업자명?|제조자명?)\s*(?:정보)?\s*[|:：]\s*/i, roles: ['manufacturer'], label: '제조자', join: false },
      { pattern: /^(?:[○▶■\-]\s*)?(?:공급회사명?|공급사명?|공급업자명?|공급자명?|유통업자명?)\s*(?:정보)?\s*[|:：]\s*/i, roles: ['supplier'], label: '공급자', join: true },
      { pattern: /^(?:[○▶■\-]\s*)?공급자\s*\/?\s*유통(?:업)?자\s*정보\s*(?:[|:：]\s*)?/i, roles: ['supplier'], label: '공급자/유통업자 정보', join: true },
      { pattern: /^(?:[○▶■\-]\s*)?(?:회사명)\s*(?:[|:：]\s*)?/i, roles: context, label: '회사명', join: true }
    ];
    for (const definition of definitions) {
      if (!definition.roles.length) continue;
      const value = valueAfter(raw, definition.pattern, definition.join);
      if (value !== null) { add(definition.roles, value, definition.label, raw, index); break; }
    }
  });
  return result;
}

function normalizeDate(value) {
  const match = clean(value).match(DATE);
  if (!match) return '';
  const normalized = `${match[1].replace(/\s/g, '')}-${match[2].replace(/\s/g, '').padStart(2, '0')}-${match[3].replace(/\s/g, '').padStart(2, '0')}`;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === normalized ? normalized : '';
}

function dateCandidates(lines, definitions) {
  const found = [];
  lines.forEach((line, index) => {
    for (const definition of definitions) {
      const match = line.raw.match(definition.pattern);
      if (!match) continue;
      const remainder = clean(line.raw.slice((match.index || 0) + match[0].length).replace(/^\s*[|:：-]\s*/, ''));
      const direct = normalizeDate(remainder);
      if (direct) found.push({ ...candidate(direct, definition.score, match[1] || definition.label, line.raw), order: index });
      if (direct || NO_VALUE.test(remainder) || definition.score < 100) continue;
      const dates = [];
      for (let offset = 1; offset <= definition.scan && index + offset < lines.length; offset += 1) {
        const next = lines[index + offset].raw;
        if (offset > 1 && (sectionHeading(next, 1) || sectionHeading(next, 2)
          || (definition.kind === 'issue' && /(?:개정|revision)/i.test(next))
          || (definition.kind === 'revision' && /^(?:[라-하]\.|\d+\.\d+\.)\s*(?:기타|other)/i.test(next)))) break;
        const parsed = normalizeDate(next);
        if (parsed) dates.push(parsed);
      }
      if (dates.length) {
        dates.sort();
        found.push({ ...candidate(definition.latest ? dates.at(-1) : dates[0], definition.score - 2, match[1] || definition.label, `${line.raw} → ${dates.join(', ')}`), order: index });
      }
    }
  });
  return found;
}

function submissionCandidates(lines) {
  const found = [];
  const normalizeNumber = value => value.replace(/\s/g, '').toUpperCase();
  lines.forEach((line, index) => {
    if (/작성\s*및\s*제출\s*제외\s*대상/i.test(line.raw)) return;
    const explicit = line.raw.match(/(?:물질안전보건자료\s*)?(MSDS\s*)?제출\s*번호\s*[:：|]?\s*([A-Z0-9][A-Z0-9\s-]{5,})/i);
    if (explicit) found.push({ ...candidate(normalizeNumber(explicit[2]), 145, explicit[0].replace(explicit[2], '').trim(), line.raw), order: index });
    const official = line.raw.match(/MSDS\s*번호\s*[:：|]?\s*(AA\s*\d{5}\s*-\s*\d{10})/i);
    if (official) found.push({ ...candidate(normalizeNumber(official[1]), 125, 'MSDS 번호(AA 형식)', line.raw), order: index });
    const standalone = line.raw.match(/^\s*(AA\s*\d{5}\s*-\s*\d{10})\s*$/i);
    if (standalone && /MSDS\s*번호를\s*반영/i.test(lines[index + 1]?.raw || '')) found.push({ ...candidate(normalizeNumber(standalone[1]), 115, '인접한 MSDS 번호 안내', `${line.raw} → ${lines[index + 1].raw}`), order: index });
  });
  return found;
}

export function parseMsdsMetadata(source) {
  const sections = identifyMsdsSections(source);
  const productPattern = /^(?:[○▶■\-]\s*)?(?:(?:[가-하]\s*\.?|\d+(?:\.\d+)*\.?)\s*)?(?:제\s*품\s*명(?:\s*\(\s*관용명\s*\))?|제품의\s*명칭|화학제품명|물질명|product\s*(?:name|identifier))\s*(?:[|:：]\s*)?/i;
  const codePattern = /^(?:[○▶■\-]\s*)?(?:(?:[가-하]\s*\.?|\d+(?:\.\d+)*\.?)\s*)?(?:제품\s*코드|제품\s*번호|상품\s*코드|product\s*(?:code|no\.?|number))\s*(?:[|:：]\s*)?/i;
  const companies = companyCandidates(sections.company);
  const selected = {
    productName: best(labeledCandidates(sections.company, productPattern, '제품명')),
    manufacturer: best(companies.manufacturer),
    supplier: best(companies.supplier),
    productCode: best(labeledCandidates(sections.company, codePattern, '제품코드')),
    issueDate: best(dateCandidates(sections.lines, [
      { pattern: /(최초\s*작성일자?|최초작성일자?)/i, score: 145, scan: 12, kind: 'issue' },
      { pattern: /(제정\s*일자?)/i, score: 135, scan: 4, kind: 'issue' },
      { pattern: /(?<!개정)(작성\s*일자?)/i, score: 115, scan: 4, kind: 'issue' },
      { pattern: /(date\s+of\s+issue|issue\s+date|발행일)/i, score: 70, scan: 1, kind: 'issue' }
    ])),
    revisionDate: best(dateCandidates(sections.lines, [
      { pattern: /(최종\s*개정\s*일자?|최종개정일자?)/i, score: 150, scan: 40, latest: true, kind: 'revision' },
      { pattern: /(last\s+revision)/i, score: 135, scan: 2, kind: 'revision' },
      { pattern: /(개정\s*일자?)/i, score: 120, scan: 3, kind: 'revision' },
      { pattern: /(revision\s+date)/i, score: 100, scan: 2, kind: 'revision' }
    ])),
    submissionNumber: best(submissionCandidates(sections.lines))
  };
  const fields = Object.fromEntries(Object.entries(selected).map(([name, value]) => [name, publicField(value)]));
  return { ...Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.value])), fields };
}
