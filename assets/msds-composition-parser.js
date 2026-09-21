const clean = value => String(value ?? '').normalize('NFKC').replace(/[\u00a0\u200b-\u200d\ufeff]/gu, ' ').replace(/\s+/gu, ' ').trim();
const compact = value => clean(value).toLowerCase().replace(/[\s·ㆍ._:：()[\]{}]/gu, '').replace(/[‐‑‒–—―]/gu, '-');
const TRADE_SECRET = /(?:영업\s*(?:비밀|기밀)|비공개\s*승인|trade\s*secret|proprietary|confidential)/i;
const NO_VALUE = /^(?:-|–|—|자료\s*없음|해당\s*없음|none|n\/?a)\.?$/i;
const CAS_CANDIDATE = /(?<!\d)(\d{2,7})\s*[-‐‑‒–—―]\s*(\d{2})\s*[-‐‑‒–—―]\s*(\d)(?!\d)/g;
const AMOUNT = /(?:(?:<=|>=|[<>≤≥])​?\s*\d|\d[\d.,]*\s*(?:~|[-‐‑‒–—―]|(?:이상|이하|초과|미만)\s*~?)\s*\d|\d[\d.,]*\s*%|\d[\d.,]*\s*(?:이상|이하|미만)|balance|rem\.?\s*\(나머지\)|rem\.?|잔량|나머지)/i;
const SECTION_THREE = /^(?:section)?3(?:\.\d+)?[.)\-:]?\s*(?:구\s*성\s*성\s*분\s*(?:의)?\s*명\s*칭\s*(?:및|과)\s*함\s*유\s*량|composition\s*\/?\s*information\s+on\s+ingredients?)$/i;
const SECTION_FOUR = /^(?:section)?4(?:\.\d+)?[.)\-:]?\s*(?:응\s*급\s*조\s*치\s*(?:요\s*령)?|first\s*[- ]?aid\s+measures?)$/i;
const HEADER = {
  name: /^(?:화학물질명|물질명|구성성분|chemicalname|ingredientname|ingredients?)/i,
  synonym: /^(?:관용명|이명|다른이름|commonname|synonyms?)/i,
  cas: /^(?:cas(?:no|number|번호)?|registrynumber|식별번호)/i,
  amount: /^(?:함유량|content|concentration|weight(?:percent|%))/i
};

function lineText(line) {
  return clean(typeof line === 'string' ? line : line?.rawText || line?.text || line?.str || '');
}

function headingText(value) {
  return compact(value).replace(/^section/, 'section').replace(/(?:of)?$/i, match => match);
}

function isHeading(value, number) {
  const text = clean(value).replace(/^\s*(?:제\s*)?(\d+)\s*항\s*/u, '$1. ');
  const normalized = text.replace(/\s+/gu, ' ');
  if ((number === 3 ? SECTION_THREE : SECTION_FOUR).test(normalized)) return true;
  const valueCompact = headingText(normalized);
  if (number === 3) return /^(?:section)?3(?:\d+)?(?:구성성분(?:의)?명칭(?:및|과)함유량|composition\/?informationoningredients?)$/i.test(valueCompact)
    || /^구성성분(?:의)?명칭(?:및|과)함유량$/i.test(valueCompact);
  return /^(?:section)?4(?:\d+)?(?:응급조치(?:요령)?|first-?aidmeasures?)$/i.test(valueCompact)
    || /^(?:응급조치(?:요령)?|first-?aidmeasures?)$/i.test(valueCompact);
}

function normalizeCas(value) {
  const text = clean(value);
  CAS_CANDIDATE.lastIndex = 0;
  const match = CAS_CANDIDATE.exec(text);
  CAS_CANDIDATE.lastIndex = 0;
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function validateCasRegistryNumber(value) {
  const normalized = normalizeCas(value);
  const candidate = clean(value).replace(/\s+/gu, '').replace(/[‐‑‒–—―]/gu, '-');
  if (!normalized || !/^\d{2,7}-\d{2}-\d$/.test(candidate)) return false;
  const digits = normalized.replaceAll('-', '');
  const check = Number(digits.at(-1));
  const body = digits.slice(0, -1).split('').reverse().map(Number);
  return body.reduce((sum, digit, index) => sum + digit * (index + 1), 0) % 10 === check;
}

function sourceLines(source) {
  if (Array.isArray(source)) return source.map((line, index) => ({
    pageNumber: Number(line?.pageNumber || line?.page || 1),
    rowNumber: Number(line?.rowNumber || line?.lineNumber || index + 1),
    rawText: lineText(line),
    items: Array.isArray(line?.items) ? line.items : [],
    cells: Array.isArray(line?.cells) ? line.cells : [],
    y: Number.isFinite(Number(line?.y)) ? Number(line.y) : null,
    source: Array.isArray(line?.items) && line.items.length ? 'coordinates' : 'text'
  })).filter(line => line.rawText);
  if (Array.isArray(source?.pageStructures)) return source.pageStructures.flatMap(page => (page.rows || []).map((row, index) => ({
    pageNumber: Number(page.pageNumber || row.page || 1),
    rowNumber: Number(row.rowNumber || index + 1),
    rawText: lineText(row),
    items: Array.isArray(row.items) ? row.items : [],
    cells: Array.isArray(row.cells) ? row.cells : [],
    y: Number.isFinite(Number(row.y)) ? Number(row.y) : null,
    source: Array.isArray(row.items) && row.items.length ? 'coordinates' : 'text'
  })).filter(line => line.rawText));
  if (Array.isArray(source?.pages)) return source.pages.flatMap((page, pageIndex) => String(page || '').split(/\r?\n/).map((rawText, index) => ({
    pageNumber: pageIndex + 1, rowNumber: index + 1, rawText: clean(rawText), items: [], cells: [], y: null, source: 'text'
  })).filter(line => line.rawText));
  return [];
}

export function identifyCompositionSection(source) {
  const lines = sourceLines(source);
  const start = lines.findIndex(line => isHeading(line.rawText, 3));
  const end = start < 0 ? -1 : lines.findIndex((line, index) => index > start && isHeading(line.rawText, 4));
  return {
    found: start >= 0,
    startIndex: start,
    endIndex: end,
    heading: start >= 0 ? lines[start] : null,
    lines: start < 0 ? [] : lines.slice(start + 1, end > start ? end : lines.length),
    allLines: lines
  };
}

function itemText(item) {
  return clean(item?.text ?? item?.str ?? '');
}

function findHeaderX(line, pattern) {
  const items = line.items || [];
  for (let start = 0; start < items.length; start += 1) {
    let combined = '';
    for (let end = start; end < Math.min(items.length, start + 8); end += 1) {
      combined += compact(itemText(items[end]));
      if (pattern.test(combined)) return Number(items[start].x) || 0;
    }
  }
  for (const cell of line.cells || []) if (pattern.test(compact(cell.rawText || cell.text))) return Number(cell.x) || 0;
  return null;
}

function locateHeader(lines) {
  const scan = lines.slice(0, Math.min(lines.length, 12));
  const found = {};
  scan.forEach((line, index) => {
    for (const [field, pattern] of Object.entries(HEADER)) {
      if (found[field]) continue;
      const x = findHeaderX(line, pattern);
      if (x !== null) found[field] = { x, index, line };
    }
  });
  if (!found.name || !found.cas) return null;
  const headerEnd = Math.max(...Object.values(found).map(value => value.index));
  const columns = { name: found.name.x, cas: found.cas.x };
  if (found.synonym && found.synonym.x > found.name.x && found.synonym.x < found.cas.x) columns.synonym = found.synonym.x;
  if (found.amount && found.amount.x > found.cas.x) columns.amount = found.amount.x;
  return { columns, headerEnd, headerLines: scan.slice(0, headerEnd + 1) };
}

function boundaries(columns) {
  const ordered = Object.entries(columns).sort((a, b) => a[1] - b[1]);
  return ordered.map(([name, x], index) => ({
    name,
    x,
    min: index ? (ordered[index - 1][1] + x) / 2 : -Infinity,
    max: index + 1 < ordered.length ? (x + ordered[index + 1][1]) / 2 : Infinity
  }));
}

function fieldForX(x, bands) {
  return bands.find(band => x >= band.min && x < band.max)?.name || null;
}

function joinFieldItems(items) {
  const byLine = new Map();
  items.forEach(entry => {
    const key = `${entry.line.pageNumber}:${entry.line.rowNumber}`;
    if (!byLine.has(key)) byLine.set(key, { line: entry.line, items: [] });
    byLine.get(key).items.push(entry.item);
  });
  return [...byLine.values()].sort((a, b) => a.line.pageNumber - b.line.pageNumber || (b.line.y ?? -a.line.rowNumber) - (a.line.y ?? -b.line.rowNumber)).map(group =>
    group.items.sort((a, b) => Number(a.x || 0) - Number(b.x || 0)).map(itemText).join(' ')
  ).join(' ').replace(/\s+([,.;:%)])/gu, '$1').replace(/([(])\s+/gu, '$1').replace(/\s*([‐‑‒–—―])\s*/gu, '-').replace(/\s*~\s*/gu, '~').trim();
}

function rawCasState(value) {
  const text = clean(value);
  if (TRADE_SECRET.test(text)) return 'TRADE_SECRET';
  if (normalizeCas(text)) return 'KNOWN';
  if (NO_VALUE.test(text)) return 'ABSENT';
  return null;
}

function amountFrom(value) {
  const text = clean(value).replace(/\b\d{5}\b(?=\s|$)/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!text) return null;
  if (/^(?:자료\s*없음|-|–|—)$/i.test(text)) return null;
  if (TRADE_SECRET.test(text) && !AMOUNT.test(text)) return clean(text.match(TRADE_SECRET)?.[0]);
  const patterns = [
    /(?:<=|>=|[<>≤≥])\s*\d+(?:\.\d+)?\s*%?/i,
    /\d+(?:\.\d+)?\s*%?\s*(?:이상\s*)?~\s*\d+(?:\.\d+)?\s*%?\s*(?:미만|이하|이상)?(?:\s*\([^)]{1,60}\))?/i,
    /\d+(?:\.\d+)?\s*%?\s*[-‐‑‒–—―]\s*\d+(?:\.\d+)?\s*%?/i,
    /\d+(?:\.\d+)?\s*%\s*(?:이상|이하|미만)?(?:\s*\([^)]{1,60}\))?/i,
    /\d+(?:\.\d+)?\s*(?:이상|이하|미만)(?:\s*\([^)]{1,60}\))?/i,
    /(?:balance|rem\.?\s*\(나머지\)|rem\.?|잔량|나머지)/i,
    /^\d+(?:\.\d+)?$/,
    /(?:^|\s)(\d+(?:\.\d+)?)(?=\s*$)/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return clean(match[1] || match[0]);
  }
  return null;
}

function cleanName(value) {
  const text = clean(value).replace(/^\d+\)\s*/u, '');
  return NO_VALUE.test(text) || /^(?:total|합계)$/i.test(text) ? '' : text;
}

function publicSource(section, lines, method, extra = {}) {
  return {
    section: 3,
    method,
    pageNumbers: [...new Set(lines.map(line => line.pageNumber))],
    rowNumbers: lines.map(line => line.rowNumber),
    text: lines.map(line => line.rawText).join(' \u2192 '),
    heading: section.heading?.rawText || '',
    ...extra
  };
}

function makeIngredient({ name, synonym, casRaw, amountRaw, confidence, source }, warnings) {
  const chemicalName = cleanName(name);
  if (!chemicalName || !amountRaw) return null;
  let casStatus = rawCasState(casRaw);
  if (!casStatus) return null;
  const casValue = casStatus === 'KNOWN' ? normalizeCas(casRaw) : null;
  const casValid = casStatus !== 'KNOWN' ? null : validateCasRegistryNumber(casValue);
  let finalConfidence = confidence;
  if (casValid === false) {
    finalConfidence = 'low';
    warnings.push(`CAS checksum이 유효하지 않아 확인이 필요합니다: ${casValue}`);
  }
  const tradeSecret = TRADE_SECRET.test(`${chemicalName} ${synonym || ''} ${casRaw || ''} ${amountRaw || ''}`);
  return {
    chemicalName,
    synonym: clean(synonym) && !NO_VALUE.test(clean(synonym)) ? clean(synonym) : null,
    casValue,
    casStatus,
    amountRaw: clean(amountRaw),
    tradeSecret,
    confidence: finalConfidence,
    source: { ...source, casRaw: clean(casRaw), casValid }
  };
}

function looksLikeVariantTable(lines, header) {
  if (header.columns.amount) return false;
  const rightValues = lines.slice(header.headerEnd + 1).map(line => {
    const values = (line.items || []).filter(item => Number(item.x) > header.columns.cas + 35).map(itemText).filter(value => AMOUNT.test(value));
    return values.length;
  });
  const headerRightLabels = header.headerLines.flatMap(line => (line.items || []).filter(item => Number(item.x) > header.columns.cas + 35).map(itemText)).filter(value => value && !HEADER.cas.test(compact(value)));
  return headerRightLabels.length >= 2 && rightValues.filter(count => count >= 2).length >= 2;
}

function parseCoordinateTable(section, header, warnings) {
  const dataLines = section.lines.slice(header.headerEnd + 1);
  if (looksLikeVariantTable(section.lines, header)) {
    warnings.push('제품 variant별 함유량 열이 여러 개인 표는 v1에서 자동 평면화하지 않습니다.');
    return { ingredients: [], unresolved: true, variant: true };
  }
  const inferredAmount = header.columns.amount || Math.max(header.columns.cas + 75, ...dataLines.flatMap(line => (line.items || []).filter(item => AMOUNT.test(itemText(item))).map(item => Number(item.x) || 0)));
  if (!Number.isFinite(inferredAmount) || inferredAmount <= header.columns.cas) {
    warnings.push('함유량 열의 위치를 신뢰성 있게 확인하지 못했습니다.');
    return { ingredients: [], unresolved: true, variant: false };
  }
  const columns = { ...header.columns, amount: inferredAmount };
  const bands = boundaries(columns);
  const rows = dataLines.map(line => {
    const fields = { name: [], synonym: [], cas: [], amount: [] };
    for (const item of line.items || []) {
      const field = fieldForX(Number(item.x) || 0, bands);
      if (field) fields[field].push(item);
    }
    return { line, fields, casText: fields.cas.map(itemText).join(' '), amountText: fields.amount.map(itemText).join(' ') };
  }).filter(row => !/^(?:[*※]|물질안전보건자료에|비공개\s*승인\s*(?:번호|유효기간)|MSDS\b.*CAS\s*No|(?:지\s*)?않음\s*$|\d+\s*\/\s*\d+\s*$)/i.test(row.line.rawText));
  const anchors = rows.filter(row => rawCasState(row.casText));
  if (!anchors.length) return { ingredients: [], unresolved: true, variant: false };
  const boundaryBetween = (upperAnchor, lowerAnchor) => {
    const upperY = upperAnchor.line.y ?? 0;
    const lowerY = lowerAnchor.line.y ?? 0;
    const positions = [...new Set(rows.filter(row => row.line.pageNumber === upperAnchor.line.pageNumber && (row.line.y ?? 0) <= upperY && (row.line.y ?? 0) >= lowerY).map(row => row.line.y).filter(Number.isFinite))].sort((a, b) => b - a);
    if (positions.length < 2) return (upperY + lowerY) / 2;
    let best = { gap: -1, boundary: (upperY + lowerY) / 2 };
    for (let position = 0; position + 1 < positions.length; position += 1) {
      const gap = positions[position] - positions[position + 1];
      if (gap > best.gap) best = { gap, boundary: (positions[position] + positions[position + 1]) / 2 };
    }
    return best.boundary;
  };
  const ingredients = [];
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const samePage = rows.filter(row => row.line.pageNumber === anchor.line.pageNumber);
    const pageAnchors = anchors.filter(row => row.line.pageNumber === anchor.line.pageNumber);
    const pageIndex = pageAnchors.indexOf(anchor);
    const previous = pageAnchors[pageIndex - 1];
    const next = pageAnchors[pageIndex + 1];
    const upper = previous ? boundaryBetween(previous, anchor) : Infinity;
    const lower = next ? boundaryBetween(anchor, next) : -Infinity;
    const group = samePage.filter(row => row.line.y === null ? row === anchor : row.line.y < upper && row.line.y >= lower);
    const fieldItems = { name: [], synonym: [], cas: [], amount: [] };
    group.forEach(row => Object.keys(fieldItems).forEach(field => row.fields[field].forEach(item => fieldItems[field].push({ item, line: row.line }))));
    const casRaw = joinFieldItems(fieldItems.cas);
    const amountRaw = amountFrom(joinFieldItems(fieldItems.amount));
    const usedLines = group.filter(row => Object.values(row.fields).some(items => items.length)).map(row => row.line);
    const coreRows = new Set([
      ...fieldItems.name.map(entry => entry.line.rowNumber), ...fieldItems.cas.map(entry => entry.line.rowNumber), ...fieldItems.amount.map(entry => entry.line.rowNumber)
    ]);
    const confidence = coreRows.size === 1 ? 'high' : 'medium';
    const ingredient = makeIngredient({
      name: joinFieldItems(fieldItems.name),
      synonym: columns.synonym ? joinFieldItems(fieldItems.synonym) : null,
      casRaw,
      amountRaw,
      confidence,
      source: publicSource(section, usedLines, confidence === 'high' ? 'same-coordinate-row' : 'coordinate-row-band', { columns })
    }, warnings);
    if (ingredient) ingredients.push(ingredient);
    else if (!/^(?:total|합계)$/i.test(cleanName(joinFieldItems(fieldItems.name)) || joinFieldItems(fieldItems.name))) warnings.push(`제3항 ${anchor.line.pageNumber}페이지의 표 행 하나를 안전하게 연결하지 못했습니다.`);
  }
  return { ingredients, unresolved: !ingredients.length, variant: false };
}

function splitCells(line) {
  if (line.cells?.length > 1) return line.cells.map(cell => clean(cell.rawText || cell.text)).filter(Boolean);
  return line.rawText.split(/\s*\|\s*/).map(clean).filter(Boolean);
}

function textHeader(lines) {
  for (let index = 0; index < Math.min(lines.length, 10); index += 1) {
    const cells = splitCells(lines[index]);
    const fields = cells.map(cell => Object.entries(HEADER).find(([, pattern]) => pattern.test(compact(cell)))?.[0] || null);
    if (fields.includes('name') && fields.includes('cas') && fields.includes('amount')) return { index, fields };
  }
  return null;
}

function parseTextTable(section, warnings) {
  const header = textHeader(section.lines);
  const ingredients = [];
  if (header) {
    for (const line of section.lines.slice(header.index + 1)) {
      const cells = splitCells(line);
      if (cells.length < 2) continue;
      const values = {};
      header.fields.forEach((field, index) => { if (field) values[field] = cells[index] || ''; });
      const ingredient = makeIngredient({ name: values.name, synonym: values.synonym || null, casRaw: values.cas, amountRaw: amountFrom(values.amount), confidence: 'high', source: publicSource(section, [line], 'same-text-row') }, warnings);
      if (ingredient) ingredients.push(ingredient);
    }
    if (ingredients.length) return { ingredients, unresolved: false };
  }
  const values = section.lines.map(line => line.rawText).filter(value => !Object.values(HEADER).some(pattern => pattern.test(compact(value))));
  for (let index = 0; index + 2 < values.length;) {
    const [name, casRaw, amount] = values.slice(index, index + 3);
    if (rawCasState(casRaw) && amountFrom(amount) && !rawCasState(name)) {
      const lines = section.lines.filter(line => [name, casRaw, amount].includes(line.rawText));
      const ingredient = makeIngredient({ name, synonym: null, casRaw, amountRaw: amountFrom(amount), confidence: 'medium', source: publicSource(section, lines, 'adjacent-label-value-group') }, warnings);
      if (ingredient) ingredients.push(ingredient);
      index += 3;
    } else index += 1;
  }
  return { ingredients, unresolved: !ingredients.length };
}

export function parseMsdsComposition(source) {
  const section = identifyCompositionSection(source);
  const warnings = [];
  if (!section.found) return { ingredients: [], status: 'NO_COMPOSITION_SECTION', warnings, source: { section: 3, found: false } };
  const coordinateLines = section.lines.filter(line => line.source === 'coordinates' && line.items.length);
  const header = coordinateLines.length ? locateHeader(section.lines) : null;
  let parsed;
  if (header) parsed = parseCoordinateTable(section, header, warnings);
  else parsed = parseTextTable(section, warnings);
  const hasLow = parsed.ingredients.some(ingredient => ingredient.confidence === 'low');
  const status = parsed.unresolved
    ? 'UNRESOLVED'
    : hasLow || warnings.length ? 'PARTIAL' : 'SUCCESS';
  return {
    ingredients: parsed.ingredients,
    status,
    warnings: [...new Set(warnings)],
    source: {
      section: 3,
      found: true,
      heading: section.heading?.rawText || '',
      startPage: section.heading?.pageNumber || null,
      endPage: section.lines.at(-1)?.pageNumber || section.heading?.pageNumber || null,
      layout: parsed.variant ? 'VARIANT_TABLE' : header ? 'COORDINATE_TABLE' : 'TEXT_LOGICAL_ROWS'
    }
  };
}
