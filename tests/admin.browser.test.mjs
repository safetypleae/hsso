// Actual Chrome + local Functions + disposable SQLite. No Production traffic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createTestDB } from './helpers/d1-memory.mjs';
import { hashToken } from '../server/auth-session.js';
import { BOARD_RICH_MARKER } from '../assets/board-format.js';
import { onRequest as me } from '../functions/api/auth/me.js';
import { boardCollection, boardItem } from '../server/boards.js';
import { inquiryCollection, inquiryItem, adminInquiryCollection, adminInquiryItem, adminInquiryAnswer } from '../server/inquiries.js';
import { collection as documents } from '../server/documents.js';
import { surveyCollection } from '../server/risk-surveys.js';

test('Chrome rich editor, board permissions, inquiry isolation and responsive layout', { skip: !process.env.HSSO_BROWSER, timeout: 90000 }, async t => {
  await access(process.env.HSSO_BROWSER);
  const db = createTestDB(); t.after(() => db.close());
  for (const name of ['0002_saved_documents', '0003_risk_assessment', '0004_boards', '0005_inquiries', '0007_inquiry_answers']) db.sqlite.exec(await readFile(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'));
  const users = [];
  for (const name of ['Admin', 'Owner', 'Other']) {
    const id = crypto.randomUUID(), token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    db.sqlite.prepare('INSERT INTO users (id,email,password_hash,name,company_name,department_name,position) VALUES (?,?,?,?,?,?,?)').run(id, `${name}@example.test`, 'unused', name, 'Local Company', 'Safety', 'Manager');
    db.sqlite.prepare('INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').run(crypto.randomUUID(), id, await hashToken(token), new Date(Date.now() + 3600000).toISOString());
    users.push({ id, token });
  }
  const [admin, owner, other] = users, now = new Date().toISOString();
  db.sqlite.prepare('INSERT INTO user_roles VALUES (?,?,?,?)').run(admin.id, 'admin', now, now);
  const project = fileURLToPath(new URL('..', import.meta.url)); let base;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, base), p = url.pathname;
      if (p.startsWith('/api/')) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const request = new Request(url, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
        const handlers = { '/api/auth/me': me, '/api/boards': boardCollection, '/api/inquiries': inquiryCollection, '/api/admin/inquiries': adminInquiryCollection, '/api/documents': documents, '/api/risk-surveys': surveyCollection };
        const parts = p.split('/');
        const handler = handlers[p] || (p.startsWith('/api/admin/inquiries/') ? (parts[5] === 'answer' ? adminInquiryAnswer : adminInquiryItem) : p.startsWith('/api/boards/') ? boardItem : p.startsWith('/api/inquiries/') ? inquiryItem : null);
        if (!handler) { res.writeHead(404).end(); return; }
        const response = await handler({ request, env: { DB: db }, params: { id: p.startsWith('/api/admin/') ? parts[4] : parts[3] } });
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
      }
      if (p === '/pdf-stub.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }).end('export const GlobalWorkerOptions = {};'); return; }
      const relative = p === '/' ? 'index.html' : decodeURIComponent(p.slice(1));
      if (!['index.html', 'script.js', 'auth.js', 'email-verification-ui.js', 'password-policy.js', 'mypage.js', 'saved-document-preview.js', 'style.css', 'mypage.css'].includes(relative) && !/^assets\/[a-z0-9/.-]+$/i.test(relative)) { res.writeHead(404).end(); return; }
      let content = await readFile(join(project, relative));
      if (relative === 'index.html') content = content.toString().replace(/<script src="https:[^"]+"><\/script>/g, '');
      if (relative === 'script.js') content = content.toString().replace('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.mjs', '/pdf-stub.js');
      res.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' }[extname(relative)] || 'application/octet-stream' }).end(content);
    } catch { res.writeHead(500).end('Local test server error'); }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen)); base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  const profile = await mkdtemp(join(tmpdir(), 'hsso-admin-browser-'));
  const child = spawn(process.env.HSSO_BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } assert.equal(dirname(resolve(profile)), resolve(tmpdir())); assert(basename(profile).startsWith('hsso-admin-browser-')); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });
  const wsUrl = await new Promise((resolveWs, rejectWs) => { let log = ''; child.stderr.on('data', data => { log += data; const match = log.match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolveWs(match[1]); }); child.once('error', rejectWs); child.once('exit', () => rejectWs(new Error('Chrome exited'))); });
  const ws = new WebSocket(wsUrl); await once(ws, 'open'); t.after(() => ws.close()); let serial = 0; const pending = new Map(), errors = [];
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); } if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text); if (message.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }, message.sessionId); });
  function send(method, params = {}, sessionId) { return new Promise((resolveSend, rejectSend) => { const id = ++serial; pending.set(id, { resolve: resolveSend, reject: rejectSend }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }), { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable');
  const evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description); return result.result.value; };
  async function wait(expression) { const until = Date.now() + 7000; while (Date.now() < until) { if (await evaluate(expression)) return; await new Promise(resolveWait => setTimeout(resolveWait, 30)); } throw new Error(`Timed out: ${expression}`); }
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const clickText = text => evaluate(`[...document.querySelectorAll('#board-content button')].find(button=>button.textContent===${JSON.stringify(text)}).click()`);
  const ready = () => wait(`document.querySelector('#board-status').textContent==='' && !!document.querySelector('#board-content h1')`);
  async function open(user) { await cdp('Page.navigate', { url: 'about:blank' }); await wait(`!document.querySelector('#boards')`); await cdp('Network.setCookie', { name: 'hsso_session', value: user.token, url: base, httpOnly: true, sameSite: 'Lax' }); await cdp('Page.navigate', { url: `${base}/#boards` }); await wait(`document.querySelector('#board-content h1')?.textContent==='공지사항'`); await ready(); }
  const blankEditor = () => evaluate(`document.querySelector('[data-rich-editor]').innerHTML==='' && document.querySelector('[data-rich-editor]').textContent==='' && !document.querySelector('.board-format-preview') && !document.body.textContent.includes('[HSSO:')`);
  const setTitle = title => evaluate(`document.querySelector('[name="title"]').value=${JSON.stringify(title)}`);
  const setPlainEditor = text => evaluate(`(()=>{const editor=document.querySelector('[data-rich-editor]');editor.replaceChildren(document.createTextNode(${JSON.stringify(text)}));editor.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const applyFormat = (label, text) => evaluate(`(()=>{const editor=document.querySelector('[data-rich-editor]'),walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const at=node.data.indexOf(${JSON.stringify(text)});if(at>=0){const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+${JSON.stringify(text)}.length);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);editor.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));const control=[...document.querySelectorAll('.board-rich-toolbar button')].find(button=>button.getAttribute('aria-label')===${JSON.stringify(label)});control.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));control.click();return true;}}return false;})()`);
  const applySelect = (label, value, text) => evaluate(`(()=>{const editor=document.querySelector('[data-rich-editor]'),walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const at=node.data.indexOf(${JSON.stringify(text)});if(at>=0){const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+${JSON.stringify(text)}.length);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);editor.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));const control=document.querySelector('.board-rich-toolbar select[aria-label=${JSON.stringify(label)}]');control.value=${JSON.stringify(value)};control.dispatchEvent(new Event('change',{bubbles:true}));return true;}}return false;})()`);

  for (const width of [1440, 390]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await open(owner);
    assert.equal(await evaluate(`!!document.querySelector('.board-write-button')`), false);
    assert.equal(await evaluate(`!!document.querySelector('.board-admin-badge')`), false);

    await open(admin); assert.equal(await evaluate(`document.querySelector('.board-write-button').textContent`), '공지 작성');
    await clickText('공지 작성'); await wait(`!!document.querySelector('.board-form')`);
    assert.equal(await blankEditor(), true);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.board-rich-toolbar [aria-label]')].map(node=>node.getAttribute('aria-label'))`), ['글자 크기', '굵게', '기울임', '밑줄', '취소선', '왼쪽 정렬', '가운데 정렬', '오른쪽 정렬', '글머리 목록', '번호 목록', '링크 주소', '링크 삽입', '링크 해제']);
    assert.deepEqual(await evaluate(`({value:document.querySelector('[aria-label="글자 크기"]').value,options:[...document.querySelector('[aria-label="글자 크기"]').options].map(option=>option.textContent),font:!!document.querySelector('[aria-label="글꼴"]')})`), { value: '16px', options: ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'], font: false });
    const toolbarLayout = await evaluate(`(()=>{const toolbar=document.querySelector('.board-rich-toolbar');return {wrap:getComputedStyle(toolbar).flexWrap,horizontal:toolbar.scrollWidth>toolbar.clientWidth};})()`);
    assert.equal(toolbarLayout.wrap, 'nowrap');
    if (width === 390) assert.equal(toolbarLayout.horizontal, true);
    const noticeTitle = `Rich notice ${width}`;
    await setTitle(noticeTitle);
    await evaluate(`(()=>{const editor=document.querySelector('[data-rich-editor]');for(const text of ['BoldText','ItalicText','UnderlineText','StrikeText','SizeText','LeftText','CenterText','RightText','BulletText','NumberText','LinkKeep','LinkRemove','UnsafeLink']){const line=document.createElement('div');line.textContent=text;editor.append(line);}editor.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    for (const [label, text] of [['굵게', 'BoldText'], ['기울임', 'ItalicText'], ['밑줄', 'UnderlineText'], ['취소선', 'StrikeText'], ['왼쪽 정렬', 'LeftText'], ['가운데 정렬', 'CenterText'], ['오른쪽 정렬', 'RightText'], ['글머리 목록', 'BulletText'], ['번호 목록', 'NumberText']]) assert.equal(await applyFormat(label, text), true);
    assert.equal(await applySelect('글자 크기', '18px', 'SizeText'), true);
    for (const text of ['LinkKeep', 'LinkRemove']) { await evaluate(`document.querySelector('.board-rich-link-input').value='https://example.com/help'`); assert.equal(await applyFormat('링크 삽입', text), true); }
    assert.equal(await applyFormat('링크 해제', 'LinkRemove'), true);
    await evaluate(`document.querySelector('.board-rich-link-input').value='javascript:alert(1)'`);
    assert.equal(await applyFormat('링크 삽입', 'UnsafeLink'), true);
    const immediate = await evaluate(`({message:document.querySelector('.board-rich-message').textContent,html:document.querySelector('[data-rich-editor]').innerHTML,bold:!!document.querySelector('[data-rich-editor] strong, [data-rich-editor] b'),italic:!!document.querySelector('[data-rich-editor] em, [data-rich-editor] i'),underline:!!document.querySelector('[data-rich-editor] u'),strike:!!document.querySelector('[data-rich-editor] strike, [data-rich-editor] s'),size:[...document.querySelectorAll('[data-rich-editor] span')].some(node=>node.style.fontSize==='18px'&&node.textContent==='SizeText'),ul:!!document.querySelector('[data-rich-editor] ul'),ol:!!document.querySelector('[data-rich-editor] ol'),links:document.querySelectorAll('[data-rich-editor] a').length})`);
    assert.deepEqual({ ...immediate, html: true }, { message: 'http(s), mailto, tel 또는 사이트 내부 주소만 사용할 수 있습니다.', html: true, bold: true, italic: true, underline: true, strike: true, size: true, ul: true, ol: true, links: 1 }, immediate.html);
    await evaluate(`(()=>{const editor=document.querySelector('[data-rich-editor]'),script=document.createElement('script'),image=document.createElement('img'),span=document.createElement('span'),link=document.createElement('a');script.type='application/json';script.textContent='window.__richXss=1';image.setAttribute('onerror','window.__richXss=1');span.setAttribute('onclick','window.__richXss=1');span.textContent='SafeSpan';link.href='javascript:window.__richXss=1';link.textContent='BadScheme';editor.append(script,image,span,link);document.querySelector('.board-form').requestSubmit();})()`);
    await wait(`document.querySelector('.board-detail h1')?.textContent===${JSON.stringify(noticeTitle)}`);
    const rendered = await evaluate(`(()=>{const body=document.querySelector('.board-body');return {html:body.innerHTML,bold:!!body.querySelector('strong'),italic:!!body.querySelector('em'),underline:!!body.querySelector('u'),strike:!!body.querySelector('s'),size:!!body.querySelector('.board-rich-size-18px')&&getComputedStyle(body.querySelector('.board-rich-size-18px')).fontSize==='18px',center:!!body.querySelector('.board-rich-align-center'),right:!!body.querySelector('.board-rich-align-right'),ul:!!body.querySelector('ul'),ol:!!body.querySelector('ol'),links:body.querySelectorAll('a').length,href:body.querySelector('a')?.getAttribute('href'),forbidden:!!body.querySelector('script,img,iframe,object,embed'),events:[...body.querySelectorAll('*')].some(node=>[...node.attributes].some(attribute=>attribute.name.startsWith('on'))),executed:window.__richXss!==undefined};})()`);
    assert.deepEqual({ ...rendered, html: true }, { html: true, bold: true, italic: true, underline: true, strike: true, size: true, center: true, right: true, ul: true, ol: true, links: 1, href: 'https://example.com/help', forbidden: false, events: false, executed: false }, rendered.html);
    const storedNotice = db.sqlite.prepare('SELECT content FROM board_posts WHERE title=?').get(noticeTitle).content;
    assert.equal(storedNotice.startsWith(`${BOARD_RICH_MARKER}\n`), true);
    assert.equal(/onclick|onerror|javascript:|window\.__richXss|<script/i.test(storedNotice), false);
    await clickText('수정'); await wait(`!!document.querySelector('.board-form')`);
    assert.equal(await evaluate(`!!document.querySelector('[data-rich-editor] strong')&&!!document.querySelector('[data-rich-editor] .board-rich-size-18px')&&getComputedStyle(document.querySelector('[data-rich-editor] .board-rich-size-18px')).fontSize==='18px'&&!!document.querySelector('[data-rich-editor] .board-rich-align-center')`), true);
    await evaluate(`document.querySelector('[data-rich-editor]').append(document.createTextNode(' Revised'));document.querySelector('.board-form').requestSubmit()`);
    await wait(`document.querySelector('.board-body')?.textContent.includes('Revised')`);
    assert.equal(await evaluate(`!!document.querySelector('.board-body strong')&&!!document.querySelector('.board-body .board-rich-size-18px')&&getComputedStyle(document.querySelector('.board-body .board-rich-size-18px')).fontSize==='18px'&&!!document.querySelector('.board-body .board-rich-align-center')`), true);
    await clickText('삭제'); await wait(`!!document.querySelector('.board-empty')`);

    await open(owner); await click('[data-board-select="inquiry"]'); await ready(); await clickText('문의하기'); await wait(`!!document.querySelector('.board-form')`);
    assert.equal(await blankEditor(), true);
    const inquiryTitle = `Private inquiry ${width}`;
    await setTitle(inquiryTitle); await setPlainEditor(`Inquiry body ${width}`); assert.equal(await applyFormat('굵게', `Inquiry body ${width}`), true);
    await evaluate(`document.querySelector('.board-form').requestSubmit()`); await wait(`document.querySelector('.board-detail h1')?.textContent===${JSON.stringify(inquiryTitle)}`);
    assert.equal(await evaluate(`document.querySelector('.board-body strong')?.textContent===${JSON.stringify(`Inquiry body ${width}`)}`), true);
    assert.equal(await evaluate(`!!document.querySelector('.board-answer-form')`), false);

    await open(other); await click('[data-board-select="inquiry"]'); await ready();
    assert.equal(await evaluate(`document.querySelector('#board-content').textContent.includes(${JSON.stringify(inquiryTitle)})`), false);

    await open(admin); await click('[data-board-select="inquiry"]'); await ready(); await clickText('전체 문의 관리'); await ready(); await clickText(inquiryTitle); await ready(); await wait(`!!document.querySelector('.board-answer-form')`);
    assert.equal(await evaluate(`document.querySelector('.board-answer-form [data-rich-editor]').innerHTML===''`), true);
    await setPlainEditor(`Admin answer ${width}`); assert.equal(await applyFormat('기울임', `Admin answer ${width}`), true);
    await evaluate(`document.querySelector('.board-answer-form').requestSubmit()`); await wait(`document.querySelector('.board-answer-content em')?.textContent===${JSON.stringify(`Admin answer ${width}`)}`);
    assert.equal(db.sqlite.prepare('SELECT status FROM inquiry_posts WHERE title=?').get(inquiryTitle).status, 'answered');
    assert.equal(await evaluate(`!!document.querySelector('.board-answer-form [data-rich-editor] em')`), true);
    await evaluate(`document.querySelector('.board-answer-form [data-rich-editor]').append(document.createTextNode(' updated'));document.querySelector('.board-answer-form').requestSubmit()`);
    await wait(`document.querySelector('.board-answer-content')?.textContent.includes('updated')`);
    assert.equal(await evaluate(`!!document.querySelector('.board-answer-content em')`), true);
    await open(owner); await click('[data-board-select="inquiry"]'); await ready(); await clickText(inquiryTitle); await ready();
    assert.equal(await evaluate(`!!document.querySelector('.board-answer-content em')&&!document.querySelector('.board-answer-form')`), true);
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), true, `inquiry overflow at ${width}`);
  }

  for (const width of [1440, 390]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const id = crypto.randomUUID(), title = `Legacy free ${width}`, legacy = 'Free body\n\n그대로 표시';
    db.sqlite.prepare('INSERT INTO board_posts VALUES (?,?,?,?,?,?,?,?)').run(id, 'free', owner.id, title, legacy, 0, now, now);
    await open(admin); await click('[data-board-select="free"]'); await ready(); await clickText(title); await ready();
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.board-actions button')].map(button=>button.textContent)`), ['목록으로']);
    await open(owner); await click('[data-board-select="free"]'); await ready(); await clickText(title); await ready();
    assert.equal(await evaluate(`document.querySelector('.board-format-plain')?.textContent===${JSON.stringify(legacy)}`), true);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.board-actions button')].map(button=>button.textContent)`), ['목록으로', '수정', '삭제']);
    await clickText('수정'); await wait(`!!document.querySelector('.board-form')`);
    assert.equal(await evaluate(`document.querySelector('[data-rich-editor]').innerText.includes('Free body')&&document.querySelector('[data-rich-editor]').innerText.includes('그대로 표시')&&!document.body.textContent.includes('[HSSO:')`), true);
    assert.equal(await applyFormat('밑줄', 'Free body'), true);
    await evaluate(`document.querySelector('.board-form').requestSubmit()`); await wait(`document.querySelector('.board-body u')?.textContent==='Free body'`);
    assert.equal(db.sqlite.prepare('SELECT content FROM board_posts WHERE id=?').get(id).content.startsWith(`${BOARD_RICH_MARKER}\n`), true);
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), true, `free overflow at ${width}`);
    await clickText('삭제'); await wait(`!!document.querySelector('.board-empty')`);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM board_posts WHERE id=?').get(id).n, 0);
  }
  assert.deepEqual(errors, []);
});
