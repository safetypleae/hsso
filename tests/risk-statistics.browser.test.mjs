// Actual browser + local handlers + in-memory SQLite. No production services.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fixture, createSurvey, surveyPayload, responsePayload, call, publicResponses } from './helpers/risk-fixture.mjs';
import { surveyCollection, surveyItem, adminResponses, adminResponseItem, responseCsv } from '../server/risk-surveys.js';
import { surveyStatistics, responseXlsx } from '../server/risk-statistics.js';
import { collection as documents } from '../server/documents.js';
import { onRequest as me } from '../functions/api/auth/me.js';

test('browser: survey management, charts, filters, XLSX, stale requests, error recovery and mobile', { skip: !process.env.HSSO_BROWSER, timeout: 60000 }, async t => {
  const { db, a, b } = await fixture(t);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const questions = [...html.matchAll(/<li id="survey-question-(\d)">([\s\S]*?)(?=<li id="survey-question-|<\/ol>)/g)].map(([, id, text]) => ({ id: 'q' + id, type: 'test', text: /<h3>(.*?)<\/h3>/.exec(text)[1], options: [...text.matchAll(/<li>(.*?)<\/li>/g)].map(m => m[1]) }));
  questions.push({ id: 'safe_reason', type: 'single_choice', text: '안전 사유', options: ['절차 준수', '기타'] });
  const survey = await createSurvey(db, a, { ...surveyPayload(), title: '통계 브라우저 검증', questions });
  for (let i = 0; i < 3; i++) {
    const data = { ...responsePayload(), department: i === 1 ? '다른 부서' : 'BM오션', employeeId: 'E' + i,
      hazardDescription: '<img src=x onerror="window.__xss=true">실제 서술 응답', hazardTypes: ['추락', '전기'] };
    if (i === 2) Object.assign(data, { hasHazard: false, hazardTypes: [], preLikelihood: null, preSeverity: null, postLikelihood: null, postSeverity: null, safeReason: '절차 준수' });
    assert.equal((await call(publicResponses, db, { method: 'POST', params: { token: survey.publicToken }, data })).status, 201);
  }
  const project = fileURLToPath(new URL('..', import.meta.url)); let base, failStats = false, delayStats = false;
  const excelQueries = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, base), parts = url.pathname.split('/');
      if (url.pathname.startsWith('/api/')) {
        const handlers = { '/api/auth/me': me, '/api/documents': documents, '/api/risk-surveys': surveyCollection };
        const handler = handlers[url.pathname] || (parts[2] === 'risk-surveys' ? ({ statistics: surveyStatistics, 'responses.xlsx': responseXlsx, 'responses.csv': responseCsv, responses: parts[5] ? adminResponseItem : adminResponses }[parts[4]] || surveyItem) : null);
        if (!handler) { res.writeHead(404).end(); return; }
        const request = new Request(url, { headers: req.headers });
        let response = handler === surveyStatistics && failStats ? Response.json({ ok: false }, { status: 500 }) : await handler({ request, env: { DB: db }, params: { id: parts[3], responseId: parts[5] } });
        if (handler === surveyStatistics && delayStats && url.searchParams.has('department')) await new Promise(r => setTimeout(r, 300));
        if (handler === responseXlsx) excelQueries.push(url.searchParams.get('department') || '');
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (url.pathname === '/pdf-stub.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }).end('export const GlobalWorkerOptions = {};'); return; }
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      if (!['index.html', 'script.js', 'auth.js', 'email-verification-ui.js', 'password-policy.js', 'mypage.js', 'saved-document-preview.js', 'style.css', 'mypage.css'].includes(relative) && !/^assets\/[a-z0-9/.-]+$/i.test(relative)) { res.writeHead(404).end(); return; }
      const path = resolve(project, relative); assert(path.startsWith(resolve(project) + '\\') || path.startsWith(resolve(project) + '/'));
      let content = await readFile(path);
      if (relative === 'index.html') content = content.toString().replace(/<script src="https:[^"]+"><\/script>/g, '');
      if (relative === 'script.js') content = content.toString().replace('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.mjs', '/pdf-stub.js');
      res.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' }[extname(relative)] || 'application/octet-stream' }).end(content);
    } catch { res.writeHead(500).end('Local test server error'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port;
  t.after(() => { server.closeAllConnections(); server.close(); });
  const profile = await mkdtemp(join(tmpdir(), 'hsso-risk-browser-'));
  const child = spawn(process.env.HSSO_BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    assert.equal(dirname(resolve(profile)), resolve(tmpdir())); assert(basename(profile).startsWith('hsso-risk-browser-'));
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
  async function wait(expression) { const until = Date.now() + 6000; while (Date.now() < until) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 30)); } throw new Error('Timed out: ' + expression); }
  const clickText = text => evaluate(`[...document.querySelectorAll('#my-content button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`);
  const choose = department => evaluate(`document.querySelector('#risk-stat-department').value=${JSON.stringify(department)};document.querySelector('#risk-stat-department').dispatchEvent(new Event('change'))`);
  const ready = count => wait(`document.querySelector('.risk-stat-total')?.textContent==='총 응답 ${count}개' && !document.querySelector('#risk-stat-download').disabled`);
  await cdp('Network.setCookie', { name: 'hsso_session', value: a.cookie.split('=')[1], url: base, httpOnly: true, sameSite: 'Lax' });
  await cdp('Page.navigate', { url: base + '/#mypage' });
  await wait(`document.querySelector('#my-content h1') && document.querySelector('#my-status').textContent===''`);
  await evaluate(`document.querySelector('[data-my-section="risk"]').click()`);
  await wait(`document.querySelector('.my-risk-row')`);
  await clickText('통계 보기'); await ready(3);
  assert.equal(await evaluate(`document.querySelectorAll('.risk-stat-card').length`), 9);
  assert.equal(await evaluate(`!!document.querySelector('[data-question-id="q1"] .risk-stat-pie')`), true);
  assert.equal(await evaluate(`!!document.querySelector('[data-question-id="q2"] .risk-stat-bar')`), true);
  assert.equal(await evaluate(`document.querySelector('[data-question-id="q3"] .risk-stat-text').children.length`), 2);
  assert.equal(await evaluate(`!!document.querySelector('.risk-stat-text img') || !!window.__xss`), false);
  assert.equal(await evaluate(`document.querySelector('.risk-stat-controls select').disabled`), true);
  await choose('BM오션'); await ready(2);
  assert.equal(await evaluate(`document.querySelector('[data-question-id="q3"] .risk-stat-text').children.length`), 1);
  assert.match(await evaluate(`document.querySelector('[data-question-id="q1"]').textContent`), /1명 \(50%\)/);
  // Capture the browser download, then independently parse every XML ZIP entry.
  await evaluate(`window.__riskBlob=null;const originalCreate=URL.createObjectURL;URL.createObjectURL=function(blob){window.__riskBlob=blob;return originalCreate.call(this,blob)};const originalClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__riskFilename=this.download;return}originalClick.call(this)};`);
  await clickText('Excel 다운로드'); await wait(`!!window.__riskBlob && !document.querySelector('#risk-stat-download').disabled`);
  assert.deepEqual(excelQueries, ['BM오션']);
  assert.match(await evaluate('window.__riskFilename'), /BM오션\.xlsx$/);
  const workbook = await evaluate(`(async()=>{const buffer=await window.__riskBlob.arrayBuffer(),view=new DataView(buffer),decoder=new TextDecoder();let offset=0;const files={};while(view.getUint32(offset,true)===0x04034b50){const size=view.getUint32(offset+18,true),len=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),name=decoder.decode(new Uint8Array(buffer,offset+30,len)),start=offset+30+len+extra;const text=decoder.decode(new Uint8Array(buffer,start,size));const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw new Error(name+' invalid XML');files[name]=text;offset=start+size}return files})()`);
  assert.equal(Object.keys(workbook).length, 5); assert.equal([...workbook['xl/worksheets/sheet1.xml'].matchAll(/<row /g)].length, 3);
  assert.doesNotMatch(workbook['xl/worksheets/sheet1.xml'], /다른 부서/);
  delayStats = true;
  await choose('다른 부서'); await clickText('전체로 초기화'); await ready(3);
  await new Promise(r => setTimeout(r, 400)); await ready(3); delayStats = false;
  failStats = true; await choose('BM오션'); await wait(`document.querySelector('.risk-statistics [role="status"]').textContent.includes('불러오지 못했습니다')`);
  assert.equal(await evaluate(`document.querySelector('#risk-stat-download').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('.risk-stat-cards').children.length`), 0);
  failStats = false; await clickText('다시 시도'); await ready(2);
  for (const width of [390, 1280]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `overflow ${width}`);
  }
  await clickText('← 설문 관리로 돌아가기');
  await wait(`[...document.querySelectorAll('#my-content a')].some(a=>a.textContent==='응답 다운로드')`);
  await clickText('상세'); await wait(`document.querySelector('#my-content h1')?.textContent==='응답 상세'`);
  await clickText('← 설문 상세로 돌아가기'); await wait(`[...document.querySelectorAll('#my-content button')].some(b=>b.textContent==='통계 보기')`);
  await clickText('통계 보기'); await ready(3);
  delayStats = true; await choose('BM오션'); await clickText('← 설문 관리로 돌아가기');
  await wait(`document.querySelector('#my-content h1')?.textContent==='통계 브라우저 검증'`);
  await new Promise(r => setTimeout(r, 400)); assert.equal(await evaluate(`!!document.querySelector('.risk-statistics')`), false); delayStats = false;
  await cdp('Network.setCookie', { name: 'hsso_session', value: b.cookie.split('=')[1], url: base, httpOnly: true, sameSite: 'Lax' });
  await clickText('통계 보기'); await wait(`document.querySelector('.risk-statistics [role="status"]').textContent.includes('접근 권한')`);
  assert.equal(await evaluate(`document.querySelector('#risk-stat-download').disabled`), true);
  await cdp('Network.deleteCookies', { name: 'hsso_session', url: base }); await clickText('다시 시도'); await wait(`location.hash==='#login'`);
  assert.deepEqual(errors, []);
});
