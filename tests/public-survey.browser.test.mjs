import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fixture, createSurvey } from './helpers/risk-fixture.mjs';
import { surveyCollection, surveyItem, publicSurvey, publicResponses, adminResponses } from '../server/risk-surveys.js';
import { collection as documents } from '../server/documents.js';
import { onRequest as me } from '../functions/api/auth/me.js';
import jsQR from './helpers/vendor/jsqr.cjs';

test('direct public URL, response submission, creation/management QR and PNG scan', { skip: !process.env.HSSO_BROWSER, timeout: 60000 }, async t => {
  const { db, a } = await fixture(t), survey = await createSurvey(db, a);
  const project = fileURLToPath(new URL('..', import.meta.url));
  const redirects = await readFile(join(project, '_redirects'), 'utf8');
  assert.match(redirects, /^\/survey\/\*\s+\/index\.html\s+200/m);
  let base; const requests = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, base), parts = url.pathname.split('/'); requests.push(url.pathname);
      if (url.pathname.startsWith('/api/')) {
        const handler = ({ '/api/auth/me': me, '/api/documents': documents, '/api/risk-surveys': surveyCollection })[url.pathname]
          || (parts[2] === 'public' && parts[3] === 'risk-surveys' ? (parts[5] === 'responses' ? publicResponses : publicSurvey) : null)
          || (parts[2] === 'risk-surveys' ? (parts[4] === 'responses' ? adminResponses : surveyItem) : null);
        if (!handler) { res.writeHead(404).end(); return; }
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const request = new Request(url, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
        const response = await handler({ request, env: { DB: db }, params: { id: parts[3], token: parts[4] } });
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (url.pathname === '/pdf-stub.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }).end('export const GlobalWorkerOptions = {};'); return; }
      // Reproduce the real /survey/* 200 rewrite, including incorrectly resolved assets.
      const relative = url.pathname === '/' || url.pathname.startsWith('/survey/') ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const path = resolve(project, relative); assert(path.startsWith(resolve(project) + sep));
      let content = await readFile(path);
      if (relative === 'index.html') content = content.toString().replace(/<script src="https:[^"]+"><\/script>/g, '');
      if (relative === 'script.js') content = content.toString().replace('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.mjs', '/pdf-stub.js');
      res.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' }[extname(relative)] || 'application/octet-stream' }).end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port;
  t.after(() => { server.closeAllConnections(); server.close(); });
  const profile = await mkdtemp(join(tmpdir(), 'hsso-public-browser-'));
  const child = spawn(process.env.HSSO_BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(async () => {
    if (child.pid && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    assert.equal(dirname(resolve(profile)), resolve(tmpdir())); assert(basename(profile).startsWith('hsso-public-browser-'));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const wsUrl = await new Promise((r, j) => { let log = ''; child.stderr.on('data', d => { log += d; const m = log.match(/DevTools listening on (ws:\/\/\S+)/); if (m) r(m[1]); }); child.once('error', j); child.once('exit', () => j(new Error('Browser exited'))); });
  const ws = new WebSocket(wsUrl); await once(ws, 'open'); t.after(() => ws.close());
  let serial = 0; const pending = new Map(), errors = [];
  ws.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.id) { const task = pending.get(m.id); pending.delete(m.id); m.error ? task.reject(new Error(m.error.message)) : task.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  function send(method, params = {}, sessionId) { return new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }), { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable');
  const evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description); return result.result.value; };
  async function wait(expression) { const until = Date.now() + 5000; while (Date.now() < until) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 30)); } throw new Error('Timed out: ' + expression + '\nRequests: ' + requests.join(', ')); }
  const publicUrl = base + '/survey/' + survey.publicToken;
  await cdp('Page.navigate', { url: publicUrl });
  await wait(`document.readyState==='complete'`);
  assert(requests.includes('/script.js'), 'script.js must load at root. Actual requests: ' + requests.join(', '));
  await wait(`!document.querySelector('#risk-survey-preview').hidden && document.querySelector('#worker-survey-title').textContent==='2026년 위험성평가'`);
  assert(requests.includes(`/api/public/risk-surveys/${survey.publicToken}`));
  assert.equal(await evaluate(`document.querySelector('#home').hidden`), true);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#risk-survey-preview')).maxWidth`), '760px');
  assert.equal(await evaluate(`document.querySelectorAll('link[rel="stylesheet"]').length===Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter(link=>link.sheet).length`), true);
  assert.equal(await evaluate(`document.querySelector('script[src$="script.js"]').src`), base + '/script.js');
  await evaluate(`document.querySelector('#worker-name').value='공개 응답자';document.querySelector('#worker-department').value='BM오션';document.querySelector('#worker-employee-id').value='PUBLIC1';document.querySelector('input[name="workerHasHazard"][value="no"]').click();document.querySelector('input[name="workerSafeReason"]').click();document.querySelector('#worker-submit-button').click()`);
  await wait(`document.querySelector('#worker-submit-message').textContent==='응답이 제출되었습니다.'`);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM risk_responses WHERE survey_id=?').get(survey.id).n, 1);
  // A trailing slash must resolve the same root assets and same public token.
  await cdp('Page.navigate', { url: publicUrl + '/' });
  await wait(`!document.querySelector('#risk-survey-preview')?.hidden && document.querySelector('#worker-survey-title')?.textContent==='2026년 위험성평가'`);
  assert.equal(await evaluate(`document.querySelector('script[src$="script.js"]').src`), base + '/script.js');

  await cdp('Network.setCookie', { name: 'hsso_session', value: a.cookie.split('=')[1], url: base, httpOnly: true, sameSite: 'Lax' });
  await cdp('Page.navigate', { url: base + '/#risk-survey-create' });
  await wait(`location.pathname==='/' && document.querySelector('#risk-survey-create')?.hidden===false`);
  await evaluate(`document.querySelector('#survey-title').value='현장/정기:설문';document.querySelector('#survey-target').value='현장';document.querySelector('#survey-start-date').value='2020-01-01';document.querySelector('#survey-end-date').value='2099-12-31';document.querySelector('#survey-create-button').click()`);
  await wait(`document.querySelector('#survey-action-note a')`);
  const createdUrl = await evaluate(`document.querySelector('#survey-action-note a').href`);
  const created = db.sqlite.prepare('SELECT id,public_token FROM risk_surveys WHERE title=?').get('현장/정기:설문');
  assert.equal(createdUrl, base + '/survey/' + created.public_token);
  assert.equal(await evaluate(`[...document.querySelectorAll('#survey-action-note button')].some(b=>b.textContent==='링크 복사')`), true);
  await evaluate(`window.__qrBlob=null;const originalCreate=URL.createObjectURL;URL.createObjectURL=function(blob){window.__qrBlob=blob;return originalCreate.call(this,blob)};const originalClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__qrFilename=this.download;return}originalClick.call(this)};[...document.querySelectorAll('#survey-action-note button')].find(b=>b.textContent==='QR코드').click()`);
  await wait(`document.querySelector('.risk-qr-dialog canvas')?.hidden===false`);
  assert.equal(await evaluate(`document.querySelector('.risk-qr-url').href`), createdUrl);
  await evaluate(`[...document.querySelectorAll('.risk-qr-dialog button')].find(b=>b.textContent==='PNG 다운로드').click()`);
  await wait(`!!window.__qrBlob`);
  assert.equal(await evaluate('window.__qrBlob.type'), 'image/png');
  assert.equal(await evaluate('window.__qrFilename'), '현장_정기_설문_설문_QR.png');
  const pixels = await evaluate(`(async()=>{const bitmap=await createImageBitmap(window.__qrBlob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let raw='';for(let i=0;i<data.length;i+=32768)raw+=String.fromCharCode(...data.subarray(i,i+32768));return {width:canvas.width,height:canvas.height,rgba:btoa(raw)}})()`);
  const scanned = jsQR(new Uint8ClampedArray(Buffer.from(pixels.rgba, 'base64')), pixels.width, pixels.height);
  assert.equal(scanned?.data, createdUrl);
  assert(requests.includes('/assets/risk/vendor/qrcode-generator.js'));
  assert.equal(db.sqlite.prepare('SELECT public_token FROM risk_surveys WHERE id=?').get(created.id).public_token, created.public_token);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 850, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await evaluate(`[...document.querySelectorAll('.risk-qr-dialog button')].find(b=>b.textContent==='닫기').click()`);
  await evaluate(`document.querySelector('[data-view-link="mypage"]').click()`);
  await wait(`document.querySelector('#my-content h1') && document.querySelector('#my-status').textContent===''`);
  await evaluate(`document.querySelector('[data-my-section="risk"]').click()`);
  await wait(`document.querySelector('.my-risk-row')`);
  await evaluate(`[...document.querySelectorAll('.my-risk-row')].find(row=>row.textContent.includes('현장/정기:설문')).querySelectorAll('button')[1].click()`);
  await wait(`document.querySelector('.risk-qr-url')?.href===${JSON.stringify(createdUrl)}`);
  await evaluate(`[...document.querySelectorAll('.risk-qr-dialog button')].find(b=>b.textContent==='닫기').click()`);
  await evaluate(`[...document.querySelectorAll('.my-risk-row')].find(row=>row.textContent.includes('현장/정기:설문')).querySelectorAll('button')[2].click()`);
  await wait(`document.querySelector('#my-content h1')?.textContent==='현장/정기:설문'`);
  await evaluate(`[...document.querySelectorAll('#my-content button')].find(b=>b.textContent==='QR코드').click()`);
  await wait(`document.querySelector('.risk-qr-url')?.href===${JSON.stringify(createdUrl)}`);
  // Follow the URL independently decoded from the downloaded PNG, without login.
  await cdp('Network.deleteCookies', { name: 'hsso_session', url: base });
  await cdp('Page.navigate', { url: scanned.data });
  await wait(`document.querySelector('#worker-survey-title')?.textContent==='현장/정기:설문' && document.querySelector('#risk-survey-preview')?.hidden===false`);
  await evaluate(`document.querySelector('#worker-name').value='QR 응답자';document.querySelector('#worker-department').value='BM오션';document.querySelector('input[name="workerHasHazard"][value="no"]').click();document.querySelector('input[name="workerSafeReason"]').click();document.querySelector('#worker-submit-button').click()`);
  await wait(`document.querySelector('#worker-submit-message').textContent==='응답이 제출되었습니다.'`);
  assert.equal(db.sqlite.prepare('SELECT respondent_name FROM risk_responses WHERE survey_id=?').get(created.id).respondent_name, 'QR 응답자');
  assert.deepEqual(errors, []);
});
