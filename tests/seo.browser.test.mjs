import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const browserPath = process.env.HSSO_BROWSER;
const guides = ['risk-assessment', 'msds-management', 'msds-ledger', 'ghs-label'];

test('public guides remain readable without horizontal overflow on desktop and mobile', { skip: !browserPath, timeout: 45000 }, async (t) => {
  const project = new URL('..', import.meta.url);
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const relative = pathname.endsWith('/') ? `${pathname.slice(1)}index.html` : pathname.slice(1);
      if (!/^guide\/(risk-assessment|msds-management|msds-ledger|ghs-label)\/index\.html$/.test(relative) && !['style.css', 'assets/guide.css', 'assets/favicon.svg'].includes(relative)) {
        response.writeHead(404).end();
        return;
      }
      const content = await readFile(new URL(relative, project));
      const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' }[extname(relative)];
      response.writeHead(200, { 'Content-Type': type }).end(content);
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const slug of guides) assert.equal((await fetch(`${base}/guide/${slug}/`)).status, 200, `${slug} should return 200`);
  const profile = await mkdtemp(join(tmpdir(), 'hsso-seo-'));
  const chrome = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(async () => {
    if (chrome.exitCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  const wsUrl = await new Promise((resolve, reject) => {
    let log = '';
    chrome.stderr.on('data', (chunk) => { log += chunk; const match = log.match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]); });
    chrome.once('error', reject);
    chrome.once('exit', () => reject(new Error('Browser exited before DevTools was ready')));
  });
  const socket = new WebSocket(wsUrl);
  await once(socket, 'open');
  t.after(() => socket.close());
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const task = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  await cdp('Page.enable');
  const evaluate = async (expression) => (await cdp('Runtime.evaluate', { expression, returnByValue: true })).result.value;

  for (const width of [1280, 390]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    for (const slug of guides) {
      await cdp('Page.navigate', { url: `${base}/guide/${slug}/` });
      const deadline = Date.now() + 5000;
      while (!(await evaluate(`document.readyState === 'complete'`))) {
        if (Date.now() >= deadline) throw new Error(`Timed out loading ${slug}`);
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      const layout = await evaluate(`(() => ({
        ready: document.readyState === 'complete',
        overflow: document.documentElement.scrollWidth <= innerWidth,
        h1: document.querySelector('h1')?.getBoundingClientRect().height > 0,
        cta: document.querySelector('.guide-actions .primary-button')?.getBoundingClientRect().height >= 44,
        related: document.querySelectorAll('.guide-related a').length,
        steps: document.querySelectorAll('.guide-howto .guide-step').length,
        stepColumns: getComputedStyle(document.querySelector('.guide-steps')).gridTemplateColumns.split(' ').length,
        columns: getComputedStyle(document.querySelector('.guide-related')).gridTemplateColumns.split(' ').length,
        direction: getComputedStyle(document.querySelector('.guide-final-cta')).flexDirection,
        footer: document.querySelector('.site-footer')?.getBoundingClientRect().height > 0
      }))()`);
      assert.equal(layout.ready, true);
      assert.equal(layout.overflow, true, `${slug} overflow at ${width}px`);
      assert.equal(layout.h1, true);
      assert.equal(layout.cta, true);
      assert.equal(layout.related, 3);
      assert.ok(layout.steps >= 3);
      assert.equal(layout.stepColumns, width < 500 ? 1 : 3);
      assert.equal(layout.columns, width < 500 ? 1 : 3);
      assert.equal(layout.direction, width < 500 ? 'column' : 'row');
      assert.equal(layout.footer, true);
    }
  }
});
