import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, call, createSurvey, responsePayload, publicResponses } from './helpers/risk-fixture.mjs';
import { reviewScope, reviewCollection, reviewItem } from '../server/risk-reviews.js';
import { hashToken } from '../server/auth-session.js';

function apply(db, name) { db.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')); }

async function setup(t) {
  const context = await fixture(t); apply(context.db, '0010_company_workspaces.sql'); apply(context.db, '0017_risk_response_reviews.sql'); apply(context.db, '0018_risk_assessment_items.sql'); apply(context.db, '0019_risk_improvements.sql');
  const thirdId = crypto.randomUUID(), thirdToken = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  context.db.sqlite.prepare('INSERT INTO users (id,email,password_hash,name,company_name,department_name,position) VALUES (?,?,?,?,?,?,?)').run(thirdId, 'risk-three@example.com', 'unused', '타사 관리자', '다른 회사', '타부서', '관리자');
  context.db.sqlite.prepare('INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').run(crypto.randomUUID(), thirdId, await hashToken(thirdToken), new Date(Date.now() + 3600000).toISOString());
  context.c = { id: thirdId, cookie: `hsso_session=${thirdToken}` };
  const companyA = crypto.randomUUID(), companyB = crypto.randomUUID(), departmentA = crypto.randomUUID(), departmentB = crypto.randomUUID(), now = new Date().toISOString();
  for (const [id, name, admin] of [[companyA, '테스트 회사', context.a.id], [companyB, '다른 회사', context.c.id]]) {
    context.db.sqlite.prepare('INSERT INTO companies VALUES (?,?,?,?,?,?,?)').run(id, name, name, 'active', admin, now, now);
  }
  for (const [id, company, name, creator] of [[departmentA, companyA, '시설팀', context.a.id], [departmentB, companyB, '타부서', context.c.id]]) {
    context.db.sqlite.prepare('INSERT INTO company_departments VALUES (?,?,?,?,?,?,?,?)').run(id, company, name, name, 'active', creator, now, now);
  }
  for (const [user, company, role, department] of [[context.a.id, companyA, 'company_admin', departmentA], [context.b.id, companyA, 'member', departmentA], [context.c.id, companyB, 'company_admin', departmentB]]) {
    context.db.sqlite.prepare('INSERT INTO company_memberships VALUES (?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), company, user, role, 'active', department, '', now, now);
  }
  const survey = await createSurvey(context.db, context.a);
  const responses = [];
  for (const changes of [
    { employeeId: 'R-1', department: '시설팀', hazardDescription: '사다리 추락 위험', improvementSuggestion: '난간 설치' },
    { employeeId: 'R-2', department: '시설팀', hazardDescription: '분전반 전기 위험', improvementSuggestion: '잠금 조치' },
    { employeeId: 'R-3', department: '생산팀', hazardDescription: '바닥 미끄럼', improvementSuggestion: '흡착포 비치' },
    { employeeId: 'R-4', department: '생산팀', hazardDescription: '계단 단차', improvementSuggestion: '표시 보강' }
  ]) {
    const submitted = await call(publicResponses, context.db, { method: 'POST', params: { token: survey.publicToken }, path: `/api/public/risk-surveys/${survey.publicToken}/responses`, data: { ...responsePayload(), ...changes } });
    assert.equal(submitted.status, 201);
  }
  for (const employeeId of ['R-1', 'R-2', 'R-3', 'R-4']) responses.push(context.db.sqlite.prepare('SELECT id FROM risk_responses WHERE employee_id=?').get(employeeId).id);
  return { ...context, companyA, companyB, survey, responses };
}

const get = (context, user = context.a, query = '') => call(reviewCollection, context.db, { cookie: user.cookie, params: { id: context.survey.id }, path: `/api/risk-surveys/${context.survey.id}/reviews${query}` });
const patch = (context, responseId, data, user = context.a) => call(reviewItem, context.db, { cookie: user.cookie, method: 'PATCH', params: { id: context.survey.id, responseId }, path: `/api/risk-surveys/${context.survey.id}/reviews/${responseId}`, data });

async function link(context) {
  return call(reviewScope, context.db, { cookie: context.a.cookie, method: 'POST', params: { id: context.survey.id }, path: `/api/risk-surveys/${context.survey.id}/reviews/scope`, data: { companyId: context.companyA } });
}

test('survey owner links review inbox to an active company_admin workspace once', async t => {
  const context = await setup(t);
  assert.equal((await get(context)).data.error, 'REVIEW_SCOPE_REQUIRED');
  assert.equal((await call(reviewScope, context.db, { cookie: context.b.cookie, method: 'POST', params: { id: context.survey.id }, data: { companyId: context.companyA } })).status, 404);
  const linked = await link(context); assert.equal(linked.status, 201); assert.equal(linked.data.companyId, context.companyA);
  assert.equal((await link(context)).status, 200);
  assert.equal(context.db.sqlite.prepare('SELECT company_id FROM risk_survey_company_scopes WHERE survey_id=?').get(context.survey.id).company_id, context.companyA);
});

test('accepted, hold with or without note, and both rejection kinds persist on re-query', async t => {
  const context = await setup(t); await link(context);
  const original = context.db.sqlite.prepare('SELECT * FROM risk_responses WHERE id=?').get(context.responses[0]);
  const accepted = await patch(context, context.responses[0], { reviewStatus: 'ACCEPTED', rejectionReason: null, reviewNote: '' });
  assert.equal(accepted.status, 200); assert.equal(accepted.data.review.reviewedBy, context.a.id); assert.ok(Date.parse(accepted.data.review.reviewedAt));
  assert.equal((await patch(context, context.responses[1], { reviewStatus: 'HOLD', rejectionReason: null, reviewNote: '' })).status, 200);
  assert.equal((await patch(context, context.responses[2], { reviewStatus: 'HOLD', rejectionReason: null, reviewNote: '현장 확인 필요' })).data.review.reviewNote, '현장 확인 필요');
  assert.equal((await patch(context, context.responses[3], { reviewStatus: 'REJECTED', rejectionReason: 'DUPLICATE', reviewNote: '' })).data.review.rejectionReason, 'DUPLICATE');
  let refreshed = await get(context), byId = new Map(refreshed.data.responses.map(response => [response.id, response]));
  assert.deepEqual(refreshed.data.summary, { total: 4, unreviewed: 0, accepted: 1, hold: 2, rejected: 1 });
  assert.deepEqual([byId.get(context.responses[1]).reviewStatus, byId.get(context.responses[1]).reviewNote], ['HOLD', '']);
  assert.deepEqual([byId.get(context.responses[2]).reviewStatus, byId.get(context.responses[2]).reviewNote], ['HOLD', '현장 확인 필요']);
  assert.deepEqual([byId.get(context.responses[3]).rejectionReason, byId.get(context.responses[3]).reviewNote], ['DUPLICATE', '']);
  const other = await patch(context, context.responses[3], { reviewStatus: 'REJECTED', rejectionReason: 'OTHER', reviewNote: '추가 확인 내용' });
  assert.deepEqual([other.data.review.rejectionReason, other.data.review.reviewNote], ['OTHER', '추가 확인 내용']);
  refreshed = await get(context); byId = new Map(refreshed.data.responses.map(response => [response.id, response]));
  assert.deepEqual([byId.get(context.responses[3]).rejectionReason, byId.get(context.responses[3]).reviewNote], ['OTHER', '추가 확인 내용']);
  assert.deepEqual(context.db.sqlite.prepare('SELECT * FROM risk_responses WHERE id=?').get(context.responses[0]), original);
});

test('processed opinions can change repeatedly and counts follow the latest state', async t => {
  const context = await setup(t); await link(context); const id = context.responses[0];
  for (const decision of [
    { reviewStatus: 'ACCEPTED', rejectionReason: null, reviewNote: '', counts: [3,1,0,0] },
    { reviewStatus: 'HOLD', rejectionReason: null, reviewNote: '', counts: [3,0,1,0] },
    { reviewStatus: 'REJECTED', rejectionReason: 'ALREADY_REFLECTED', reviewNote: '', counts: [3,0,0,1] },
    { reviewStatus: 'ACCEPTED', rejectionReason: null, reviewNote: '', counts: [3,1,0,0] }
  ]) {
    const { counts, ...payload } = decision; assert.equal((await patch(context, id, payload)).status, 200);
    const refreshed = await get(context); assert.deepEqual([refreshed.data.summary.unreviewed, refreshed.data.summary.accepted, refreshed.data.summary.hold, refreshed.data.summary.rejected], counts);
    assert.equal(refreshed.data.responses.find(response => response.id === id).reviewStatus, payload.reviewStatus);
  }
});

test('rejected reason and OTHER note validation are enforced', async t => {
  const context = await setup(t); await link(context);
  assert.equal((await patch(context, context.responses[0], { reviewStatus: 'REJECTED', rejectionReason: null, reviewNote: '' })).status, 400);
  assert.equal((await patch(context, context.responses[0], { reviewStatus: 'REJECTED', rejectionReason: 'OTHER', reviewNote: '' })).data.error, 'REVIEW_NOTE_REQUIRED');
  assert.equal((await patch(context, context.responses[0], { reviewStatus: 'REJECTED', rejectionReason: 'DUPLICATE', reviewNote: '기본 사유 메모' })).status, 400);
  assert.equal((await patch(context, context.responses[0], { reviewStatus: 'HOLD', rejectionReason: 'DUPLICATE', reviewNote: '' })).status, 400);
});

test('summary, department/status filters and simple text search are exact and consistent', async t => {
  const context = await setup(t); await link(context);
  await patch(context, context.responses[0], { reviewStatus: 'ACCEPTED', rejectionReason: null, reviewNote: '' });
  await patch(context, context.responses[1], { reviewStatus: 'HOLD', rejectionReason: null, reviewNote: '전기 담당 확인' });
  await patch(context, context.responses[2], { reviewStatus: 'REJECTED', rejectionReason: 'IMPROVEMENT_COMPLETED', reviewNote: '' });
  const all = await get(context); assert.deepEqual(all.data.summary, { total: 4, unreviewed: 1, accepted: 1, hold: 1, rejected: 1 });
  assert.deepEqual(all.data.departments, ['생산팀', '시설팀']);
  const department = await get(context, context.a, `?department=${encodeURIComponent('시설팀')}`); assert.equal(department.data.responses.length, 2); assert.deepEqual(department.data.summary, { total: 2, unreviewed: 0, accepted: 1, hold: 1, rejected: 0 });
  const status = await get(context, context.a, '?status=HOLD'); assert.equal(status.data.responses.length, 1); assert.equal(status.data.responses[0].reviewNote, '전기 담당 확인');
  const search = await get(context, context.a, `?q=${encodeURIComponent('미끄럼')}`); assert.equal(search.data.responses.length, 1); assert.equal(search.data.responses[0].reviewStatus, 'REJECTED');
});

test('ordinary members and administrators from another company cannot read or change reviews', async t => {
  const context = await setup(t); await link(context);
  assert.equal((await get(context, context.b)).status, 403);
  assert.equal((await patch(context, context.responses[0], { reviewStatus: 'ACCEPTED', rejectionReason: null, reviewNote: '' }, context.b)).status, 403);
  assert.equal((await get(context, context.c)).status, 404);
  assert.equal((await patch(context, context.responses[0], { reviewStatus: 'ACCEPTED', rejectionReason: null, reviewNote: '' }, context.c)).status, 404);
  assert.equal(context.db.sqlite.prepare('SELECT COUNT(*) AS count FROM risk_response_reviews').get().count, 0);
});
