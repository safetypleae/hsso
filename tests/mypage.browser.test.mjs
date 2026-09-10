// No packages required. Run with HSSO_BROWSER pointing to Chrome/Edge.
// Local HTTP + actual Functions + disposable SQLite only. PDF CDN modules are stubbed;
// this suite checks UI integration, not parsing, rasterization or PDF export.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createTestDB } from './helpers/d1-memory.mjs';
import { collection, item } from '../server/documents.js';
import { onRequest as signup } from '../functions/api/auth/signup.js';
import { onRequest as login } from '../functions/api/auth/login.js';
import { onRequest as logout } from '../functions/api/auth/logout.js';
import { onRequest as me } from '../functions/api/auth/me.js';

const browserPath=process.env.HSSO_BROWSER;
test('local browser: protected dashboard, documents, adapters and responsive navigation', {skip:!browserPath,timeout:60000}, async t=>{
  await access(browserPath);
  const db=createTestDB();t.after(()=>db.close());
  db.sqlite.exec(await readFile(new URL('../migrations/0002_saved_documents.sql',import.meta.url),'utf8'));
  // URL paths may contain Korean or spaces; use fileURLToPath for the actual filesystem root.
  const {fileURLToPath}=await import('node:url');const project=fileURLToPath(new URL('..',import.meta.url));
  let base;let failDocuments=false;
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,base);
      if(url.pathname.startsWith('/api/')) {
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
        const handlers={'/api/auth/signup':signup,'/api/auth/login':login,'/api/auth/logout':logout,'/api/auth/me':me,'/api/documents':collection};
        const handler=handlers[url.pathname] || (url.pathname.startsWith('/api/documents/')?item:null);
        if(!handler){res.writeHead(404).end();return;}
        const response=failDocuments&&url.pathname==='/api/documents'?Response.json({ok:false,error:'INTERNAL_SERVER_ERROR'},{status:500}):await handler({request,env:{DB:db},params:{id:url.pathname.split('/')[3]}});
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
      }
      if(url.pathname==='/pdf-stub.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end('export const GlobalWorkerOptions = {};');return;}
      const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
      if(!['index.html','script.js','auth.js','mypage.js','style.css','mypage.css'].includes(relative)&&!/^assets\/[a-z0-9/.-]+$/i.test(relative)){res.writeHead(404).end();return;}
      let content=await readFile(join(project,relative));
      if(relative==='index.html')content=content.toString().replace(/<script src="https:[^"]+"><\/script>/g,'');
      if(relative==='script.js')content=content.toString().replace('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.mjs','/pdf-stub.js');
      res.writeHead(200,{'Content-Type':{'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'}[extname(relative)]||'application/octet-stream'}).end(content);
    }catch{res.writeHead(500).end('Local test server error');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const profile=await mkdtemp(join(tmpdir(),'hsso-browser-'));
  const child=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  t.after(async()=>{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
    assert.equal(dirname(resolve(profile)),resolve(tmpdir()));assert(basename(profile).startsWith('hsso-browser-'));
    await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
  const wsUrl=await new Promise((resolve,reject)=>{let log='';child.stderr.on('data',chunk=>{log+=chunk;const match=log.match(/DevTools listening on (ws:\/\/\S+)/);if(match)resolve(match[1]);});child.once('error',reject);child.once('exit',()=>reject(new Error('Browser exited before DevTools')));});
  const ws=new WebSocket(wsUrl);await once(ws,'open');t.after(()=>ws.close());let serial=0;const pending=new Map();const errors=[];
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const task=pending.get(message.id);pending.delete(message.id);if(message.error)task.reject(new Error(message.error.message));else task.resolve(message.result);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text+': '+message.params.exceptionDetails.exception?.description);});
  function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const cdp=(method,params)=>send(method,params,sessionId);
  await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Network.enable');
  const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description);return result.result.value;};
  async function wait(expression){const until=Date.now()+5000;while(Date.now()<until){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error('Timed out: '+expression);}
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const ready=()=>wait(`document.querySelector('#my-status').textContent === '' && !!document.querySelector('#my-content h1')`);
  await cdp('Page.navigate',{url:base+'/#mypage'});await wait(`location.hash === '#login' && document.querySelector('#login-message').textContent.includes('로그인이 필요')`);
  assert.equal(await evaluate(`document.querySelector('#my-content').textContent`),'');
  const fixture={email:'browser@example.com',password:'browser fixture password',name:'검증 사용자',companyName:'검증 회사',departmentName:'검증 부서',position:'담당자'};
  const request=()=>new Request(base+'/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(fixture)});
  assert.equal((await signup({request:request(),env:{DB:db}})).status,201);
  const auth=await login({request:request(),env:{DB:db}});const cookie=auth.headers.get('set-cookie').split(';')[0].split('=');
  await cdp('Network.setCookie',{name:cookie[0],value:cookie[1],url:base,httpOnly:true,sameSite:'Lax'});
  for(const width of [1440,768,390]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await cdp('Page.navigate',{url:base+'/#mypage'});await ready();
    assert((await evaluate(`document.querySelector('#my-content').textContent`)).includes('안녕하세요, 검증 사용자님.'));
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),true,`dashboard overflow ${width}`);
    for(const [section,text] of [['profile','browser@example.com'],['documents','저장된 문서가 없습니다.'],['risk','아직 저장된 위험성평가가 없습니다.']]){
      await click(`[data-my-section="${section}"]`);await ready();assert((await evaluate(`document.querySelector('#my-content').textContent`)).includes(text));assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),true,`${section} overflow ${width}`);
    }
    await evaluate(`[...document.querySelectorAll('#my-content button')].find(b=>b.textContent==='위험성평가 만들기').click()`);assert.equal(await evaluate(`location.hash`),'#risk-survey-create');
    await click('.logo');assert.equal(await evaluate(`document.querySelector('#home').hidden`),false);
    if(width<=900)await click('.menu-button');await click('#msds-menu-button');assert.equal(await evaluate(`document.querySelector('#msds-menu').hidden`),false);
    await click('[data-view-link="risk-assessment"]');assert.equal(await evaluate(`document.querySelector('#risk-assessment').hidden`),false);
  }
  // Seed final editable UI state; this intentionally does not exercise the PDF parser.
  await click('[data-view-link="maker"]');
  await evaluate(`document.querySelector('#results').hidden=false;document.querySelector('#product-name').value='브라우저 경고표지';document.querySelector('#hazard-statements').value='<img src=x onerror=alert(1)> 안전 원문';`);
  await click('#save-warning');await wait(`document.querySelector('#save-warning-status').textContent==='내 문서에 저장되었습니다.'`);
  await click('[data-view-link="process-guide"]');
  const guide={productName:'브라우저 관리요령',signalWord:'위험',ghs:['GHS02'],hazardStatements:'관리요령 원문',handling:{safeHandling:'편집된 취급'},firstAid:{eye:'눈 원문',skin:'',inhalation:'',ingestion:''},accidentResponse:{fire:'화재 원문',spill:''},selectedPpe:['301'],ppeNone:false};
  await evaluate(`window.__hssoProcessGuideEditableData=${JSON.stringify(guide)};document.querySelector('#process-preview').hidden=false;`);
  await click('#save-process');await wait(`document.querySelector('#save-process-status').textContent==='내 문서에 저장되었습니다.'`);
  await click('[data-view-link="mypage"]');await ready();assert.equal(await evaluate(`document.querySelectorAll('.my-document-row').length`),2);
  await click('[data-my-section="documents"]');await ready();
  for(const width of [1440,390]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),true,`populated documents overflow ${width}`);
  }
  await evaluate(`document.querySelector('[name=type]').value='process_guide';document.querySelector('[name=type]').dispatchEvent(new Event('change'))`);await ready();assert.equal(await evaluate(`document.querySelectorAll('.my-document-row').length`),1);
  await evaluate(`document.querySelector('[name=type]').value='';document.querySelector('[name=type]').dispatchEvent(new Event('change'))`);await ready();
  await evaluate(`document.querySelector('[name=period]').value='7';document.querySelector('[name=period]').dispatchEvent(new Event('change'))`);await ready();assert.equal(await evaluate(`document.querySelector('[name=period]').value`),'7');
  await evaluate(`document.querySelector('[name=q]').value='  브라우저 경고표지  ';document.querySelector('.my-filters').requestSubmit()`);await ready();assert.equal(await evaluate(`document.querySelectorAll('.my-document-row').length`),1);
  await evaluate(`[...document.querySelectorAll('.my-document-row button')].find(b=>b.textContent==='보기').click()`);await ready();assert((await evaluate(`document.querySelector('#my-content').textContent`)).includes('<img src=x onerror=alert(1)> 안전 원문'));assert.equal(await evaluate(`document.querySelector('#my-content img[src=x]')===null`),true);
  await evaluate(`[...document.querySelectorAll('#my-content button')].find(b=>b.textContent==='목록으로').click()`);await ready();
  await evaluate(`[...document.querySelectorAll('.my-document-row button')].find(b=>b.textContent==='삭제').click()`);assert.equal(await evaluate(`document.activeElement.id`),'my-delete-cancel');
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait(`!document.querySelector('#my-delete-dialog').open`);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM saved_documents').get().n,2);
  await evaluate(`[...document.querySelectorAll('.my-document-row button')].find(b=>b.textContent==='삭제').click()`);await click('#my-delete-confirm');await ready();assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM saved_documents').get().n,1);
  failDocuments=true;await click('[data-my-section="dashboard"]');await wait(`document.querySelector('#my-status').textContent.includes('불러오지 못했습니다')`);failDocuments=false;
  await click('#header-logout');await wait(`location.hash==='#home' && !document.querySelector('#header-login').hidden`);
  await cdp('Page.navigate',{url:base+'/#mypage'});await wait(`location.hash==='#login'`);assert.equal(await evaluate(`document.querySelector('#my-content').textContent`),'');
  assert.deepEqual(errors,[]);
  t.diagnostic('1440/768/390px, local real API, navigation, two save adapters, search/detail/XSS/delete/ESC/error/logout protection passed. PDF dependencies stubbed.');
});
