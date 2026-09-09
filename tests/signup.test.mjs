import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { onRequest } from '../functions/api/auth/signup.js';

// In-memory mock only: these tests never access Cloudflare or a real database.
const payload = {
  email: ' Person@Example.com ', password: '  valid password  ', name: ' 홍길동 ',
  companyName: ' HSSO ', departmentName: ' 안전팀 ', position: ' 담당자 '
};
const selectSql = 'SELECT id FROM users WHERE email = ? LIMIT 1';
const insertSql = 'INSERT INTO users (id, email, password_hash, name, company_name, department_name, position) VALUES (?, ?, ?, ?, ?, ?, ?)';

function mockDb({ existing = false, selectError, insertError, insertResult } = {}) {
  const rows = new Map();
  const calls = [];
  return {
    rows, calls,
    prepare(sql) {
      assert([selectSql, insertSql].includes(sql), 'SQL must remain static and parameterized');
      return {
        bind(...args) {
          calls.push({ sql, args });
          assert.equal(args.length, sql === selectSql ? 1 : 7);
          return {
            async first() {
              assert.equal(sql, selectSql);
              if (selectError) throw selectError;
              return existing ? { id: 'existing-user' } : rows.get(args[0]) || null;
            },
            async run() {
              assert.equal(sql, insertSql);
              if (insertError) throw insertError;
              if (insertResult) return insertResult;
              const [id, email, passwordHash, name, companyName, departmentName, position] = args;
              if (rows.has(email)) throw new Error('D1_ERROR: UNIQUE constraint failed: users.email: SQLITE_CONSTRAINT');
              rows.set(email, { id, email, passwordHash, name, companyName, departmentName, position });
              return { success: true, meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
}

async function call(input = payload, { db = mockDb(), method = 'POST', origin = 'https://hsso.pages.dev', url = 'https://hsso.pages.dev/api/auth/signup', raw, contentType = 'application/json' } = {}) {
  const headers = {};
  if (origin !== null) headers.Origin = origin;
  if (contentType !== null) headers['Content-Type'] = contentType;
  const request = new Request(url, {
    method, headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: raw === undefined ? JSON.stringify(input) : raw })
  });
  const response = await onRequest({ request, env: { DB: db } });
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).filter(k => /password|hash|salt|stack|sql/i.test(k)), []);
  return { response, body, db };
}

test('success trims profile fields, lowercases email, creates server UUID and returns only public fields', async () => {
  const { response, body, db } = await call({ ...payload, id: 'client-controlled', password_hash: 'client-controlled' });
  assert.equal(response.status, 201);
  assert.match(body.user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(body, { ok: true, user: { id: body.user.id, email: 'person@example.com', name: '홍길동', companyName: 'HSSO', departmentName: '안전팀', position: '담당자' } });
  assert.equal(db.calls.length, 2);
  const stored = db.rows.get(body.user.email).passwordHash;
  const [version, algorithm, iterations, salt, hash] = stored.split('$');
  assert.equal(version, 'v1');
  assert.equal(algorithm, 'pbkdf2_sha256');
  assert.equal(Number(iterations), 100_000);
  assert.match(salt, /^[a-f0-9]{32}$/);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(stored, payload.password);
  assert(!stored.includes(payload.password));
  assert.equal(hash, pbkdf2Sync(payload.password, Buffer.from(salt, 'hex'), Number(iterations), 32, 'sha256').toString('hex'));
  assert.notEqual(hash, pbkdf2Sync(payload.password.trim(), Buffer.from(salt, 'hex'), Number(iterations), 32, 'sha256').toString('hex'));
});

test('same password produces independent salts and hashes', async () => {
  const db = mockDb();
  await call(payload, { db });
  await call({ ...payload, email: 'another@example.com' }, { db });
  const hashes = [...db.rows.values()].map(row => row.passwordHash.split('$'));
  assert.notEqual(hashes[0][3], hashes[1][3]);
  assert.notEqual(hashes[0][4], hashes[1][4]);
});

test('rejects missing, non-string, empty and whitespace-only fields before touching DB', async () => {
  for (const field of Object.keys(payload)) {
    for (const value of [undefined, null, 123, true, [], {}, '', '   ', '\t\n']) {
      const { response, body, db } = await call({ ...payload, [field]: value });
      assert.equal(response.status, 400, field);
      assert.equal(body.field, field);
      assert.equal(db.calls.length, 0);
    }
  }
});

test('validates email format and every length limit', async () => {
  for (const email of ['plain', 'a@b', 'a@@b.com', 'a b@example.com', '.a@example.com', 'a..b@example.com', 'a@-example.com', 'a@exa_mple.com', 'a@b..com', 'a'.repeat(243) + '@example.com']) {
    assert.equal((await call({ ...payload, email })).response.status, 400, email);
  }
  for (const [field, max] of Object.entries({ password: 128, name: 50, companyName: 100, departmentName: 100, position: 50 })) {
    assert.equal((await call({ ...payload, [field]: '가'.repeat(max + 1) })).response.status, 400, field);
  }
  assert.equal((await call({ ...payload, password: '1234567' })).response.status, 400);
  for (const password of ['12345678', '가'.repeat(128)]) {
    assert.equal((await call({ ...payload, password, name: '가'.repeat(50), companyName: '가'.repeat(100), departmentName: '가'.repeat(100), position: '가'.repeat(50) })).response.status, 201);
  }
});

test('invalid JSON, root types and non-JSON content types return 400', async () => {
  assert.equal((await call(payload, { raw: '{' })).body.error, 'INVALID_JSON');
  for (const input of [null, [], 'text', 1, true]) assert.equal((await call(input)).response.status, 400);
  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', null]) {
    const { response, db } = await call(payload, { contentType });
    assert.equal(response.status, 400);
    assert.equal(db.calls.length, 0);
  }
});

test('duplicates are 409 both before insertion and in a concurrent signup race', async () => {
  const first = await call(payload, { db: mockDb({ existing: true }) });
  assert.equal(first.response.status, 409);
  assert.deepEqual(first.body, { ok: false, error: 'EMAIL_ALREADY_EXISTS' });
  assert.equal(first.db.calls.length, 1);
  const db = mockDb();
  const results = await Promise.all([call(payload, { db }), call({ ...payload, email: 'person@example.com' }, { db })]);
  assert.deepEqual(results.map(r => r.response.status).sort(), [201, 409]);
  assert.deepEqual(results.find(r => r.response.status === 409).body, first.body);
  assert.equal(db.rows.size, 1);
  assert.equal(db.calls.filter(c => c.sql === insertSql).length, 2);
  const legacy = await call(payload, { db: mockDb({ insertError: new Error('D1_ERROR', { cause: new Error('UNIQUE constraint failed: users.email') }) }) });
  assert.equal(legacy.response.status, 409);
});

test('non-POST methods return 405 without DB access', async () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']) {
    const { response, body, db } = await call(payload, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
    assert.equal(body.error, 'METHOD_NOT_ALLOWED');
    assert.equal(db.calls.length, 0);
  }
});

test('rejects foreign, null, malformed and deceptive origins; supports same-origin localhost and absent Origin', async () => {
  for (const origin of ['https://other.example', 'null', '', 'https://hsso.pages.dev.evil.example', 'http://hsso.pages.dev', 'https://hsso.pages.dev:444', 'https://hsso.pages.dev@evil.example', 'https://hsso.pages.dev/path']) {
    const { response, body, db } = await call(payload, { origin });
    assert.equal(response.status, 403, origin);
    assert.equal(body.error, 'ORIGIN_NOT_ALLOWED');
    assert.equal(db.calls.length, 0);
  }
  assert.equal((await call(payload, { origin: 'http://localhost:8788', url: 'http://localhost:8788/api/auth/signup' })).response.status, 201);
  assert.equal((await call(payload, { origin: null })).response.status, 201);
});

test('SQL-looking input stays in bound parameters', async () => {
  const name = "Robert'); DROP TABLE users; --";
  const { response, db } = await call({ ...payload, name });
  assert.equal(response.status, 201);
  assert.equal(db.calls[1].sql, insertSql);
  assert.equal(db.calls[1].args[3], name);
});

test('DB failures never expose internal details or become unrelated duplicate errors', async () => {
  const privateError = new Error('secret password SQL SELECT id FROM users; stack trace');
  const cases = [
    null, mockDb({ selectError: privateError }), mockDb({ insertError: privateError }),
    mockDb({ insertError: new Error('UNIQUE constraint failed: users.id') }),
    mockDb({ insertError: new Error('UNIQUE constraint failed: users.email_other') }),
    mockDb({ insertResult: { success: false } }), mockDb({ insertResult: { success: true, meta: { changes: 0 } } })
  ];
  for (const db of cases) {
    const { response, body } = await call(payload, { db });
    assert.equal(response.status, 500);
    assert.deepEqual(body, { ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

test('Web Crypto failure returns generic 500 without attempting INSERT', async () => {
  const original = crypto.subtle.deriveBits;
  crypto.subtle.deriveBits = async () => { throw new Error('sensitive crypto details'); };
  try {
    const { response, body, db } = await call();
    assert.equal(response.status, 500);
    assert.deepEqual(body, { ok: false, error: 'INTERNAL_SERVER_ERROR' });
    assert.equal(db.calls.length, 1);
  } finally {
    crypto.subtle.deriveBits = original;
  }
});
