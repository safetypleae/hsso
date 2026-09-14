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
import { onRequest as me } from '../functions/api/auth/me.js';
import { boardCollection, boardItem } from '../server/boards.js';
import { inquiryCollection, inquiryItem, adminInquiryCollection, adminInquiryItem, adminInquiryAnswer } from '../server/inquiries.js';
import { collection as documents } from '../server/documents.js';
import { surveyCollection } from '../server/risk-surveys.js';

test('Chrome admin notice CRUD, inquiry answers, ordinary-user controls and responsive layout', {skip:!process.env.HSSO_BROWSER,timeout:60000},async t=>{
  await access(process.env.HSSO_BROWSER);
  const db=createTestDB();t.after(()=>db.close());
  for(const name of ['0002_saved_documents','0003_risk_assessment','0004_boards','0005_inquiries','0007_inquiry_answers'])db.sqlite.exec(await readFile(new URL(`../migrations/${name}.sql`,import.meta.url),'utf8'));
  const users=[];
  for(const name of ['Admin','Owner']) {
    const id=crypto.randomUUID(),token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
    db.sqlite.prepare('INSERT INTO users (id,email,password_hash,name,company_name,department_name,position) VALUES (?,?,?,?,?,?,?)').run(id,name+'@example.test','unused',name,'Local Company','Safety','Manager');
    db.sqlite.prepare('INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').run(crypto.randomUUID(),id,await hashToken(token),new Date(Date.now()+3600000).toISOString());
    users.push({id,token});
  }
  const [admin,owner]=users,now=new Date().toISOString();
  db.sqlite.prepare('INSERT INTO user_roles VALUES (?,?,?,?)').run(admin.id,'admin',now,now);
  const inquiryId=crypto.randomUUID();
  db.sqlite.prepare('INSERT INTO inquiry_posts VALUES (?,?,?,?,?,?,?)').run(inquiryId,owner.id,'Local inquiry','Local question','waiting',now,now);
  const project=fileURLToPath(new URL('..',import.meta.url));let base;
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,base),p=url.pathname;
      if(p.startsWith('/api/')) {
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
        const handlers={'/api/auth/me':me,'/api/boards':boardCollection,'/api/inquiries':inquiryCollection,'/api/admin/inquiries':adminInquiryCollection,'/api/documents':documents,'/api/risk-surveys':surveyCollection};
        const parts=p.split('/');
        const handler=handlers[p]||(p.startsWith('/api/admin/inquiries/')?(parts[5]==='answer'?adminInquiryAnswer:adminInquiryItem):p.startsWith('/api/boards/')?boardItem:p.startsWith('/api/inquiries/')?inquiryItem:null);
        if(!handler){res.writeHead(404).end();return;}
        const response=await handler({request,env:{DB:db},params:{id:p.startsWith('/api/admin/')?parts[4]:parts[3]}});
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
      }
      if(p==='/pdf-stub.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end('export const GlobalWorkerOptions = {};');return;}
      const relative=p==='/'?'index.html':decodeURIComponent(p.slice(1));
      if(!['index.html','script.js','auth.js','email-verification-ui.js','password-policy.js','mypage.js','saved-document-preview.js','style.css','mypage.css'].includes(relative)&&!/^assets\/[a-z0-9/.-]+$/i.test(relative)){res.writeHead(404).end();return;}
      let content=await readFile(join(project,relative));
      if(relative==='index.html')content=content.toString().replace(/<script src="https:[^"]+"><\/script>/g,'');
      if(relative==='script.js')content=content.toString().replace('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.mjs','/pdf-stub.js');
      res.writeHead(200,{'Content-Type':{'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'}[extname(relative)]||'application/octet-stream'}).end(content);
    }catch{res.writeHead(500).end('Local test server error');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  t.after(()=>{server.closeAllConnections();server.close();});
  const profile=await mkdtemp(join(tmpdir(),'hsso-admin-browser-'));
  const child=spawn(process.env.HSSO_BROWSER,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  t.after(async()=>{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.equal(dirname(resolve(profile)),resolve(tmpdir()));assert(basename(profile).startsWith('hsso-admin-browser-'));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
  const wsUrl=await new Promise((r,j)=>{let log='';child.stderr.on('data',d=>{log+=d;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m)r(m[1]);});child.once('error',j);child.once('exit',()=>j(new Error('Chrome exited')));});
  const ws=new WebSocket(wsUrl);await once(ws,'open');t.after(()=>ws.close());let serial=0;const pending=new Map(),errors=[];
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const task=pending.get(m.id);pending.delete(m.id);m.error?task.reject(new Error(m.error.message)):task.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Page.javascriptDialogOpening')send('Page.handleJavaScriptDialog',{accept:true},m.sessionId);});
  function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
  const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const cdp=(m,p)=>send(m,p,sessionId);
  await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Network.enable');
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description);return r.result.value;};
  async function wait(expression){const until=Date.now()+6000;while(Date.now()<until){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,30));}throw new Error('Timed out: '+expression);}
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const clickText=text=>evaluate(`[...document.querySelectorAll('#board-content button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`);
  const ready=()=>wait(`document.querySelector('#board-status').textContent==='' && !!document.querySelector('#board-content h1')`);
  async function open(user){await cdp('Page.navigate',{url:'about:blank'});await wait(`!document.querySelector('#boards')`);await cdp('Network.setCookie',{name:'hsso_session',value:user.token,url:base,httpOnly:true,sameSite:'Lax'});await cdp('Page.navigate',{url:base+'/#boards'});await wait(`document.querySelector('#board-content h1')?.textContent==='공지사항'`);await ready();}
  for(const width of [1440,390]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await open(owner);
    assert.equal(await evaluate(`!!document.querySelector('.board-write-button')`),false);
    assert.equal(await evaluate(`!!document.querySelector('.board-admin-badge')`),false);
    await click('[data-board-select="inquiry"]');await ready();
    assert.equal(await evaluate(`document.querySelector('#board-content').textContent.includes('전체 문의 관리')`),false);
    await clickText('Local inquiry');await ready();
    assert.equal(await evaluate(`!!document.querySelector('.board-answer-form')`),false);
    await open(admin);assert.equal(await evaluate(`document.querySelector('.board-write-button').textContent`),'공지 작성');
    await clickText('공지 작성');await wait(`!!document.querySelector('.board-form')`);
    await evaluate(`document.querySelector('[name="title"]').value='Local notice ${width}';document.querySelector('[name="content"]').value='Notice body';document.querySelector('.board-form').requestSubmit()`);
    await wait(`document.querySelector('.board-detail h1')?.textContent==='Local notice ${width}'`);
    await clickText('수정');await evaluate(`document.querySelector('[name="title"]').value='Edited ${width}';document.querySelector('.board-form').requestSubmit()`);
    await wait(`document.querySelector('.board-detail h1')?.textContent==='Edited ${width}'`);
    await clickText('삭제');await wait(`!!document.querySelector('.board-empty')`);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM board_posts').get().n,0);
    await click('[data-board-select="inquiry"]');await ready();await clickText('전체 문의 관리');await ready();
    assert.equal(await evaluate(`document.querySelector('#board-content h1').textContent`),'문의 관리');
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,`list overflow at ${width}`);
    await clickText('Local inquiry');await ready();await wait(`!!document.querySelector('.board-answer-form')`);
    await evaluate(`document.querySelector('[name="answer"]').value='Answer ${width}';document.querySelector('.board-answer-form').requestSubmit()`);
    await wait(`document.querySelector('.board-answer-content')?.textContent==='Answer ${width}'`);
    assert.equal(db.sqlite.prepare('SELECT status FROM inquiry_posts WHERE id=?').get(inquiryId).status,'answered');
    await evaluate(`document.querySelector('[name="answer"]').value='Edited answer ${width}';document.querySelector('.board-answer-form').requestSubmit()`);
    await wait(`document.querySelector('.board-answer-content')?.textContent==='Edited answer ${width}'`);
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,`answer overflow at ${width}`);
    await open(owner);await click('[data-board-select="inquiry"]');await ready();await clickText('Local inquiry');await ready();
    assert.equal(await evaluate(`document.querySelector('.board-answer-content').textContent`),`Edited answer ${width}`);
    assert.equal(await evaluate(`!!document.querySelector('.board-answer-form')`),false);
  }
  for(const width of [1440,390]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    const id=crypto.randomUUID();
    db.sqlite.prepare('INSERT INTO board_posts VALUES (?,?,?,?,?,?,?,?)').run(id,'free',owner.id,'Owner free post','Free body',0,now,now);
    await open(admin);await click('[data-board-select="free"]');await ready();await clickText('Owner free post');await ready();
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.board-actions button')].map(b=>b.textContent)`),['목록으로']);
    await open(owner);await click('[data-board-select="free"]');await ready();await clickText('Owner free post');await ready();
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.board-actions button')].map(b=>b.textContent)`),['목록으로','수정','삭제']);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await evaluate(`window.confirm=message=>{window.__deletePrompt=message;return false;}`);
    await clickText('삭제');
    assert.equal(await evaluate('window.__deletePrompt'),'이 게시글을 삭제하시겠습니까?');
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM board_posts WHERE id=?').get(id).n,1);
    await evaluate(`window.confirm=()=>true;window.__realFetch=window.fetch;window.__deleteCalls=0;window.fetch=(url,options)=>{if(options?.method==='DELETE'){window.__deleteCalls++;return Promise.resolve(new Response(JSON.stringify({ok:false,error:'INTERNAL_SERVER_ERROR'}),{status:500}));}return window.__realFetch(url,options);}`);
    await clickText('삭제');await wait(`document.querySelector('#board-status').textContent==='삭제하지 못했습니다.'`);
    assert.equal(await evaluate('window.__deleteCalls'),1);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM board_posts WHERE id=?').get(id).n,1);
    await evaluate('window.fetch=window.__realFetch');
    await clickText('삭제');await wait(`!!document.querySelector('.board-empty')`);
    assert.equal(await evaluate(`document.querySelector('#board-content h1').textContent`),'자유게시판');
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM board_posts WHERE id=?').get(id).n,0);
  }
  assert.deepEqual(errors,[]);
});
