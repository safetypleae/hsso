import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDB } from './helpers/d1-memory.mjs';
import { hashToken } from '../server/auth-session.js';
import { invitations, invitationItem, acceptInvitation, members, permissionItem, myPermissions, hasDepartmentPermission, canManageCompanyMsds } from '../server/company-permissions.js';

const origin = 'https://local.example';
function request(path, { cookie, method = 'GET', data, requestOrigin = origin } = {}) {
  return new Request(origin + path, { method, headers: { Origin: requestOrigin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(['GET', 'HEAD'].includes(method) ? {} : { body: JSON.stringify(data ?? {}) }) });
}
async function call(handler, db, options = {}) {
  const response = await handler({ request: request(options.path || '/', options), env: { DB: db }, params: options.params || {} });
  return { status: response.status, data: await response.json() };
}
async function fixture(t) {
  const db = createTestDB(); t.after(() => db.close());
  for (const migration of ['0010_company_workspaces.sql', '0011_company_invitations_permissions.sql']) db.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  const users = {};
  for (const name of ['owner', 'worker', 'wrong', 'otherAdmin']) {
    const id = crypto.randomUUID(), token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    const email = `${name}@example.test`;
    db.sqlite.prepare('INSERT INTO users (id,email,password_hash,name,company_name,department_name,position) VALUES (?,?,?,?,?,?,?)').run(id, email, 'unused', name, 'profile', 'profile', 'profile');
    db.sqlite.prepare('INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').run(crypto.randomUUID(), id, await hashToken(token), new Date(Date.now() + 3600000).toISOString());
    users[name] = { id, email, cookie: `hsso_session=${token}` };
  }
  const now = new Date().toISOString();
  const companyId = crypto.randomUUID(), otherCompanyId = crypto.randomUUID();
  const departmentId = crypto.randomUUID(), secondDepartmentId = crypto.randomUUID(), inactiveDepartmentId = crypto.randomUUID(), otherDepartmentId = crypto.randomUUID();
  db.sqlite.prepare('INSERT INTO companies VALUES (?,?,?,?,?,?,?)').run(companyId, '테스트 회사', '테스트 회사', 'active', users.owner.id, now, now);
  db.sqlite.prepare('INSERT INTO companies VALUES (?,?,?,?,?,?,?)').run(otherCompanyId, '다른 회사', '다른 회사', 'active', users.otherAdmin.id, now, now);
  for (const [id, company, name, status, creator] of [[departmentId, companyId, 'BM1-기계', 'active', users.owner.id], [secondDepartmentId, companyId, 'BM3-도장', 'active', users.owner.id], [inactiveDepartmentId, companyId, '폐쇄 부서', 'inactive', users.owner.id], [otherDepartmentId, otherCompanyId, '타사 부서', 'active', users.otherAdmin.id]]) {
    db.sqlite.prepare('INSERT INTO company_departments VALUES (?,?,?,?,?,?,?,?)').run(id, company, name, name.toLowerCase(), status, creator, now, now);
  }
  db.sqlite.prepare('INSERT INTO company_memberships VALUES (?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), companyId, users.owner.id, 'company_admin', 'active', departmentId, '', now, now);
  db.sqlite.prepare('INSERT INTO company_memberships VALUES (?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), otherCompanyId, users.otherAdmin.id, 'company_admin', 'active', otherDepartmentId, '', now, now);
  return { db, ...users, companyId, otherCompanyId, departmentId, secondDepartmentId, inactiveDepartmentId };
}
const inviteData = (email, departmentId) => ({ email, departmentId, permission: 'msds_manage' });
async function createInvite(f, departmentId = f.departmentId, email = f.worker.email, user = f.owner) {
  return call(invitations, f.db, { cookie: user.cookie, method: 'POST', data: inviteData(email, departmentId), params: { companyId: f.companyId } });
}
const rawToken = result => new URL(result.data.invitePath, origin).searchParams.get('companyInvite');

test('only the owning company administrator can create invitations', async t => {
  const f = await fixture(t);
  assert.equal((await createInvite(f, f.departmentId, f.worker.email, f.worker)).status, 404);
  assert.equal((await createInvite(f, f.departmentId, f.worker.email, f.otherAdmin)).status, 404);
  assert.equal((await call(invitations, f.db, { cookie: f.owner.cookie, method: 'POST', data: inviteData(f.worker.email, f.departmentId), requestOrigin: 'https://evil.example', params: { companyId: f.companyId } })).status, 403);
});

test('invitation validates active company department, email and permission', async t => {
  const f = await fixture(t);
  assert.equal((await createInvite(f, f.inactiveDepartmentId)).status, 400);
  assert.equal((await call(invitations, f.db, { cookie: f.owner.cookie, method: 'POST', data: inviteData('bad email', f.departmentId), params: { companyId: f.companyId } })).status, 400);
  assert.equal((await call(invitations, f.db, { cookie: f.owner.cookie, method: 'POST', data: { email: f.worker.email, departmentId: f.departmentId, permission: 'risk_assessment_manage' }, params: { companyId: f.companyId } })).status, 400);
});

test('normal invitation stores only token hash and blocks duplicate pending invitation', async t => {
  const f = await fixture(t), created = await createInvite(f);
  assert.equal(created.status, 201); assert.equal(created.data.invitation.status, 'pending');
  const token = rawToken(created); assert.match(token, /^[a-f0-9]{64}$/);
  const row = f.db.sqlite.prepare('SELECT * FROM company_invitations').get();
  assert.equal(row.token_hash, await hashToken(token)); assert.equal(JSON.stringify(row).includes(token), false);
  assert.equal((await createInvite(f)).status, 409);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM company_access_events WHERE action='invite_created'").get().count, 1);
});

test('expired pending invitation is marked expired and can be recreated', async t => {
  const f = await fixture(t), created = await createInvite(f);
  f.db.sqlite.prepare('UPDATE company_invitations SET expires_at=? WHERE id=?').run(new Date(0).toISOString(), created.data.invitation.id);
  const listed = await call(invitations, f.db, { cookie: f.owner.cookie, params: { companyId: f.companyId } });
  assert.equal(listed.data.invitations[0].status, 'expired');
  assert.equal((await createInvite(f)).status, 201);
});

test('acceptance requires login and the exact normalized invited email', async t => {
  const f = await fixture(t), token = rawToken(await createInvite(f));
  assert.equal((await call(acceptInvitation, f.db, { params: { token } })).status, 401);
  assert.equal((await call(acceptInvitation, f.db, { cookie: f.wrong.cookie, method: 'POST', data: {}, params: { token } })).status, 403);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM company_memberships WHERE user_id=?').get(f.wrong.id).count, 0);
});

test('acceptance atomically creates membership and department permission and rejects replay', async t => {
  const f = await fixture(t), token = rawToken(await createInvite(f));
  const detail = await call(acceptInvitation, f.db, { cookie: f.worker.cookie, params: { token } });
  assert.equal(detail.status, 200); assert.equal(detail.data.invitation.departmentName, 'BM1-기계');
  const accepted = await call(acceptInvitation, f.db, { cookie: f.worker.cookie, method: 'POST', data: {}, params: { token } });
  assert.equal(accepted.status, 200);
  const membership = f.db.sqlite.prepare('SELECT * FROM company_memberships WHERE company_id=? AND user_id=?').get(f.companyId, f.worker.id);
  assert.equal(membership.role, 'member'); assert.equal(membership.status, 'active');
  const grant = f.db.sqlite.prepare('SELECT * FROM company_permission_grants WHERE company_id=? AND user_id=?').get(f.companyId, f.worker.id);
  assert.equal(grant.department_id, f.departmentId); assert.equal(grant.permission, 'msds_manage'); assert.equal(grant.status, 'active');
  assert.equal((await call(acceptInvitation, f.db, { cookie: f.worker.cookie, method: 'POST', data: {}, params: { token } })).status, 409);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM company_access_events WHERE action='invite_accepted'").get().count, 1);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM company_access_events WHERE action='permission_granted'").get().count, 1);
});

test('existing company member can accept another department and hold multiple grants', async t => {
  const f = await fixture(t);
  let token = rawToken(await createInvite(f));
  await call(acceptInvitation, f.db, { cookie: f.worker.cookie, method: 'POST', data: {}, params: { token } });
  token = rawToken(await createInvite(f, f.secondDepartmentId));
  assert.equal((await call(acceptInvitation, f.db, { cookie: f.worker.cookie, method: 'POST', data: {}, params: { token } })).status, 200);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM company_memberships WHERE company_id=? AND user_id=?").get(f.companyId, f.worker.id).count, 1);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM company_permission_grants WHERE company_id=? AND user_id=? AND status='active'").get(f.companyId, f.worker.id).count, 2);
  const mine = await call(myPermissions, f.db, { cookie: f.worker.cookie }); assert.equal(mine.data.permissions.length, 2);
});

test('company administrator lists members while other companies cannot', async t => {
  const f = await fixture(t), token = rawToken(await createInvite(f));
  await call(acceptInvitation, f.db, { cookie: f.worker.cookie, method: 'POST', data: {}, params: { token } });
  const list = await call(members, f.db, { cookie: f.owner.cookie, params: { companyId: f.companyId } });
  assert.equal(list.status, 200); assert.equal(list.data.members.length, 2);
  assert.equal(list.data.members.find(member => member.userId === f.worker.id).assignments[0].departmentName, 'BM1-기계');
  assert.equal((await call(members, f.db, { cookie: f.otherAdmin.cookie, params: { companyId: f.companyId } })).status, 404);
});

test('company administrator revokes a pending invitation', async t => {
  const f = await fixture(t), created = await createInvite(f), id = created.data.invitation.id;
  assert.equal((await call(invitationItem, f.db, { cookie: f.owner.cookie, method: 'DELETE', params: { companyId: f.companyId, invitationId: id } })).status, 200);
  assert.equal(f.db.sqlite.prepare('SELECT status FROM company_invitations WHERE id=?').get(id).status, 'revoked');
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM company_access_events WHERE action='invite_revoked'").get().count, 1);
  assert.equal((await call(acceptInvitation, f.db, { cookie: f.worker.cookie, method: 'POST', data: {}, params: { token: rawToken(created) } })).status, 409);
});

test('revoking one department permission preserves membership and other department permission', async t => {
  const f = await fixture(t);
  for (const department of [f.departmentId, f.secondDepartmentId]) {
    const token = rawToken(await createInvite(f, department));
    await call(acceptInvitation, f.db, { cookie: f.worker.cookie, method: 'POST', data: {}, params: { token } });
  }
  const grant = f.db.sqlite.prepare('SELECT id FROM company_permission_grants WHERE company_id=? AND user_id=? AND department_id=?').get(f.companyId, f.worker.id, f.departmentId);
  assert.equal((await call(permissionItem, f.db, { cookie: f.owner.cookie, method: 'DELETE', params: { companyId: f.companyId, grantId: grant.id } })).status, 200);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM company_permission_grants WHERE company_id=? AND user_id=? AND status='active'").get(f.companyId, f.worker.id).count, 1);
  assert.equal(f.db.sqlite.prepare("SELECT status FROM company_memberships WHERE company_id=? AND user_id=?").get(f.companyId, f.worker.id).status, 'active');
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM company_access_events WHERE action='permission_revoked'").get().count, 1);
});

test('permission helpers grant company-wide admin access and only assigned department member access', async t => {
  const f = await fixture(t), token = rawToken(await createInvite(f));
  await call(acceptInvitation, f.db, { cookie: f.worker.cookie, method: 'POST', data: {}, params: { token } });
  const env = { DB: f.db };
  assert.equal(await canManageCompanyMsds(env, f.owner.id, f.companyId), true);
  assert.equal(await canManageCompanyMsds(env, f.worker.id, f.companyId, f.departmentId), true);
  assert.equal(await hasDepartmentPermission(env, f.worker.id, f.companyId, f.departmentId, 'msds_manage'), true);
  assert.equal(await canManageCompanyMsds(env, f.worker.id, f.companyId, f.secondDepartmentId), false);
  assert.equal(await hasDepartmentPermission(env, f.worker.id, f.companyId, f.secondDepartmentId, 'msds_manage'), false);
});
