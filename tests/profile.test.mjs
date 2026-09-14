import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDB } from './helpers/d1-memory.mjs';
import { hashToken } from '../server/auth-session.js';
import { onRequest as profile } from '../functions/api/auth/profile.js';
import { onRequest as me } from '../functions/api/auth/me.js';

const origin = 'https://local.example';
const validProfile = { name: 'Changed', companyName: 'New Company', departmentName: 'New Department', position: 'New Position' };
async function fixture(t) {
  const db = createTestDB(); t.after(() => db.close());
  const accounts = [];
  for (const name of ['Owner', 'Other']) {
    const id = crypto.randomUUID(), token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    db.sqlite.prepare('INSERT INTO users (id,email,password_hash,name,company_name,department_name,position) VALUES (?,?,?,?,?,?,?)').run(id, name.toLowerCase() + '@example.test', 'unchanged password hash', name, 'Company', 'Department', 'Position');
    db.sqlite.prepare('INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').run(crypto.randomUUID(), id, await hashToken(token), new Date(Date.now() + 3600000).toISOString());
    accounts.push({ id, cookie: 'hsso_session=' + token });
  }
  return { db, owner: accounts[0], other: accounts[1] };
}
async function call(db, { cookie, body = validProfile, method = 'POST', requestOrigin = origin, raw, contentType = 'application/json', handler = profile } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (requestOrigin !== null) headers.Origin = requestOrigin;
  if (contentType !== null) headers['Content-Type'] = contentType;
  const response = await handler({ env: { DB: db }, request: new Request(origin + '/api/auth/profile', { method, headers, ...(['GET', 'HEAD'].includes(method) ? {} : { body: raw ?? JSON.stringify(body) }) }) });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  return { status: response.status, data: await response.json() };
}
const rows = db => db.sqlite.prepare('SELECT * FROM users ORDER BY id').all();

test('profile rejects anonymous, malformed, forged, expired and revoked sessions', async t => {
  const { db, owner } = await fixture(t), before = rows(db);
  for (const cookie of [undefined, 'hsso_session=invalid', 'hsso_session=' + 'a'.repeat(64)]) assert.equal((await call(db, { cookie })).status, 401);
  db.sqlite.prepare('UPDATE sessions SET expires_at = ?').run(new Date(0).toISOString());
  assert.equal((await call(db, { cookie: owner.cookie })).status, 401);
  db.sqlite.prepare('DELETE FROM sessions').run();
  assert.equal((await call(db, { cookie: owner.cookie })).status, 401);
  assert.deepEqual(rows(db), before);
});

test('profile updates the four authenticated profile fields and /me immediately reads them', async t => {
  const { db, owner, other } = await fixture(t);
  const before = rows(db), sessions = db.sqlite.prepare('SELECT * FROM sessions').all();
  const result = await call(db, { cookie: owner.cookie, body: { name: '  수정 이름  ', companyName: '  수정 회사  ', departmentName: '  수정 부서  ', position: '  수정 직급  ' } });
  assert.equal(result.status, 200); assert.equal(result.data.user.id, owner.id); assert.equal(result.data.user.name, '수정 이름');
  assert.deepEqual(Object.keys(result.data.user).sort(), ['id', 'email', 'name', 'companyName', 'departmentName', 'position'].sort());
  const after = rows(db), saved = after.find(row => row.id === owner.id), original = before.find(row => row.id === owner.id);
  assert.deepEqual({ ...saved, name: original.name, company_name: original.company_name, department_name: original.department_name, position: original.position, updated_at: original.updated_at }, { ...original });
  assert.deepEqual(after.find(row => row.id === other.id), before.find(row => row.id === other.id));
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM sessions').all(), sessions);
  const read = (await call(db, { cookie: owner.cookie, handler: me, method: 'GET' })).data.user;
  assert.deepEqual([read.name, read.companyName, read.departmentName, read.position], ['수정 이름', '수정 회사', '수정 부서', '수정 직급']);
  assert.deepEqual([saved.name, saved.company_name, saved.department_name, saved.position], ['수정 이름', '수정 회사', '수정 부서', '수정 직급']);
});

for (const field of ['user_id', 'id', 'email', 'role', 'isAdmin', 'password', 'password_hash', 'company_name', 'department_name', 'unknown', '__proto__', 'constructor']) {
  test('profile rejects spoofed or read-only field: ' + field, async t => {
    const { db, owner, other } = await fixture(t), before = rows(db);
    const result = await call(db, { cookie: owner.cookie, body: { ...validProfile, [field]: field === 'user_id' || field === 'id' ? other.id : 'attacker' } });
    assert.equal(result.status, 400); assert.equal(result.data.error, 'INVALID_INPUT'); assert.deepEqual(rows(db), before);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM user_roles').get().n, 0);
  });
}

test('profile validates name and accepts the existing 50-code-point limit', async t => {
  const { db, owner } = await fixture(t), before = rows(db);
  for (const body of [null, [], {}, { name: null }, { name: 42 }, { name: '' }, { name: ' \t\n' }, { name: '가'.repeat(51) }]) assert.equal((await call(db, { cookie: owner.cookie, body })).status, 400);
  assert.deepEqual(rows(db), before);
  assert.equal((await call(db, { cookie: owner.cookie, body: { ...validProfile, name: '😀'.repeat(50) } })).status, 200);
  const text = "<img src=x onerror=alert(1)>');--";
  assert.equal((await call(db, { cookie: owner.cookie, body: { ...validProfile, name: text } })).data.user.name, text);
  assert(db.calls.some(c => c.sql.startsWith('UPDATE users') && c.args.includes(text) && !c.sql.includes(text)));
});

test('profile rejects foreign origins, other methods, malformed JSON and oversized bodies', async t => {
  const { db, owner } = await fixture(t), before = rows(db);
  for (const requestOrigin of ['https://evil.example', 'null']) assert.equal((await call(db, { cookie: owner.cookie, requestOrigin })).status, 403);
  for (const method of ['GET', 'PATCH', 'PUT', 'DELETE']) assert.equal((await call(db, { cookie: owner.cookie, method })).status, 405);
  for (const options of [{ raw: '{' }, { raw: ' '.repeat(4097) }, { contentType: 'text/plain' }]) assert.equal((await call(db, { cookie: owner.cookie, ...options })).status, 400);
  assert.deepEqual(rows(db), before);
});

test('profile rechecks session revocation at UPDATE time and DB failures are generic', async t => {
  const { db, owner } = await fixture(t), before = rows(db);
  const prepare = db.prepare.bind(db);
  db.prepare = sql => { if (sql.startsWith('UPDATE users')) db.sqlite.prepare('DELETE FROM sessions').run(); return prepare(sql); };
  assert.equal((await call(db, { cookie: owner.cookie })).status, 401);
  assert.deepEqual(rows(db), before);
  db.fail = true;
  assert.deepEqual(await call(db, { cookie: owner.cookie }), { status: 500, data: { ok: false, error: 'INTERNAL_SERVER_ERROR' } });
});

test('admin can edit own name without modifying their stored role', async t => {
  const { db, owner } = await fixture(t), now = new Date().toISOString();
  db.sqlite.prepare('INSERT INTO user_roles VALUES (?,?,?,?)').run(owner.id, 'admin', now, now);
  const before = db.sqlite.prepare('SELECT * FROM user_roles').all();
  assert.equal((await call(db, { cookie: owner.cookie })).status, 200);
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM user_roles').all(), before);
  assert.equal((await call(db, { cookie: owner.cookie, handler: me, method: 'GET' })).data.role, 'admin');
});

for (const [field, max] of Object.entries({ name: 50, companyName: 100, departmentName: 100, position: 50 })) {
  test('profile validates required type, whitespace and length: ' + field, async t => {
    const { db, owner } = await fixture(t), before = rows(db);
    for (const value of [undefined, null, 1, true, [], {}, '', ' \t\n', '가'.repeat(max + 1)]) {
      assert.equal((await call(db, { cookie: owner.cookie, body: { ...validProfile, [field]: value } })).status, 400);
      assert.deepEqual(rows(db), before);
    }
    const limit = '가'.repeat(max);
    const result = await call(db, { cookie: owner.cookie, body: { ...validProfile, [field]: '  ' + limit + '  ' } });
    assert.equal(result.status, 200); assert.equal(result.data.user[field], limit);
  });
}
