import test from 'node:test';
import assert from 'node:assert/strict';
import { initEmailVerification } from '../email-verification-ui.js';

class Element extends EventTarget {
  value = '';
  disabled = false;
  hidden = false;
  textContent = '';
  focus() { this.focused = true; }
  checkValidity() { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.value); }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
  const ids = ['signup-send-code', 'signup-code-area', 'signup-code', 'signup-verify-code', 'signup-verification-message', 'signup-verification-timer'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const form = new Element();
  form.elements = { email: new Element() };
  form.elements.email.value = 'person@example.com';
  const button = new Element();
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  globalThis.document = { querySelector: selector => elements[selector.slice(1)] };
  globalThis.window = new EventTarget();
  t.after(() => { globalThis.document = oldDocument; globalThis.window = oldWindow; });
  let now = 1000000, timer, submitting = false;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', callback => { timer = callback; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => { timer = null; });
  const calls = [], responses = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    const response = responses.shift();
    assert(response, 'Unexpected request (real mail sending is never allowed)');
    return typeof response === 'function' ? response() : response;
  });
  const ui = initEmailVerification(form, button, () => submitting);
  const get = name => elements['signup-' + name];
  async function click(name) { get(name).dispatchEvent(new Event('click')); await settle(); }
  async function changeEmail(value) { form.elements.email.value = value; form.elements.email.dispatchEvent(new Event('input')); await settle(); }
  async function send() {
    responses.push(Response.json({ ok: true, requestId: 'request-id', serverTime: 500, expiresAt: 600500, resendAvailableAt: 60500 }));
    await click('send-code');
  }
  async function verify() {
    get('code').value = '000007';
    responses.push(Response.json({ ok: true, proof: 'a'.repeat(64), serverTime: 500, proofExpiresAt: 600500 }));
    await click('verify-code');
  }
  return { form, button, ui, get, calls, responses, click, changeEmail, send, verify,
    advance: ms => { now += ms; timer?.(); }, busy: value => { submitting = value; ui.render(); } };
}

test('UI: verification gates signup, shows countdown, and expires proof', async t => {
  const f = fixture(t);
  assert(f.button.disabled);
  await f.send();
  assert(!f.get('code-area').hidden);
  assert(f.get('send-code').disabled);
  assert.match(f.get('verification-timer').textContent, /10:00/);
  await f.verify();
  assert.equal(f.ui.getProof(), 'a'.repeat(64));
  assert(!f.button.disabled);
  assert(f.get('verify-code').disabled);
  assert.match(f.get('verification-message').textContent, /인증이 완료/);
  f.busy(true); assert(f.button.disabled);
  f.busy(false); assert(!f.button.disabled);
  f.advance(600000);
  assert(f.button.disabled);
  assert.equal(f.ui.getProof(), null);
  assert.match(f.get('verification-message').textContent, /만료/);
  assert(!f.get('send-code').disabled);
});

test('UI: code expiry, cooldown, wrong code and five-failure message', async t => {
  const f = fixture(t); await f.send();
  f.advance(60000);
  assert(!f.get('send-code').disabled);
  f.get('code').value = '1';
  await f.click('verify-code');
  assert.equal(f.calls.length, 1);
  f.get('code').value = '000000';
  f.responses.push(Response.json({ ok: false, error: 'INVALID_CODE' }, { status: 400 }));
  await f.click('verify-code');
  assert.match(f.get('verification-message').textContent, /올바르지/);
  f.responses.push(Response.json({ ok: false, error: 'CODE_ATTEMPTS_EXCEEDED' }, { status: 400 }));
  await f.click('verify-code');
  assert.match(f.get('verification-message').textContent, /5회/);
  assert(f.get('verify-code').disabled);
  await f.send();
  f.advance(600000);
  assert.match(f.get('verification-message').textContent, /만료/);
  assert(f.get('verify-code').disabled);
});

test('UI: changing email and changing back never restores proof; reset/pagehide clear state', async t => {
  const f = fixture(t); await f.send(); await f.verify();
  await f.changeEmail('other@example.com');
  assert(f.button.disabled);
  assert(f.get('code-area').hidden);
  await f.changeEmail('person@example.com');
  assert.equal(f.ui.getProof(), null);
  await f.send(); await f.verify();
  f.form.dispatchEvent(new Event('reset'));
  assert.equal(f.ui.getProof(), null);
  await f.send(); await f.verify();
  window.dispatchEvent(new Event('pagehide'));
  assert.equal(f.ui.getProof(), null);
});

test('UI: stale send and verification responses cannot authorize a changed email', async t => {
  const f = fixture(t);
  let complete;
  f.responses.push(() => new Promise(resolve => { complete = resolve; }));
  await f.click('send-code');
  await f.changeEmail('changed@example.com');
  complete(Response.json({ ok: true, requestId: 'old-request', serverTime: 0, expiresAt: 600000, resendAvailableAt: 60000 }));
  await settle();
  assert(f.get('code-area').hidden);
  await f.send();
  f.get('code').value = '000007';
  f.responses.push(() => new Promise(resolve => { complete = resolve; }));
  await f.click('verify-code');
  await f.changeEmail('another@example.com');
  await f.changeEmail('changed@example.com');
  complete(Response.json({ ok: true, proof: 'a'.repeat(64), serverTime: 0, proofExpiresAt: 600000 }));
  await settle();
  assert.equal(f.ui.getProof(), null);
  assert(f.button.disabled);
});

test('UI: hourly send limit displays Korean feedback and retry countdown', async t => {
  const f = fixture(t);
  f.responses.push(Response.json({ ok: false, error: 'EMAIL_RATE_LIMITED', retryAfter: 3600 }, { status: 429 }));
  await f.click('send-code');
  assert.match(f.get('verification-message').textContent, /발송 횟수를 초과/);
  assert.match(f.get('send-code').textContent, /3600초/);
  await f.click('send-code');
  assert.equal(f.calls.length, 1);
  f.advance(3600000);
  assert(!f.get('send-code').disabled);
});

test('UI: network failure restores controls while leaving signup blocked', async t => {
  const f = fixture(t);
  f.responses.push(() => { throw new Error('Simulated offline'); });
  await f.click('send-code');
  assert.match(f.get('verification-message').textContent, /네트워크/);
  assert(!f.get('send-code').disabled);
  assert(f.button.disabled);
});
