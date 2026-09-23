import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, call, createSurvey, responsePayload, publicResponses } from './helpers/risk-fixture.mjs';
import { reviewScope, reviewItem, reviewCollection } from '../server/risk-reviews.js';
import { assessmentItemCollection, assessmentItem } from '../server/risk-assessment-items.js';
import { hashToken } from '../server/auth-session.js';

const apply = (db, name) => db.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));

async function setup(t) {
  const context = await fixture(t); for (const name of ['0010_company_workspaces.sql','0017_risk_response_reviews.sql','0018_risk_assessment_items.sql','0019_risk_improvements.sql']) apply(context.db, name);
  const outsiderId = crypto.randomUUID(), outsiderToken = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  context.db.sqlite.prepare('INSERT INTO users (id,email,password_hash,name,company_name,department_name,position) VALUES (?,?,?,?,?,?,?)').run(outsiderId, 'assessment-outsider@example.com', 'unused', '타사 관리자', '타사', '타부서', '관리자');
  context.db.sqlite.prepare('INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').run(crypto.randomUUID(), outsiderId, await hashToken(outsiderToken), new Date(Date.now() + 3600000).toISOString());
  context.c = { id: outsiderId, cookie: `hsso_session=${outsiderToken}` };
  const companyA = crypto.randomUUID(), companyB = crypto.randomUUID(), departmentA = crypto.randomUUID(), departmentA2 = crypto.randomUUID(), departmentB = crypto.randomUUID(), now = new Date().toISOString();
  for (const [id,name,admin] of [[companyA,'평가 회사',context.a.id],[companyB,'타사',context.c.id]]) context.db.sqlite.prepare('INSERT INTO companies VALUES (?,?,?,?,?,?,?)').run(id,name,name,'active',admin,now,now);
  for (const [id,company,name,creator] of [[departmentA,companyA,'시설팀',context.a.id],[departmentA2,companyA,'생산팀',context.a.id],[departmentB,companyB,'타부서',context.c.id]]) context.db.sqlite.prepare('INSERT INTO company_departments VALUES (?,?,?,?,?,?,?,?)').run(id,company,name,name,'active',creator,now,now);
  for (const [user,company,role,department] of [[context.a.id,companyA,'company_admin',departmentA],[context.b.id,companyA,'member',departmentA],[context.c.id,companyB,'company_admin',departmentB]]) context.db.sqlite.prepare('INSERT INTO company_memberships VALUES (?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),company,user,role,'active',department,'',now,now);
  const survey = await createSurvey(context.db, context.a), responses = [];
  for (const [index, changes] of [
    { department:'시설팀', employeeId:'A-1', hazardDescription:'보일러실 바닥 물 고임', location:'보일러실', improvementSuggestion:'누수 점검' },
    { department:'생산팀', employeeId:'A-2', hazardDescription:'설비 끼임 위험' },
    { department:'생산팀', employeeId:'A-3', hazardDescription:'통로 적재물' }
  ].entries()) {
    assert.equal((await call(publicResponses, context.db, { method:'POST', params:{token:survey.publicToken}, data:{...responsePayload(),...changes} })).status, 201);
    responses[index] = context.db.sqlite.prepare('SELECT id FROM risk_responses WHERE survey_id=? AND employee_id=?').get(survey.id, changes.employeeId).id;
  }
  assert.equal((await call(reviewScope, context.db, { cookie:context.a.cookie, method:'POST', params:{id:survey.id}, data:{companyId:companyA} })).status, 201);
  for (const [responseId,reviewStatus,rejectionReason] of [[responses[0],'ACCEPTED',null],[responses[1],'HOLD',null],[responses[2],'REJECTED','DUPLICATE']]) {
    assert.equal((await call(reviewItem, context.db, { cookie:context.a.cookie, method:'PATCH', params:{id:survey.id,responseId}, data:{reviewStatus,rejectionReason,reviewNote:''} })).status, 200);
  }
  return {...context,companyA,companyB,departmentA,departmentA2,departmentB,survey,responses};
}

const payload = (context, sourceResponseId = context.responses[0]) => ({ sourceResponseId, departmentId:context.departmentA, workProcess:'보일러실 점검 및 관리', hazardFactor:'작업환경 / 미끄러짐', hazardSituation:'바닥에 고인 물로 이동 중 넘어질 위험', currentMeasures:'정기적인 바닥 청소 실시', likelihood:3, severity:2, riskScore:999, reductionMeasures:'누수 원인 점검 및 미끄럼방지 조치 실시' });
const create = (context, data = payload(context), user = context.a, companyId = context.companyA) => call(assessmentItemCollection, context.db, { cookie:user.cookie, method:'POST', params:{companyId}, path:`/api/companies/${companyId}/risk-assessment-items`, data });
const list = (context, query = '', user = context.a, companyId = context.companyA) => call(assessmentItemCollection, context.db, { cookie:user.cookie, params:{companyId}, path:`/api/companies/${companyId}/risk-assessment-items${query}` });
const itemCall = (context, itemId, { method='GET', data, user=context.a, companyId=context.companyA } = {}) => call(assessmentItem, context.db, { cookie:user.cookie, method, params:{companyId,itemId}, path:`/api/companies/${companyId}/risk-assessment-items/${itemId}`, data });

test('ACCEPTED source creates one traced item with server-calculated risk and preserves the response', async t => {
  const context = await setup(t), original = context.db.sqlite.prepare('SELECT * FROM risk_responses WHERE id=?').get(context.responses[0]);
  const created = await create(context); assert.equal(created.status, 201); assert.equal(created.data.item.riskScore, 6); assert.equal(created.data.item.sourceType, 'SURVEY');
  assert.equal(created.data.item.sourceResponseId, context.responses[0]); assert.equal(created.data.item.sourceSurveyId, context.survey.id); assert.equal(created.data.item.source.hazardDescription, '보일러실 바닥 물 고임');
  assert.equal((await create(context)).data.error, 'SOURCE_ALREADY_CONVERTED');
  assert.deepEqual(context.db.sqlite.prepare('SELECT * FROM risk_responses WHERE id=?').get(context.responses[0]), original);
  const reviews = await call(reviewCollection, context.db, { cookie:context.a.cookie, params:{id:context.survey.id}, path:`/api/risk-surveys/${context.survey.id}/reviews?status=ACCEPTED` });
  assert.equal(reviews.data.responses[0].assessmentItemId, created.data.item.id);
});

test('HOLD, REJECTED, missing and cross-company sources cannot create items', async t => {
  const context = await setup(t);
  assert.equal((await create(context, payload(context, context.responses[1]))).data.error, 'SOURCE_NOT_ACCEPTED');
  assert.equal((await create(context, payload(context, context.responses[2]))).data.error, 'SOURCE_NOT_ACCEPTED');
  assert.equal((await create(context, payload(context, crypto.randomUUID()))).status, 404);
  assert.equal((await create(context, { ...payload(context), departmentId:context.departmentB }, context.c, context.companyB)).status, 404);
  assert.equal(context.db.sqlite.prepare('SELECT COUNT(*) AS count FROM risk_assessment_items').get().count, 0);
});

test('direct items, update, filters, hard delete and source recreation work', async t => {
  const context = await setup(t), directPayload = { ...payload(context, null), sourceResponseId:null, departmentId:context.departmentA2, likelihood:5, severity:4, riskScore:-1 };
  const direct = await create(context, directPayload); assert.equal(direct.status, 201); assert.equal(direct.data.item.sourceType, 'DIRECT'); assert.equal(direct.data.item.riskScore, 20);
  const source = await create(context); assert.equal(source.status, 201);
  const updatedPayload = { ...payload(context), departmentId:context.departmentA2, workProcess:'수정된 작업', likelihood:2, severity:3, riskScore:999 }; delete updatedPayload.sourceResponseId;
  const updated = await itemCall(context, source.data.item.id, { method:'PATCH', data:updatedPayload }); assert.equal(updated.data.item.riskScore, 6); assert.equal(updated.data.item.workProcess, '수정된 작업');
  assert.equal((await list(context, `?department=${encodeURIComponent('생산팀')}`)).data.items.length, 2);
  assert.deepEqual((await list(context, '?source=DIRECT')).data.items.map(item => item.id), [direct.data.item.id]);
  assert.deepEqual((await list(context, '?source=SURVEY')).data.items.map(item => item.id), [source.data.item.id]);
  assert.equal((await itemCall(context, source.data.item.id, { method:'DELETE' })).status, 200);
  assert.equal((await itemCall(context, source.data.item.id)).status, 404);
  assert.equal((await create(context)).status, 201);
});

test('ordinary members and other-company admins cannot create, update, delete or read items', async t => {
  const context = await setup(t), created = await create(context); assert.equal(created.status, 201); const id = created.data.item.id;
  const update = { ...payload(context), riskScore:6 }; delete update.sourceResponseId;
  for (const method of ['PATCH','DELETE']) assert.equal((await itemCall(context,id,{method,data:method==='PATCH'?update:undefined,user:context.b})).status,403);
  assert.equal((await create(context,payload(context),context.b)).status,403); assert.equal((await list(context,'',context.b)).status,403);
  assert.equal((await itemCall(context,id,{user:context.c,companyId:context.companyB})).status,404);
  assert.equal((await itemCall(context,id,{method:'DELETE',user:context.c,companyId:context.companyB})).status,404);
  assert.equal(context.db.sqlite.prepare('SELECT COUNT(*) AS count FROM risk_assessment_items WHERE id=?').get(id).count,1);
});
