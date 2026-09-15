import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { fixture, call, createSurvey, surveyPayload, responsePayload, publicResponses, surveyCollection } from './helpers/risk-fixture.mjs';
import { onRequest as statistics } from '../functions/api/risk-surveys/[id]/statistics.js';
import { onRequest as xlsx } from '../functions/api/risk-surveys/[id]/responses.xlsx.js';
import { summarizeQuestions } from '../server/risk-statistics.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const questions = [...html.matchAll(/<li id="survey-question-(\d)">([\s\S]*?)(?=<li id="survey-question-|<\/ol>)/g)].map(([, id, content]) => ({
  id: `q${id}`, type: 'test', text: /<h3>(.*?)<\/h3>/.exec(content)[1], options: [...content.matchAll(/<li>(.*?)<\/li>/g)].map(match => match[1])
}));
questions.push({ id: 'safe_reason', type: 'single_choice', text: '안전 사유', options: ['절차 준수', '기타'] });
async function seed(t, count = 3) {
  const context = await fixture(t), { db, a } = context;
  const survey = await createSurvey(db, a, { ...surveyPayload(), questions });
  for (let i = 0; i < count; i++) {
    const safe = i === 2;
    const data = { ...responsePayload(), employeeId: `E${i}`, department: i % 2 ? '다른 부서' : 'BM오션', respondentName: i === 0 ? '=HYPERLINK("악성")' : '응답자',
      hazardTypes: ['추락', '전기'], hazardDescription: '한글 <태그> & 줄바꿈\n원본 응답', ...(safe ? { hasHazard: false, hazardTypes: [], hazardDescription: '', location: '', improvementSuggestion: '', preLikelihood: null, preSeverity: null, postLikelihood: null, postSeverity: null, safeReason: '절차 준수' } : {}) };
    assert.equal((await call(publicResponses, db, { method: 'POST', params: { token: survey.publicToken }, data })).status, 201);
  }
  return { ...context, survey };
}
const get = (handler, context, query = '', cookie = context.a.cookie) => call(handler, context.db, { cookie, params: { id: context.survey.id }, path: `/api/risk-surveys/${context.survey.id}/${handler === statistics ? 'statistics' : 'responses.xlsx'}${query}` });

// Independent ZIP reader validates checksums and central directory references.
export function unzipStored(bytes) {
  const data = Buffer.from(bytes), files = new Map(); let offset = 0;
  while (data.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(data.readUInt16LE(offset + 8), 0);
    const size = data.readUInt32LE(offset + 18), nameLength = data.readUInt16LE(offset + 26), extraLength = data.readUInt16LE(offset + 28);
    const name = data.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength, payload = data.subarray(start, start + size);
    assert.equal(crc32(payload), data.readUInt32LE(offset + 14));
    files.set(name, { text: payload.toString('utf8'), offset }); offset = start + size;
  }
  const directoryOffset = offset; let entries = 0;
  while (data.readUInt32LE(offset) === 0x02014b50) {
    const nameLength = data.readUInt16LE(offset + 28), name = data.subarray(offset + 46, offset + 46 + nameLength).toString();
    assert.equal(data.readUInt32LE(offset + 42), files.get(name).offset);
    offset += 46 + nameLength + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32); entries++;
  }
  assert.equal(data.readUInt32LE(offset), 0x06054b50); assert.equal(data.readUInt16LE(offset + 10), entries);
  assert.equal(data.readUInt32LE(offset + 16), directoryOffset);
  return new Map([...files].map(([name, value]) => [name, value.text]));
}

test('statistics uses all responses, stored question order, branch denominators and text', async t => {
  const context = await seed(t, 25), result = await get(statistics, context);
  assert.equal(result.status, 200); assert.equal(result.data.total, 25);
  assert.deepEqual(result.data.questions.map(q => q.id), questions.map(q => q.id));
  const [yes, hazards, description, location, before, improvement, after, photo, safe] = result.data.questions;
  assert.deepEqual(yes.distribution, [{ label: '예', count: 24, percent: 96 }, { label: '아니오', count: 1, percent: 4 }]);
  assert.equal(hazards.answered, 24); assert.equal(hazards.distribution.find(v => v.label === '추락').percent, 100);
  assert.equal(hazards.distribution.find(v => v.label === '전기').count, 24);
  assert.equal(hazards.distribution.find(v => v.label === '화학물질').count, 0);
  assert.equal(description.answers.length, 24); assert.match(description.answers[0], /한글 <태그> & 줄바꿈\n원본 응답/);
  assert.equal(location.kind, 'text'); assert.equal(before.average, 20); assert.equal(after.average, 4);
  assert.equal(improvement.answers.length, 24); assert.equal(photo.kind, 'photos'); assert.equal(safe.answered, 1);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
});

test('department exact filter drives every statistic and preserves available options', async t => {
  const context = await seed(t);
  const result = await get(statistics, context, '?department=' + encodeURIComponent('BM오션'));
  assert.equal(result.data.total, 2); assert.equal(result.data.questions[0].distribution[0].percent, 50);
  assert.equal(result.data.questions[2].answers.length, 1); assert.equal(result.data.questions[8].answered, 1);
  assert.deepEqual(result.data.availableFilters.departments, ['BM오션', '다른 부서']);
  assert.equal((await get(statistics, context, '?department=BM')).data.total, 0);
  assert.equal((await get(statistics, context, '?department=' + encodeURIComponent("' OR 1=1 --"))).data.total, 0);
});

test('workplace is unsupported: reject workplace and compound filters on both endpoints', async t => {
  const context = await seed(t);
  assert.equal((await get(statistics, context)).data.availableFilters.workplaceSupported, false);
  for (const handler of [statistics, xlsx]) {
    for (const query of ['?workplace=site', '?workplace=site&department=BM', '?department=one&department=two', '?unknown=value']) {
      const result = await get(handler, context, query); assert.equal(result.status, 400);
      if (query.includes('workplace')) assert.equal(result.data.error, 'WORKPLACE_FILTER_UNSUPPORTED');
    }
    assert.equal((await get(handler, context, '?workplace=&department=' + encodeURIComponent('BM오션'))).status, 200);
  }
});

test('statistics and Excel require live owner session, including direct ID access', async t => {
  const context = await seed(t), other = await createSurvey(context.db, context.b);
  for (const handler of [statistics, xlsx]) {
    assert.equal((await get(handler, context, '', '')).status, 401);
    assert.equal((await get(handler, context, '', context.b.cookie)).status, 404);
    assert.equal((await get(handler, { ...context, survey: other })).status, 404);
    assert.equal((await get(handler, { ...context, survey: { id: 'invalid' } })).status, 404);
    assert.equal((await call(handler, context.db, { cookie: context.a.cookie, method: 'POST', params: { id: context.survey.id }, data: {} })).status, 405);
  }
  context.db.sqlite.exec("UPDATE sessions SET expires_at='2000-01-01'");
  for (const handler of [statistics, xlsx]) assert.equal((await get(handler, context)).status, 401);
});

test('empty survey and empty department have zero counts and valid header-only workbooks', async t => {
  const context = await seed(t, 0);
  for (const query of ['', '?department=missing']) {
    const result = await get(statistics, context, query);
    assert.equal(result.data.total, 0); assert(result.data.questions.every(q => q.answered === 0));
    assert.equal(result.data.questions[4].average, null);
    const excel = await get(xlsx, context, query), files = unzipStored(await excel.response.arrayBuffer());
    const sheet = files.get('xl/worksheets/sheet1.xml');
    assert.equal([...sheet.matchAll(/<row /g)].length, 1); assert.match(sheet, /autoFilter ref="A1:T1"/);
  }
});

test('Excel is a real UTF-8 XLSX, filtered original rows, numeric scores and formula-safe strings', async t => {
  const context = await seed(t);
  for (const [query, count] of [['', 3], ['?department=' + encodeURIComponent('BM오션'), 2]]) {
    const result = await get(xlsx, context, query); assert.equal(result.status, 200);
    assert.equal(result.response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(result.response.headers.get('content-disposition'), /\.xlsx/); assert.equal(result.response.headers.get('cache-control'), 'no-store');
    const files = unzipStored(await result.response.arrayBuffer()); assert.equal(files.size, 5);
    const sheet = files.get('xl/worksheets/sheet1.xml');
    assert.equal([...sheet.matchAll(/<row /g)].length, count + 1);
    assert.match(sheet, /개선 후 예상 위험성/); assert.match(sheet, /한글 &lt;태그&gt; &amp; 줄바꿈\n원본 응답/);
    assert.match(sheet, /t="inlineStr"><is><t xml:space="preserve">=HYPERLINK\(&quot;악성&quot;\)/);
    assert.doesNotMatch(sheet, /<f[ >]/); assert.match(sheet, /<c r="M\d+"><v>20<\/v>/);
    assert.match(sheet, /state="frozen"/); assert.match(sheet, /autoFilter/);
    if (query) assert.doesNotMatch(sheet, /다른 부서/);
  }
});

test('anonymous responses stay in all departments and never expose identity in Excel', async t => {
  const context = await seed(t, 0);
  const data = { ...responsePayload(), isAnonymous: true, department: '숨긴부서', respondentName: '숨긴이름', employeeId: '숨긴사번' };
  assert.equal((await call(publicResponses, context.db, { method: 'POST', params: { token: context.survey.publicToken }, data })).status, 201);
  const all = await get(statistics, context); assert.equal(all.data.total, 1); assert.deepEqual(all.data.availableFilters.departments, []);
  assert.equal((await get(statistics, context, '?department=' + encodeURIComponent('숨긴부서'))).data.total, 0);
  const excel = await get(xlsx, context), sheet = unzipStored(await excel.response.arrayBuffer()).get('xl/worksheets/sheet1.xml');
  assert.doesNotMatch(sheet, /숨긴/); assert.match(sheet, /익명/);
});

test('first survey and every subsequent survey retain their own publicToken', async t => {
  const context = await seed(t, 0), second = await createSurvey(context.db, context.a);
  const result = await call(surveyCollection, context.db, { cookie: context.a.cookie });
  const tokens = new Map([context.survey, second].map(s => [s.id, s.publicToken]));
  assert.equal(result.data.surveys.length, 2);
  for (const survey of result.data.surveys) assert.equal(survey.publicToken, tokens.get(survey.id));
});

test('unknown question IDs do not guess mappings; stored order is retained', () => {
  const result = summarizeQuestions([{ id: 'q7', text: '후' }, { id: 'custom', text: '커스텀' }, { id: 'q1', text: '여부' }], []);
  assert.deepEqual(result.map(q => q.id), ['q7', 'custom', 'q1']); assert.equal(result[1].kind, 'unsupported');
});
