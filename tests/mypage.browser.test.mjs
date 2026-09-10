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
      if(!['index.html','script.js','auth.js','mypage.js','saved-document-preview.js','style.css','mypage.css'].includes(relative)&&!/^assets\/[a-z0-9/.-]+$/i.test(relative)){res.writeHead(404).end();return;}
      let content=await readFile(join(project,relative));
      if(relative==='index.html')content=content.toString().replace(/<script src="https:[^"]+"><\/script>/g,'');
      if(relative==='script.js') {
        content=content.toString().replace('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.mjs','/pdf-stub.js');
        // Test-served instrumentation only: restoring/PDF must never consult parsers or source forms.
        content=content.replace(/((?:async )?function (?:extractPdfText|extractSectionTwoPictogramCrops|analyzeMsdsText|getFinalWarningLabelData|collectCategorizedPrecautions|parseSupplier|extractProcessSubfields)\([^\n]*\) \{)/g,
          '$1 if (window.__savedRestoreMode) { window.__unexpectedParse = true; throw new Error("Parser called during saved restore"); }');
        content+='\nwindow.__testOriginalProcessRenderer = renderProcessGuideData;';
      }
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
  await evaluate(`document.querySelector('#results').hidden=false;document.querySelector('#product-name').value='브라우저 경고표지';document.querySelector('#hazard-statements').value='<img src=x onerror=alert(1)> 안전 원문';document.querySelector('#signal-word').value='위험';document.querySelector('#precaution-statements').value='예방\\nP210 열을 피하시오.';document.querySelector('#pictogram-options input[value=GHS02]').click();`);
  await click('#save-warning');await wait(`document.querySelector('#save-warning-status').textContent==='내 문서에 저장되었습니다.'`);
  await click('[data-view-link="process-guide"]');
  const guide={productName:'브라우저 관리요령',signalWord:'위험',ghs:['GHS02'],hazardStatements:'관리요령 원문',handling:{safeHandling:'편집된 취급'},firstAid:{eye:'눈 원문',skin:'',inhalation:'',ingestion:''},accidentResponse:{fire:'화재 원문',spill:''},selectedPpe:['301'],ppeNone:false};
  await evaluate(`window.__hssoProcessGuideEditableData=${JSON.stringify(guide)};window.__testOriginalProcessRenderer(window.__hssoProcessGuideEditableData);`);
  await click('#save-process');await wait(`document.querySelector('#save-process-status').textContent==='내 문서에 저장되었습니다.'`);
  const storedBefore=db.sqlite.prepare('SELECT id,document_data FROM saved_documents ORDER BY id').all();
  // Keep unrelated unsaved work in the original tools while restoring saved documents.
  await evaluate(`document.querySelector('#product-name').value='저장하지 않은 다른 제품';window.__hssoProcessGuideEditableData.productName='저장하지 않은 관리요령';window.__testOriginalProcessRenderer(window.__hssoProcessGuideEditableData);window.__savedRestoreMode=true;`);
  const originalProcess=await evaluate(`JSON.stringify(window.__hssoProcessGuideEditableData)`);
  await evaluate(`
    window.__pdfSaves=[];window.__pdfCaptures=[];
    window.html2canvas=async (root,options)=>{
      window.__pdfCaptures.push({text:root.textContent,ghs:[...root.querySelectorAll('img[data-ghs-code]')].map(img=>img.dataset.ghsCode),ppe:[...root.querySelectorAll('[data-ppe]')].map(node=>node.dataset.ppe)});
      const canvas=document.createElement('canvas');canvas.width=Math.round(options.width*options.scale);canvas.height=Math.round(options.height*options.scale);
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
      const bounds=root.getBoundingClientRect();
      for(const img of root.querySelectorAll('img')){const box=img.getBoundingClientRect();ctx.drawImage(img,(box.left-bounds.left)*options.scale,(box.top-bounds.top)*options.scale,box.width*options.scale,box.height*options.scale);}
      return canvas;
    };
    window.jspdf={jsPDF:class {
      constructor(options){this.size=Array.isArray(options.format)?options.format:[210,297];this.internal={pageSize:{getWidth:()=>this.size[0],getHeight:()=>this.size[1]}};}
      getNumberOfPages(){return 1;} addImage(){} save(filename){window.__pdfSaves.push({filename,size:this.size});}
    }};
  `);
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
  assert.equal(await evaluate(`document.querySelectorAll('#my-content .warning-label').length`),1);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#my-content img[data-ghs-code]')].map(img=>img.dataset.ghsCode)`),['GHS02']);
  assert.equal(await evaluate(`document.querySelector('#my-content .preview-signal').textContent`),'위험');
  assert((await evaluate(`document.querySelector('#my-content .precaution-groups').textContent`)).includes('P210 열을 피하시오.'));
  async function checkPreviewWidths(selector) {
    for(const width of [1440,768,390]) {
      await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      await wait(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().width > 0 && document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().width <= document.querySelector('.saved-document-preview').clientWidth`);
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),true,`saved preview overflow ${width}`);
    }
  }
  await checkPreviewWidths('#my-content .print-sheet');
  for(const [size,count,dimensions] of [['대형',1,[210,297]],['중형',2,[297,210]],['소형',4,[210,297]],['custom',1,[180,240]]]) {
    await evaluate(`document.querySelector('[data-saved-size]').value=${JSON.stringify(size)};document.querySelector('[data-saved-size]').dispatchEvent(new Event('change'));`);
    if(size==='custom')await evaluate(`const inputs=document.querySelectorAll('.saved-custom-size input');inputs[0].value=180;inputs[1].value=240;inputs[1].dispatchEvent(new Event('input'));`);
    assert.equal(await evaluate(`document.querySelectorAll('#my-content .warning-label').length`),count);
    const saves=await evaluate('window.__pdfSaves.length');await click('[data-saved-pdf="warning_label"]');await wait(`window.__pdfSaves.length === ${saves+1}`);
    assert.deepEqual(await evaluate('window.__pdfSaves.at(-1).size'),dimensions);
    assert.equal(await evaluate('window.__pdfSaves.at(-1).filename'),'경고표지_브라우저 경고표지.pdf');
    assert.equal(await evaluate('window.__pdfCaptures.at(-1).ghs.length'),count);
    assert.equal(await evaluate('!!window.__unexpectedParse'),false);
    assert.equal(await evaluate(`document.querySelector('#product-name').value`),'저장하지 않은 다른 제품');
  }
  const back=()=>evaluate(`[...document.querySelectorAll('#my-content button')].find(b=>b.textContent==='← 내 문서로 돌아가기').click()`);
  await back();await ready();assert.equal(await evaluate(`document.querySelector('[name=q]').value`),'브라우저 경고표지');assert.equal(await evaluate(`document.querySelector('[name=period]').value`),'7');
  await evaluate(`document.querySelector('[name=q]').value='';document.querySelector('.my-filters').requestSubmit()`);await ready();
  await evaluate(`[...document.querySelectorAll('.my-document-row')].find(row=>row.textContent.includes('브라우저 관리요령')).querySelector('button').click()`);await ready();
  assert.equal(await evaluate(`document.querySelectorAll('#my-content .process-poster').length`),1);
  assert((await evaluate(`document.querySelector('#my-content .process-poster').textContent`)).includes('편집된 취급'));
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#my-content [data-ppe]')].map(node=>node.dataset.ppe)`),['eye']);
  assert.equal(await evaluate(`document.querySelectorAll('#my-content .process-poster [id]').length`),0);
  await checkPreviewWidths('#my-content .process-poster');
  const saves=await evaluate('window.__pdfSaves.length');await click('[data-saved-pdf="process_guide"]');await wait(`window.__pdfSaves.length === ${saves+1}`);
  assert.equal(await evaluate('window.__pdfSaves.at(-1).filename'),'작업공정별관리요령_브라우저 관리요령.pdf');
  assert.deepEqual(await evaluate('window.__pdfSaves.at(-1).size'),[210,297]);
  assert((await evaluate('window.__pdfCaptures.at(-1).text')).includes('편집된 취급'));assert.deepEqual(await evaluate('window.__pdfCaptures.at(-1).ppe'),['eye']);
  assert.equal(await evaluate('!!window.__unexpectedParse'),false);
  assert.equal(await evaluate('JSON.stringify(window.__hssoProcessGuideEditableData)'),originalProcess);
  assert.equal(await evaluate(`document.querySelector('#process-product-name').textContent`),'저장하지 않은 관리요령');
  assert.deepEqual(db.sqlite.prepare('SELECT id,document_data FROM saved_documents ORDER BY id').all(),storedBefore);
  await back();await ready();
  await evaluate(`document.querySelector('[name=q]').value='브라우저 경고표지';document.querySelector('.my-filters').requestSubmit()`);await ready();
  await evaluate(`[...document.querySelectorAll('.my-document-row button')].find(b=>b.textContent==='삭제').click()`);assert.equal(await evaluate(`document.activeElement.id`),'my-delete-cancel');
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait(`!document.querySelector('#my-delete-dialog').open`);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM saved_documents').get().n,2);
  await evaluate(`[...document.querySelectorAll('.my-document-row button')].find(b=>b.textContent==='삭제').click()`);await click('#my-delete-confirm');await ready();assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM saved_documents').get().n,1);
  // The original tools still use their default PDF entry points and their own data.
  await evaluate('window.__savedRestoreMode=false');
  await click('[data-view-link="maker"]');
  await click('input[name="label-size"][value="대형"]');
  let originalSaves=await evaluate('window.__pdfSaves.length');await click('#download-pdf');await wait(`window.__pdfSaves.length === ${originalSaves+1}`);
  assert.equal(await evaluate('window.__pdfSaves.at(-1).filename'),'경고표지_저장하지 않은 다른 제품.pdf');
  await click('[data-view-link="process-guide"]');
  originalSaves=await evaluate('window.__pdfSaves.length');await click('#process-download-pdf');await wait(`window.__pdfSaves.length === ${originalSaves+1}`);
  assert.equal(await evaluate('window.__pdfSaves.at(-1).filename'),'작업공정별관리요령_저장하지 않은 관리요령.pdf');
  await click('[data-view-link="mypage"]');await ready();
  failDocuments=true;await click('[data-my-section="dashboard"]');await wait(`document.querySelector('#my-status').textContent.includes('불러오지 못했습니다')`);failDocuments=false;
  await click('#header-logout');await wait(`location.hash==='#home' && !document.querySelector('#header-login').hidden`);
  await cdp('Page.navigate',{url:base+'/#mypage'});await wait(`location.hash==='#login'`);assert.equal(await evaluate(`document.querySelector('#my-content').textContent`),'');
  assert.deepEqual(errors,[]);
  t.diagnostic('1440/768/390px, actual saved previews, GHS/PPE/text, no parser calls, original state preserved, all warning sizes + process A4 PDF entry points passed. Only PDF dependencies are stubbed; no real PDF quality assertion.');
});
