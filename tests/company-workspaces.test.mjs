import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDB } from './helpers/d1-memory.mjs';
import { hashToken } from '../server/auth-session.js';
import { applications, companies, adminApplications, approveApplication, rejectApplication, departments, departmentItem } from '../server/company-workspaces.js';

const origin = 'https://local.example';
const application = { companyName: '테스트 회사', departmentName: '안전 보건팀', positionTitle: '팀장', reason: '안전보건 업무를 관리합니다.', additionalInfo: '' };

function request(path, { cookie, method = 'GET', data, requestOrigin = origin } = {}) {
  return new Request(origin + path, { method, headers: { Origin: requestOrigin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(['GET', 'HEAD'].includes(method) ? {} : { body: JSON.stringify(data ?? {}) }) });
}

async function call(handler, db, options = {}) {
  const response = await handler({ request: request(options.path || '/', options), env: { DB: db }, params: options.params || {} });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return { status: response.status, data: await response.json() };
}

async function fixture(t) {
  const db = createTestDB(); t.after(() => db.close());
  db.sqlite.exec(readFileSync(new URL('../migrations/0010_company_workspaces.sql', import.meta.url), 'utf8'));
  const users = {};
  for (const name of ['admin', 'applicant', 'ordinary', 'secondAdmin']) {
    const id = crypto.randomUUID(), token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    db.sqlite.prepare('INSERT INTO users (id,email,password_hash,name,company_name,department_name,position) VALUES (?,?,?,?,?,?,?)').run(id, `${name}@example.test`, 'unused', name, 'profile company', 'profile department', 'profile position');
    db.sqlite.prepare('INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').run(crypto.randomUUID(), id, await hashToken(token), new Date(Date.now() + 3600000).toISOString());
    users[name] = { id, cookie: `hsso_session=${token}` };
  }
  const now = new Date().toISOString();
  db.sqlite.prepare('INSERT INTO user_roles VALUES (?,?,?,?)').run(users.admin.id, 'admin', now, now);
  return { db, ...users };
}

async function submit(db, user, data = application) {
  return call(applications, db, { cookie: user.cookie, method: 'POST', data, path: '/api/company-admin-applications' });
}

async function approve(db, admin, id) {
  return call(approveApplication, db, { cookie: admin.cookie, method: 'POST', data: { reviewNote: '확인 완료' }, params: { id }, path: `/api/admin/company-admin-applications/${id}/approve` });
}

test('company administrator application requires login and same-origin', async t => {
  const { db, applicant } = await fixture(t);
  assert.equal((await submit(db, {})).status, 401);
  assert.equal((await call(applications, db, { cookie: applicant.cookie, method: 'POST', data: application, requestOrigin: 'https://evil.example' })).status, 403);
});

test('member submits an application snapshot and cannot duplicate an equivalent pending application', async t => {
  const { db, applicant } = await fixture(t);
  const created = await submit(db, applicant);
  assert.equal(created.status, 201);
  assert.equal(created.data.application.status, 'pending');
  assert.equal(created.data.application.companyName, application.companyName);
  const duplicate = await submit(db, applicant, { ...application, companyName: '  테스트   회사  ' });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error, 'PENDING_APPLICATION_EXISTS');
  const own = await call(applications, db, { cookie: applicant.cookie, path: '/api/company-admin-applications' });
  assert.equal(own.data.applications.length, 1);
});

test('ordinary members cannot read or mutate operator application APIs', async t => {
  const { db, applicant, ordinary } = await fixture(t);
  const created = await submit(db, applicant), id = created.data.application.id;
  assert.equal((await call(adminApplications, db, { cookie: ordinary.cookie, path: '/api/admin/company-admin-applications' })).status, 403);
  assert.equal((await call(approveApplication, db, { cookie: ordinary.cookie, method: 'POST', data: { reviewNote: '' }, params: { id } })).status, 403);
  assert.equal((await call(rejectApplication, db, { cookie: ordinary.cookie, method: 'POST', data: { reviewNote: 'no' }, params: { id } })).status, 403);
});

test('operator approval atomically creates company, first department, administrator membership and event', async t => {
  const { db, admin, applicant } = await fixture(t);
  const created = await submit(db, applicant), id = created.data.application.id;
  const pending = await call(adminApplications, db, { cookie: admin.cookie, path: '/api/admin/company-admin-applications?status=pending' });
  assert.equal(pending.status, 200); assert.equal(pending.data.total, 1); assert.equal(pending.data.applications[0].applicantUserId, applicant.id);
  const result = await approve(db, admin, id);
  assert.equal(result.status, 200);
  const company = db.sqlite.prepare('SELECT * FROM companies').get();
  assert.equal(company.id, result.data.companyId); assert.equal(company.name, application.companyName); assert.equal(company.initial_admin_user_id, applicant.id);
  const department = db.sqlite.prepare('SELECT * FROM company_departments').get();
  assert.equal(department.company_id, company.id); assert.equal(department.name, application.departmentName);
  const membership = db.sqlite.prepare('SELECT * FROM company_memberships').get();
  assert.equal(membership.company_id, company.id); assert.equal(membership.user_id, applicant.id); assert.equal(membership.role, 'company_admin'); assert.equal(membership.status, 'active'); assert.equal(membership.primary_department_id, department.id);
  const reviewed = db.sqlite.prepare('SELECT * FROM company_admin_applications WHERE id=?').get(id);
  assert.equal(reviewed.status, 'approved'); assert.equal(reviewed.approved_company_id, company.id); assert.equal(reviewed.reviewed_by_user_id, admin.id);
  const event = db.sqlite.prepare('SELECT * FROM company_permission_events').get();
  assert.equal(event.action, 'company_admin_approved'); assert.equal(event.target_user_id, applicant.id); assert.equal(event.actor_user_id, admin.id);
  const mine = await call(companies, db, { cookie: applicant.cookie, path: '/api/companies' });
  assert.equal(mine.data.companies[0].role, 'company_admin');
});

test('approval replay cannot create duplicate workspace records', async t => {
  const { db, admin, applicant } = await fixture(t);
  const id = (await submit(db, applicant)).data.application.id;
  assert.equal((await approve(db, admin, id)).status, 200);
  assert.equal((await approve(db, admin, id)).status, 409);
  for (const table of ['companies', 'company_departments', 'company_memberships', 'company_permission_events']) assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 1);
});

test('operator rejects pending application with reviewer details and cannot review it twice', async t => {
  const { db, admin, applicant } = await fixture(t);
  const id = (await submit(db, applicant)).data.application.id;
  const rejected = await call(rejectApplication, db, { cookie: admin.cookie, method: 'POST', data: { reviewNote: '확인 자료가 부족합니다.' }, params: { id } });
  assert.equal(rejected.status, 200);
  const row = db.sqlite.prepare('SELECT * FROM company_admin_applications WHERE id=?').get(id);
  assert.equal(row.status, 'rejected'); assert.equal(row.reviewed_by_user_id, admin.id); assert(row.reviewed_at); assert.equal(row.review_note, '확인 자료가 부족합니다.');
  assert.equal((await approve(db, admin, id)).status, 409);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM companies').get().count, 0);
});

test('company administrator creates, renames and deactivates departments with normalized duplicate protection', async t => {
  const { db, admin, applicant } = await fixture(t);
  const id = (await submit(db, applicant)).data.application.id, companyId = (await approve(db, admin, id)).data.companyId;
  const created = await call(departments, db, { cookie: applicant.cookie, method: 'POST', data: { name: 'BM1 - 기계' }, params: { companyId } });
  assert.equal(created.status, 201);
  assert.equal((await call(departments, db, { cookie: applicant.cookie, method: 'POST', data: { name: '  bm1   - 기계 ' }, params: { companyId } })).status, 409);
  const updated = await call(departmentItem, db, { cookie: applicant.cookie, method: 'PATCH', data: { name: 'BM1 기계', status: 'inactive' }, params: { companyId, departmentId: created.data.department.id } });
  assert.equal(updated.status, 200); assert.equal(updated.data.department.status, 'inactive');
  const listed = await call(departments, db, { cookie: applicant.cookie, params: { companyId } });
  assert.equal(listed.data.departments.length, 2);
});

test('ordinary member and another company administrator cannot access a company departments', async t => {
  const { db, admin, applicant, ordinary, secondAdmin } = await fixture(t);
  let id = (await submit(db, applicant)).data.application.id; const firstCompany = (await approve(db, admin, id)).data.companyId;
  id = (await submit(db, secondAdmin, { ...application, companyName: '다른 회사' })).data.application.id; await approve(db, admin, id);
  for (const user of [ordinary, secondAdmin]) {
    assert.equal((await call(departments, db, { cookie: user.cookie, params: { companyId: firstCompany } })).status, 404);
    assert.equal((await call(departments, db, { cookie: user.cookie, method: 'POST', data: { name: '침입 부서' }, params: { companyId: firstCompany } })).status, 404);
  }
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM company_departments WHERE name='침입 부서'").get().count, 0);
});

test('department mutation validates fields, company state and origin', async t => {
  const { db, admin, applicant } = await fixture(t);
  const id = (await submit(db, applicant)).data.application.id, companyId = (await approve(db, admin, id)).data.companyId;
  assert.equal((await call(departments, db, { cookie: applicant.cookie, method: 'POST', data: { name: '부서', role: 'company_admin' }, params: { companyId } })).status, 400);
  assert.equal((await call(departments, db, { cookie: applicant.cookie, method: 'POST', data: { name: '부서' }, requestOrigin: 'https://evil.example', params: { companyId } })).status, 403);
  db.sqlite.prepare("UPDATE companies SET status='suspended' WHERE id=?").run(companyId);
  assert.equal((await call(departments, db, { cookie: applicant.cookie, params: { companyId } })).status, 403);
});
