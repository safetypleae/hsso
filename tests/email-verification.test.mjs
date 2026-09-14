import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDB } from './helpers/d1-memory.mjs';
import { requestEmailCode, verifyEmailCode, sendVerificationEmail, hashVerificationProof } from '../server/email-verification.js';
import { onRequest as signup } from '../functions/api/auth/signup.js';
import { onRequest as login } from '../functions/api/auth/login.js';

const email = 'person@example.com';
const origin = 'https://local.example.test';
const account = { email, password: 'valid password1', name: '이름', companyName: '회사', departmentName: '부서', position: '직급' };
// Deliberately public test placeholders, not credentials; all outbound fetches are stubbed.
const config = { RESEND_API_KEY: 'test-placeholder', EMAIL_FROM: 'fixture@example.test', EMAIL_VERIFICATION_SECRET: 'public-test-placeholder-not-a-real-secret' };
function fixture(t) {
  const db = createTestDB();
  t.after(() => db.close());
  const mails = [];
  const env = { ...config, DB: db };
  const send = (env, mail) => sendVerificationEmail(env, mail, async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.headers.Authorization, 'Bearer test-placeholder');
    assert.equal(options.redirect, 'manual');
    const body = JSON.parse(options.body);
    assert.equal(body.from, config.EMAIL_FROM);
    assert(body.html.includes(mail.code) && body.text.includes(mail.code));
    assert(body.text.includes('10분') && body.text.includes('무시'));
    mails.push({ ...mail, body, options });
    return Response.json({ id: 'mock-delivery' });
  });
  async function call(handler, input = { email }, options = {}) {
    const request = new Request(origin + '/api/auth/test', {
      method: options.method || 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': options.ip || '192.0.2.1', ...options.headers },
      ...(['GET', 'HEAD'].includes(options.method) ? {} : { body: options.raw ?? JSON.stringify(input) })
    });
    const response = await handler({ request, env: options.env || env }, options.send || send);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    if (!response.ok) {
      assert(!JSON.stringify(data).includes(config.EMAIL_VERIFICATION_SECRET));
      assert(!JSON.stringify(data).includes('stack'));
    }
    return { status: response.status, data, response };
  }
  const request = (input, options) => call(requestEmailCode, input, options);
  const verify = mail => call(verifyEmailCode, { email: mail.email, requestId: mail.id, code: mail.code });
  async function proof() { assert.equal((await request()).status, 200); return (await verify(mails.at(-1))).data.proof; }
  return { db, env, mails, call, request, verify, proof };
}

test('send: normalized email, six digits, HMAC only, hashed IP, private response, Resend text/HTML', async t => {
  const f = fixture(t);
  const result = await f.request({ email: ' Person@Example.com ' });
  assert.equal(result.status, 200);
  assert.equal(f.mails.length, 1);
  const mail = f.mails[0];
  assert.equal(mail.email, email);
  assert.match(mail.code, /^\d{6}$/);
  assert.equal(mail.options.headers['Idempotency-Key'], `signup/${mail.id}`);
  const row = f.db.sqlite.prepare('SELECT * FROM email_verifications').get();
  assert.match(row.code_mac, /^[a-f0-9]{64}$/);
  assert.match(row.ip_mac, /^[a-f0-9]{64}$/);
  assert.notEqual(row.code_mac, mail.code);
  assert.equal(row.expires_at - row.created_at, 600000);
  assert.equal(row.resend_available_at - row.created_at, 60000);
  assert.deepEqual(Object.keys(result.data).sort(), ['ok', 'requestId', 'expiresAt', 'resendAvailableAt', 'serverTime'].sort());
});

test('send: invalid email forms rejected without DB writes or sending', async t => {
  const f = fixture(t);
  for (const value of [null, 3, [], '', 'a@b', 'a@@b.com', '.a@b.com', 'a..b@b.com', 'a.@b.com', 'a@-b.com', 'a'.repeat(255) + '@b.com']) assert.equal((await f.request({ email: value })).data.error, 'INVALID_EMAIL');
  assert.equal(f.mails.length, 0);
  assert.equal(f.db.calls.length, 0);
});

test('send: existing user receives 409 and no email', async t => {
  const f = fixture(t);
  const proof = await f.proof();
  assert.equal((await f.call(signup, { ...account, emailVerificationProof: proof })).status, 201);
  assert.equal((await f.request()).data.error, 'EMAIL_ALREADY_EXISTS');
  assert.equal(f.mails.length, 1);
});

test('send: concurrent requests cannot bypass 60 second resend limit', async t => {
  const f = fixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => f.request()));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  for (const result of results.filter(r => r.status !== 200)) {
    assert.equal(result.data.error, 'RESEND_TOO_SOON');
    assert(result.data.retryAfter > 0 && result.data.retryAfter <= 60);
    assert.equal(result.response.headers.get('retry-after'), String(result.data.retryAfter));
  }
  assert.equal(f.mails.length, 1);
});

test('send: rolling email limit 5/hour; expiry opens the window again', async t => {
  const f = fixture(t);
  for (let n = 0; n < 5; n++) {
    f.db.sqlite.exec('UPDATE email_verifications SET resend_available_at = 0');
    assert.equal((await f.request()).status, 200);
  }
  f.db.sqlite.exec('UPDATE email_verifications SET resend_available_at = 0');
  assert.equal((await f.request()).data.error, 'EMAIL_RATE_LIMITED');
  f.db.sqlite.prepare('UPDATE email_verifications SET created_at = ?').run(Date.now() - 3600001);
  assert.equal((await f.request()).status, 200);
});

test('send: concurrent requests cannot bypass IP limit 20/hour', async t => {
  const f = fixture(t);
  const results = await Promise.all(Array.from({ length: 25 }, (_, n) => f.request({ email: `person${n}@example.com` })));
  assert.equal(results.filter(r => r.status === 200).length, 20);
  assert.equal(results.filter(r => r.data.error === 'IP_RATE_LIMITED').length, 5);
  assert.equal(f.mails.length, 20);
  assert.equal((await f.request({ email: 'different@example.com' }, { ip: '192.0.2.2' })).status, 200);
});

test('verify: success produces short-lived hashed proof, code cannot be reused', async t => {
  const f = fixture(t);
  const proof = await f.proof();
  assert.match(proof, /^[a-f0-9]{64}$/);
  const row = f.db.sqlite.prepare('SELECT * FROM email_verifications').get();
  assert.equal(row.proof_hash, await hashVerificationProof(proof));
  assert.notEqual(row.proof_hash, proof);
  assert.equal(row.proof_expires_at - row.verified_at, 600000);
  assert.equal((await f.verify(f.mails[0])).data.error, 'CODE_UNAVAILABLE');
});

test('verify: wrong code increments attempts; correct code still works before fifth failure', async t => {
  const f = fixture(t); await f.request();
  const mail = f.mails[0];
  const wrong = { ...mail, code: mail.code === '000000' ? '000001' : '000000' };
  const result = await f.verify(wrong);
  assert.equal(result.data.error, 'INVALID_CODE');
  assert.equal(result.data.attemptsRemaining, 4);
  assert.equal((await f.verify(mail)).status, 200);
});

test('verify: parallel wrong guesses stop at 5 and block even the right code', async t => {
  const f = fixture(t); await f.request();
  const mail = f.mails[0];
  const wrong = { ...mail, code: mail.code === '000000' ? '000001' : '000000' };
  const results = await Promise.all(Array.from({ length: 12 }, () => f.verify(wrong)));
  assert(results.every(r => r.status === 400));
  assert.equal(f.db.sqlite.prepare('SELECT attempts FROM email_verifications').get().attempts, 5);
  assert.equal((await f.verify(mail)).data.error, 'CODE_ATTEMPTS_EXCEEDED');
});

test('verify: expired code rejected', async t => {
  const f = fixture(t); await f.request();
  f.db.sqlite.prepare('UPDATE email_verifications SET expires_at = ?').run(Date.now());
  assert.equal((await f.verify(f.mails[0])).data.error, 'CODE_EXPIRED');
});

test('verify: a resend invalidates the old code and proof', async t => {
  const f = fixture(t); const proof = await f.proof();
  f.db.sqlite.exec('UPDATE email_verifications SET resend_available_at = 0');
  await f.request();
  assert.equal((await f.call(signup, { ...account, emailVerificationProof: proof })).data.error, 'EMAIL_VERIFICATION_REQUIRED');
  assert.equal((await f.verify(f.mails[0])).status, 400);
  f.db.sqlite.exec('UPDATE email_verifications SET resend_available_at = 0');
  await f.request();
  assert.equal((await f.verify(f.mails[1])).status, 400);
  assert.equal((await f.verify(f.mails[2])).status, 200);
});

test('verify: parallel correct requests issue only one proof', async t => {
  const f = fixture(t); await f.request();
  const results = await Promise.all(Array.from({ length: 8 }, () => f.verify(f.mails[0])));
  assert.equal(results.filter(r => r.status === 200).length, 1);
});

test('signup: no proof, invented verified flag, malformed or invented proof all rejected', async t => {
  const f = fixture(t);
  const original = crypto.subtle.deriveBits;
  crypto.subtle.deriveBits = async () => { assert.fail('Invalid proof must be rejected before password hashing'); };
  t.after(() => { crypto.subtle.deriveBits = original; });
  for (const proof of [undefined, null, 12, '', 'invalid', '0'.repeat(64)]) {
    const result = await f.call(signup, { ...account, verified: true, emailVerificationProof: proof });
    assert.equal(result.data.error, 'EMAIL_VERIFICATION_REQUIRED');
  }
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
});

test('code generation uses rejection sampling and preserves leading zeroes', async t => {
  const f = fixture(t);
  const original = crypto.getRandomValues;
  let calls = 0;
  crypto.getRandomValues = array => { assert(array instanceof Uint32Array); array[0] = calls++ === 0 ? 4294967295 : 7; return array; };
  try {
    assert.equal((await f.request()).status, 200);
    assert.equal(f.mails[0].code, '000007');
    assert.equal(calls, 2);
  } finally { crypto.getRandomValues = original; }
});

test('code verification is bound to both request ID and normalized email', async t => {
  const f = fixture(t); await f.request();
  const mail = f.mails[0];
  assert.equal((await f.verify({ ...mail, email: 'other@example.com' })).data.error, 'CODE_UNAVAILABLE');
  assert.equal((await f.verify({ ...mail, id: crypto.randomUUID() })).data.error, 'CODE_UNAVAILABLE');
  assert.equal((await f.verify({ ...mail, email: ' Person@Example.com ' })).status, 200);
});

test('signup: proof cannot authorize a different email', async t => {
  const f = fixture(t); const proof = await f.proof();
  assert.equal((await f.call(signup, { ...account, email: 'other@example.com', emailVerificationProof: proof })).data.error, 'EMAIL_VERIFICATION_REQUIRED');
  assert.equal(f.db.sqlite.prepare('SELECT consumed_at FROM email_verifications').get().consumed_at, null);
});

test('signup: expired proof rejected', async t => {
  const f = fixture(t); const proof = await f.proof();
  f.db.sqlite.prepare('UPDATE email_verifications SET proof_expires_at = ?').run(Date.now());
  assert.equal((await f.call(signup, { ...account, emailVerificationProof: proof })).data.error, 'EMAIL_VERIFICATION_REQUIRED');
});

test('signup: verified signup consumes proof; existing password hashing and login work', async t => {
  const f = fixture(t); const proof = await f.proof();
  assert.equal((await f.call(signup, { ...account, emailVerificationProof: proof })).status, 201);
  assert(f.db.sqlite.prepare('SELECT consumed_at FROM email_verifications').get().consumed_at > 0);
  assert.equal((await f.call(login, { email, password: account.password })).status, 200);
  assert.equal((await f.call(signup, { ...account, emailVerificationProof: proof })).status, 409);
  // Even deleting the account cannot make its consumed proof valid again.
  f.db.sqlite.exec('DELETE FROM sessions; DELETE FROM users');
  assert.equal((await f.call(signup, { ...account, emailVerificationProof: proof })).data.error, 'EMAIL_VERIFICATION_REQUIRED');
});

test('signup: concurrent use of the same proof creates at most one account', async t => {
  const f = fixture(t); const proof = await f.proof();
  const results = await Promise.all(Array.from({ length: 6 }, () => f.call(signup, { ...account, emailVerificationProof: proof })));
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert(results.every(r => [201, 400, 409].includes(r.status)));
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
});

test('signup: proof consumption failure rolls back user insert, allowing a safe retry', async t => {
  const f = fixture(t); const proof = await f.proof();
  f.db.sqlite.exec("CREATE TRIGGER fail_consumption BEFORE UPDATE OF consumed_at ON email_verifications BEGIN SELECT RAISE(ABORT, 'private test failure'); END");
  const result = await f.call(signup, { ...account, emailVerificationProof: proof });
  assert.deepEqual(result.data, { ok: false, error: 'INTERNAL_SERVER_ERROR' });
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  assert.equal(f.db.sqlite.prepare('SELECT consumed_at FROM email_verifications').get().consumed_at, null);
  f.db.sqlite.exec('DROP TRIGGER fail_consumption');
  assert.equal((await f.call(signup, { ...account, emailVerificationProof: proof })).status, 201);
});

test('signup: invalid password rejected without consuming verification', async t => {
  const f = fixture(t); const proof = await f.proof();
  for (const password of ['12345678', 'abcdefgh', 'a123', 'a1' + 'x'.repeat(127)]) assert.equal((await f.call(signup, { ...account, password, emailVerificationProof: proof })).data.error, 'INVALID_PASSWORD');
  assert.equal(f.db.sqlite.prepare('SELECT consumed_at FROM email_verifications').get().consumed_at, null);
});

test('configuration: every missing env value fails safely before DB writes or sending', async t => {
  const f = fixture(t);
  for (const key of ['DB', 'RESEND_API_KEY', 'EMAIL_FROM', 'EMAIL_VERIFICATION_SECRET']) {
    assert.equal((await f.request({ email }, { env: { ...f.env, [key]: undefined } })).status, 503);
  }
  assert.equal((await f.request({ email }, { env: { ...f.env, EMAIL_VERIFICATION_SECRET: 'short' } })).status, 503);
  assert.equal(f.db.calls.length, 0);
  assert.equal(f.mails.length, 0);
});

test('delivery: rejection or timeout leaves unusable request and preserves quotas', async t => {
  const f = fixture(t);
  let captured;
  const result = await f.request({ email }, { send: async (_, mail) => { captured = mail; throw new Error('private resend failure'); } });
  assert.equal(result.data.error, 'EMAIL_SEND_FAILED');
  assert.equal((await f.verify(captured)).data.error, 'CODE_UNAVAILABLE');
  assert.equal((await f.request()).data.error, 'RESEND_TOO_SOON');
  for (const fetcher of [async () => new Response('private', { status: 429 }), async () => { throw new Error('timeout'); }, async () => Response.json({})]) await assert.rejects(sendVerificationEmail(config, captured, fetcher));
});

test('verification endpoints preserve method, Origin, JSON checks and private DB failures', async t => {
  const f = fixture(t);
  for (const handler of [requestEmailCode, verifyEmailCode]) {
    assert.equal((await f.call(handler, { email }, { method: 'GET' })).status, 405);
    assert.equal((await f.call(handler, { email }, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await f.call(handler, { email }, { headers: { 'Content-Type': 'text/plain' } })).data.error, 'INVALID_CONTENT_TYPE');
    assert.equal((await f.call(handler, { email }, { raw: '{' })).data.error, 'INVALID_JSON');
    assert.equal((await f.call(handler, [])).data.error, 'INVALID_INPUT');
  }
  f.db.fail = true;
  assert.deepEqual((await f.request()).data, { ok: false, error: 'INTERNAL_SERVER_ERROR' });
});

test('cleanup removes only stale verification history, keeping active quotas', async t => {
  const f = fixture(t); await f.request();
  f.db.sqlite.prepare('UPDATE email_verifications SET created_at = ?, resend_available_at = 0').run(Date.now() - 86400001);
  await f.request();
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM email_verifications').get().n, 1);
  assert.equal((await f.request()).status, 429);
});
