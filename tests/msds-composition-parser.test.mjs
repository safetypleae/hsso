import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyCompositionSection, parseMsdsComposition, validateCasRegistryNumber } from '../assets/msds-composition-parser.js';

const parse = lines => parseMsdsComposition(lines.map(rawText => ({ rawText })));
const koreanHeader = '화학물질명 | 관용명 및 이명 | CAS 번호 또는 식별번호 | 함유량(%)';
const section = rows => ['3. 구성성분의 명칭 및 함유량', koreanHeader, ...rows, '4. 응급조치 요령'];

test('single ingredient in a Korean same-line table is linked as one high-confidence row', () => {
  const result = parse(section(['톨루엔 | 메틸벤젠 | 108-88-3 | 10~20%']));
  assert.equal(result.status, 'SUCCESS');
  assert.deepEqual(result.ingredients.map(({ chemicalName, synonym, casValue, casStatus, amountRaw, confidence }) => ({ chemicalName, synonym, casValue, casStatus, amountRaw, confidence })), [
    { chemicalName: '톨루엔', synonym: '메틸벤젠', casValue: '108-88-3', casStatus: 'KNOWN', amountRaw: '10~20%', confidence: 'high' }
  ]);
});

test('multiple ingredient rows remain independently linked', () => {
  const result = parse(section(['Toluene | Methylbenzene | 108-88-3 | 10~20%', 'Xylene | Dimethylbenzene | 1330-20-7 | 5~10%']));
  assert.deepEqual(result.ingredients.map(row => row.casValue), ['108-88-3', '1330-20-7']);
});

test('English section and table headings are supported', () => {
  const result = parse(['3. Composition / Information on Ingredients', 'Chemical name | Common name | CAS No. | Concentration', 'Acetone | Dimethyl ketone | 67-64-1 | < 5%', '4. First-aid measures']);
  assert.equal(result.ingredients[0].chemicalName, 'Acetone');
  assert.equal(result.ingredients[0].synonym, 'Dimethyl ketone');
});

test('adjacent multiline logical rows are linked only as a complete name-CAS-amount group', () => {
  const result = parse(['3. 구성성분의 명칭 및 함유량', '화학물질명', 'CAS No.', '함유량', 'Toluene', '108-88-3', '10 ~ 20%', '4. 응급조치 요령']);
  assert.equal(result.ingredients.length, 1);
  assert.equal(result.ingredients[0].confidence, 'medium');
});

test('CAS checksum validation accepts valid and rejects invalid registry numbers', () => {
  assert.equal(validateCasRegistryNumber('108-88-3'), true);
  assert.equal(validateCasRegistryNumber(' 108 - 88 - 3 '), true);
  assert.equal(validateCasRegistryNumber('108-88-4'), false);
  assert.equal(validateCasRegistryNumber('12-3-4'), false);
});

test('invalid CAS remains verbatim-normalized but is low confidence and PARTIAL', () => {
  const result = parse(section(['Toluene | Methylbenzene | 108-88-4 | 10%']));
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.ingredients[0].casValue, '108-88-4');
  assert.equal(result.ingredients[0].confidence, 'low');
  assert.equal(result.ingredients[0].source.casValid, false);
  assert.match(result.warnings.join(' '), /checksum/);
});

test('explicitly absent CAS differs from trade secret CAS', () => {
  const absent = parse(section(['Modified resin | - | - | 10%'])).ingredients[0];
  const secret = parse(section(['Inorganic salt | 비공개승인 | 영업비밀 | 40 ~ 60%'])).ingredients[0];
  assert.equal(absent.casStatus, 'ABSENT');
  assert.equal(absent.casValue, null);
  assert.equal(absent.tradeSecret, false);
  assert.equal(secret.casStatus, 'TRADE_SECRET');
  assert.equal(secret.tradeSecret, true);
});

test('a trade-secret chemical name can still retain a published CAS independently', () => {
  const row = parse(section(['영업 기밀 | - | 67-64-1 | 1~5%'])).ingredients[0];
  assert.equal(row.chemicalName, '영업 기밀');
  assert.equal(row.casStatus, 'KNOWN');
  assert.equal(row.tradeSecret, true);
});

test('amount expressions are preserved instead of coerced to numbers', () => {
  for (const amount of ['10%', '10 ~ 20%', '< 5%', '≤ 1', '0.1 - 1', '잔량', 'Balance']) {
    const row = parse(section([`Example | - | 7732-18-5 | ${amount}`])).ingredients[0];
    assert.equal(row.amountRaw, amount);
  }
});

test('synonym is extracted only when a synonym column exists', () => {
  assert.equal(parse(section(['Acetone | 아세톤 | 67-64-1 | 5%'])).ingredients[0].synonym, '아세톤');
  const without = parse(['3. Composition/information on ingredients', 'Chemical name | CAS No. | Content', 'Acetone | 67-64-1 | 5%', '4. First aid measures']);
  assert.equal(without.ingredients[0].synonym, null);
});

test('only section 3 is returned and section 4 CAS values are ignored', () => {
  const input = [...section(['Toluene | - | 108-88-3 | 10%']), 'First aid reference 1330-20-7 99%'];
  const located = identifyCompositionSection(input);
  const result = parse(input);
  assert.equal(located.lines.some(line => line.rawText.includes('1330-20-7')), false);
  assert.deepEqual(result.ingredients.map(row => row.casValue), ['108-88-3']);
});

test('missing section 3 is reported without scanning the document for CAS', () => {
  const result = parse(['1. 화학제품과 회사에 관한 정보', 'CAS 108-88-3', '4. 응급조치 요령']);
  assert.equal(result.status, 'NO_COMPOSITION_SECTION');
  assert.deepEqual(result.ingredients, []);
});

test('collapsed column order does not create guessed ingredient-CAS links', () => {
  const result = parse(['3. 구성성분의 명칭 및 함유량', koreanHeader, '108-88-3', '1330-20-7', 'Toluene', 'Xylene', '10%', '20%', '4. 응급조치 요령']);
  assert.equal(result.status, 'UNRESOLVED');
  assert.deepEqual(result.ingredients, []);
});

test('variant columns are not flattened into guessed ingredient rows', () => {
  const result = parse(['3. 구성성분의 명칭 및 함유량', '구성 성분 | CAS No. | Product A | Product B', 'Iron | 7439-89-6 | Balance | Balance', 'Nickel | 7440-02-0 | - | 0.8~1.1', '4. 응급조치 요령']);
  assert.equal(result.status, 'UNRESOLVED');
  assert.deepEqual(result.ingredients, []);
});

test('source evidence identifies section and logical row without exposing unrelated text', () => {
  const row = parse(section(['Toluene | Methylbenzene | 108-88-3 | 10%'])).ingredients[0];
  assert.equal(row.source.section, 3);
  assert.equal(row.source.method, 'same-text-row');
  assert.match(row.source.text, /108-88-3/);
});

const coordinateRow = (rawText, y, entries, rowNumber, page = 1) => ({
  rawText, text: rawText, y, rowNumber, page,
  items: entries.map(([text, x], itemIndex) => ({ text, x, y, width: Math.max(8, text.length * 6), height: 10, itemIndex })),
  cells: entries.map(([text, x]) => ({ rawText: text, x }))
});
const coordinateSource = rows => ({ pageStructures: [{ pageNumber: 1, rows }] });

test('coordinate table uses column positions for a same-row high-confidence link', () => {
  const result = parseMsdsComposition(coordinateSource([
    coordinateRow('3. 구성성분의 명칭 및 함유량', 700, [['3. 구성성분의 명칭 및 함유량', 20]], 1),
    coordinateRow('화학물질명 | 관용명 | CAS No. | 함유량', 680, [['화학물질명', 40], ['관용명', 180], ['CAS No.', 310], ['함유량', 430]], 2),
    coordinateRow('Toluene | Methylbenzene | 108-88-3 | 10%', 660, [['Toluene', 40], ['Methylbenzene', 180], ['108-88-3', 310], ['10%', 430]], 3),
    coordinateRow('4. 응급조치 요령', 640, [['4. 응급조치 요령', 20]], 4)
  ]));
  assert.equal(result.ingredients[0].confidence, 'high');
  assert.equal(result.ingredients[0].source.method, 'same-coordinate-row');
});

test('coordinate row bands keep wrapped name and amount with their CAS', () => {
  const result = parseMsdsComposition(coordinateSource([
    coordinateRow('3. 구성성분의 명칭 및 함유량', 700, [['3. 구성성분의 명칭 및 함유량', 20]], 1),
    coordinateRow('화학물질명 | CAS No. | 함유량', 680, [['화학물질명', 40], ['CAS No.', 310], ['함유량', 430]], 2),
    coordinateRow('Long chemical | 67-64-1 | 1 이상 ~', 660, [['Long chemical', 40], ['67-64-1', 310], ['1 이상 ~', 430]], 3),
    coordinateRow('name | 10 % 미만', 650, [['name', 40], ['10 % 미만', 430]], 4),
    coordinateRow('4. 응급조치 요령', 620, [['4. 응급조치 요령', 20]], 5)
  ]));
  assert.equal(result.ingredients[0].chemicalName, 'Long chemical name');
  assert.equal(result.ingredients[0].amountRaw, '1 이상~10% 미만');
  assert.equal(result.ingredients[0].confidence, 'medium');
});

test('coordinate parser keeps the original invalid CAS in diagnostics', () => {
  const result = parseMsdsComposition(coordinateSource([
    coordinateRow('3. 구성성분의 명칭 및 함유량', 700, [['3. 구성성분의 명칭 및 함유량', 20]], 1),
    coordinateRow('화학물질명 | CAS No. | 함유량', 680, [['화학물질명', 40], ['CAS No.', 310], ['함유량', 430]], 2),
    coordinateRow('Toluene | 108-88-4 | 10%', 660, [['Toluene', 40], ['108-88-4', 310], ['10%', 430]], 3),
    coordinateRow('4. 응급조치 요령', 640, [['4. 응급조치 요령', 20]], 4)
  ]));
  assert.equal(result.ingredients[0].source.casRaw, '108-88-4');
  assert.equal(result.ingredients[0].source.casValid, false);
});

test('single, range, less-than and less-than-or-equal amounts each remain raw', () => {
  const cases = [['10%', '10%'], ['10 - 20', '10 - 20'], ['< 5%', '< 5%'], ['<= 1', '<= 1'], ['0.5~0.8(0.6%)', '0.5~0.8(0.6%)']];
  for (const [input, expected] of cases) assert.equal(parse(section([`Example | - | 7732-18-5 | ${input}`])).ingredients[0].amountRaw, expected);
});

test('a row without an amount is not emitted merely because it has a CAS', () => {
  const result = parse(section(['Toluene | - | 108-88-3 | -']));
  assert.equal(result.status, 'UNRESOLVED');
  assert.deepEqual(result.ingredients, []);
});

test('trade-secret CAS phrases are never replaced from outside knowledge', () => {
  const row = parse(section(['Confidential additive | - | Proprietary | 1~3%'])).ingredients[0];
  assert.equal(row.casValue, null);
  assert.equal(row.casStatus, 'TRADE_SECRET');
});

test('all emitted public rows use only the documented confidence levels', () => {
  const result = parse(section(['Toluene | - | 108-88-3 | 10%', 'Xylene | - | 1330-20-7 | 5%']));
  assert(result.ingredients.every(row => ['high', 'medium', 'low'].includes(row.confidence)));
});

test('unnumbered Korean composition and first-aid headings still bound the section', () => {
  const result = parse(['구성성분의 명칭 및 함유량', koreanHeader, 'Water | - | 7732-18-5 | 100%', '응급조치 요령', 'Toluene | - | 108-88-3 | 99%']);
  assert.deepEqual(result.ingredients.map(row => row.casValue), ['7732-18-5']);
});

test('Balance remains a textual amount and is never converted to a numeric percentage', () => {
  const row = parse(section(['Carrier | - | 7732-18-5 | Balance'])).ingredients[0];
  assert.equal(row.amountRaw, 'Balance');
});
