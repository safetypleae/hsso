import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, timingSafeEqual } from 'node:crypto';
import { onRequest as signup } from '../functions/api/auth/signup.js';
import { onRequest as login } from '../functions/api/auth/login.js';
import { onRequest as me } from '../functions/api/auth/me.js';
import { onRequest as logout } from '../functions/api/auth/logout.js';
import { verifyPassword, SESSION_SECONDS } from '../server/auth-session.js';
import { createTestDB } from './helpers/d1-memory.mjs';

const sample = { email: 'tester@example.com', password: '  test password  ', name: '테스트', companyName: '예시 회사', departmentName: '예시 부서', position: '담당자' };
const origin = 'https://hsso.pages.dev';
async function call(handler, db, { method = handler === me ? 'GET' : 'POST', body, cookie, requestOrigin = origin, raw, contentType = 'application/json' } = {}) {
  const headers = {};
  if (requestOrigin !== null) headers.Origin = requestOrigin;
  if (contentType) headers['Content-Type'] = contentType;
  if (cookie) headers.Cookie = cookie;
  const request = new Request(origin + '/api/auth/test', { method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }) });
  const response = await handler({ request, env: { DB: db } });
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const data = await response.json();
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function fixture(t) {
  const db = createTestDB();
  t.after(() => db.close());
  const result = await call(signup, db, { body: sample });
  assert.equal(result.response.status, 201);
  return db;
}
const loggedIn = db => call(login, db, { body: { email: sample.email, password: sample.password } });

test('login verifies actual unchanged signup hash, trims only email, and sets a 7-day secure cookie', async t => {
  const db = await fixture(t);
  const start = Date.now();
  const result = await call(login, db, { body: { email: ' TESTER@EXAMPLE.COM ', password: sample.password, user_id: 'untrusted' } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.ok, true);
  assert.deepEqual(Object.keys(result.data.user).sort(), ['id','email','name','companyName','departmentName','position'].sort());
  const cookie = result.response.headers.get('set-cookie');
  for (const flag of ['HttpOnly','Secure','SameSite=Lax','Path=/','Max-Age=604800','Expires=']) assert(cookie.includes(flag), flag);
  assert(!cookie.includes('Domain='));
  assert.equal(SESSION_SECONDS, 604800);
  const raw = result.cookie.split('=')[1];
  assert.match(raw, /^[a-f0-9]{64}$/);
  const row = db.sqlite.prepare('SELECT * FROM sessions').get();
  assert.notEqual(row.token_hash, raw);
  assert.equal(row.token_hash, createHash('sha256').update(raw).digest('hex'));
  assert.equal(row.user_id, result.data.user.id);
  assert.match(row.id, /^[a-f0-9-]{36}$/);
  assert(Date.parse(row.expires_at) >= start + SESSION_SECONDS * 1000);
  assert(Date.parse(row.expires_at) <= Date.now() + SESSION_SECONDS * 1000);
  assert(!JSON.stringify(result.data).includes(raw));
  assert(!JSON.stringify(row).includes(sample.password));
  assert(db.calls.every(c => !c.sql.includes(sample.email) && !c.sql.includes(sample.password)));
  assert(db.calls.filter(c => /INSERT INTO sessions/.test(c.sql)).every(c => c.args.length === 4 && !c.args.includes(raw)));
});

test('unknown email and wrong password produce identical 401 and no session', async t => {
  const db = await fixture(t);
  const original = crypto.subtle.deriveBits;
  let derives = 0;
  crypto.subtle.deriveBits = function (...args) { derives++; return original.apply(this, args); };
  try {
    for (const credentials of [{email:'missing@example.com',password:sample.password},{email:sample.email,password:'wrong password'},{email:sample.email,password:sample.password.trim()}]) {
      const result = await call(login, db, { body: credentials });
      assert.equal(result.response.status,401);
      assert.deepEqual(result.data,{ok:false,error:'INVALID_CREDENTIALS'});
      assert.equal(result.cookie,undefined);
    }
    assert.equal(derives,3,'missing account still derives a dummy hash');
  } finally { crypto.subtle.deriveBits = original; }
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n,0);
});

test('malformed or unsupported stored hashes fail closed; native timing-safe comparison works', async t => {
  const db = await fixture(t);
  const encoded = db.sqlite.prepare('SELECT password_hash FROM users').get().password_hash;
  const original = crypto.subtle.timingSafeEqual;
  let compares = 0;
  crypto.subtle.timingSafeEqual = (a,b) => { compares++; return timingSafeEqual(Buffer.from(a),Buffer.from(b)); };
  try {
    assert.equal(await verifyPassword(sample.password,encoded),true);
    assert.equal(await verifyPassword('incorrect password',encoded),false);
    for (const bad of [null,'plaintext',encoded.replace('v1','v2'),encoded.replace('100000','999999999'),encoded.replace('100000','0100000'),encoded.slice(0,-1)]) {
      assert.equal(await verifyPassword(sample.password,bad),false);
    }
    assert.equal(compares,8);
  } finally {
    if (original) crypto.subtle.timingSafeEqual=original;
    else delete crypto.subtle.timingSafeEqual;
  }
});

test('every successful login issues an independent token and session id', async t => {
  const db = await fixture(t);
  const a = await loggedIn(db), b = await loggedIn(db);
  assert.notEqual(a.cookie,b.cookie);
  const rows = db.sqlite.prepare('SELECT id,token_hash FROM sessions').all();
  assert.equal(rows.length,2);
  assert.notEqual(rows[0].id,rows[1].id);
  assert.notEqual(rows[0].token_hash,rows[1].token_hash);
});

test('/me joins valid session to user and never exposes hashes, tokens or passwords', async t => {
  const db = await fixture(t);
  const authenticated = await loggedIn(db);
  const result = await call(me,db,{cookie:'other=value; '+authenticated.cookie});
  assert.equal(result.response.status,200);
  assert.deepEqual(result.data,authenticated.data);
  assert.equal(result.cookie,undefined);
  for (const privateValue of [sample.password,authenticated.cookie.split('=')[1],db.sqlite.prepare('SELECT password_hash FROM users').get().password_hash]) assert(!JSON.stringify(result.data).includes(privateValue));
});

test('/me rejects missing, malformed, duplicate, unknown and expired tokens', async t => {
  const db = await fixture(t);
  const authenticated = await loggedIn(db);
  for (const cookie of [undefined,'hsso_session=bad','hsso_session=%00','hsso_session='+'a'.repeat(64),authenticated.cookie+'; '+authenticated.cookie,'x'+authenticated.cookie]) {
    const result=await call(me,db,{cookie});
    assert.equal(result.response.status,401);
    assert.deepEqual(result.data,{ok:false,error:'UNAUTHENTICATED'});
  }
  for (const expiry of [new Date(Date.now()-1000).toISOString(),new Date(0).toISOString(),'not-a-date']) {
    db.sqlite.prepare('UPDATE sessions SET expires_at = ?').run(expiry);
    assert.equal((await call(me,db,{cookie:authenticated.cookie})).response.status,401);
  }
});

test('logout deletes only current hashed session and expires the cookie; repeated logout is safe', async t => {
  const db = await fixture(t);
  const a=await loggedIn(db), b=await loggedIn(db);
  const result=await call(logout,db,{cookie:a.cookie});
  assert.equal(result.response.status,200);
  assert.deepEqual(result.data,{ok:true});
  const cookie=result.response.headers.get('set-cookie');
  for (const part of ['hsso_session=;','Max-Age=0','Expires=Thu, 01 Jan 1970','HttpOnly','Secure','SameSite=Lax','Path=/']) assert(cookie.includes(part));
  assert.equal((await call(me,db,{cookie:a.cookie})).response.status,401);
  assert.equal((await call(me,db,{cookie:b.cookie})).response.status,200);
  for (const cookie of [a.cookie,undefined,'hsso_session=invalid']) assert.equal((await call(logout,db,{cookie})).response.status,200);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n,1);
});

test('deleting user invalidates its sessions through existing foreign key', async t => {
  const db=await fixture(t); const result=await loggedIn(db);
  db.sqlite.prepare('DELETE FROM users WHERE email = ?').run(sample.email);
  assert.equal((await call(me,db,{cookie:result.cookie})).response.status,401);
});

test('login/logout enforce same-origin; all endpoints enforce their HTTP method', async t => {
  const db=await fixture(t);
  for (const handler of [login,logout]) {
    for (const requestOrigin of ['null','https://other.example','http://hsso.pages.dev','https://hsso.pages.dev.evil.example','https://hsso.pages.dev:444']) {
      const result=await call(handler,db,{requestOrigin,body:sample});
      assert.equal(result.response.status,403);
      assert.equal(result.cookie,undefined);
    }
    const method=await call(handler,db,{method:'GET'});
    assert.equal(method.response.status,405);
    assert.equal(method.response.headers.get('allow'),'POST');
  }
  assert.equal((await call(me,db,{method:'POST'})).response.status,405);
  assert.equal((await call(login,db,{body:sample,requestOrigin:null})).response.status,200);
});

test('invalid JSON, types and oversized credentials fail safely', async t => {
  const db=await fixture(t);
  assert.equal((await call(login,db,{raw:'{'})).response.status,400);
  assert.equal((await call(login,db,{body:sample,contentType:'text/plain'})).response.status,400);
  for (const body of [null,[],{}, {email:12,password:'password'},{email:sample.email,password:123}, {email:sample.email,password:'x'.repeat(129)},{email:'x'.repeat(255),password:sample.password}]) {
    const result=await call(login,db,{body}); assert.equal(result.response.status,401); assert.equal(result.cookie,undefined);
  }
});

test('internal DB failures are generic and never falsely issue or clear a session cookie', async t => {
  const db=await fixture(t); const result=await loggedIn(db);
  db.fail=true;
  for (const handler of [login,me,logout]) {
    const failure=await call(handler,db,{body:sample,cookie:result.cookie});
    assert.equal(failure.response.status,500);
    assert.deepEqual(failure.data,{ok:false,error:'INTERNAL_SERVER_ERROR'});
    assert.equal(failure.cookie,undefined);
  }
  db.fail=false;
  assert.equal((await call(me,db,{cookie:result.cookie})).response.status,200);
});
