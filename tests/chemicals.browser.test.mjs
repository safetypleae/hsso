// Focused chemical workspace layout and navigation regression. HSSO_BROWSER points to Chrome/Edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdtemp,rm,access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename,extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const browserPath=process.env.HSSO_BROWSER;
test('chemical dashboard, product status and mobile layout', {skip:!browserPath,timeout:45000},async t=>{
  await access(browserPath);
  const project=fileURLToPath(new URL('..',import.meta.url));let base,manage=false;
  const server=createServer(async(req,res)=>{try{
    const url=new URL(req.url,base),path=url.pathname;
    const respond=(code,data)=>res.writeHead(code,{'Content-Type':'application/json'}).end(JSON.stringify(data));
    if(path==='/api/companies')return respond(200,{ok:true,companies:[{id:'11111111-1111-4111-8111-111111111111',name:'테스트 회사',status:'active',membershipStatus:'active'}]});
    if(path==='/api/chemicals/context')return respond(200,{ok:true,access:{companyId:'11111111-1111-4111-8111-111111111111',departmentId:'22222222-2222-4222-8222-222222222222',read:true,report:true,manage},departments:[{id:'22222222-2222-4222-8222-222222222222',name:'시설팀'}]});
    if(path==='/api/chemicals/candidates')return respond(200,{ok:true,candidates:[{id:'33333333-3333-4333-8333-333333333333',productName:'WD-40',manufacturer:'제조사'}]});
    if(path==='/api/chemicals/dashboard')return respond(200,{ok:true,summary:{products:1,withMsds:0,withoutMsds:1,unreviewed:0},departments:[{id:'22222222-2222-4222-8222-222222222222',name:'시설팀',products:1,withoutMsds:1,unreviewed:0}],gaps:{useLocationEmpty:0,storageLocationEmpty:0}});
    if(path==='/api/chemicals')return respond(200,{ok:true,products:[{id:'33333333-3333-4333-8333-333333333333',productName:'WD-40',manufacturer:'제조사',departmentNames:'시설팀',currentVersionId:null,reviewStatus:null,updatedAt:'2026-09-21T00:00:00.000Z'}]});
    if(path==='/api/chemicals/33333333-3333-4333-8333-333333333333')return respond(200,{ok:true,product:{id:'33333333-3333-4333-8333-333333333333',productName:'WD-40',manufacturer:'제조사',supplier:'공급사',productCode:'WD40',generalUse:'윤활',productStatus:'ACTIVE',createdByName:'사용자',createdAt:'2026-09-21T00:00:00.000Z',currentVersionId:null},usages:[{id:'44444444-4444-4444-8444-444444444444',departmentId:'22222222-2222-4222-8222-222222222222',departmentName:'시설팀',purpose:'윤활',useLocation:'기계실',storageLocation:'시설 자재창고',stockQuantity:5,stockUnit:'EA',averageUsageQuantity:3,averageUsagePeriod:'월',usageUnit:'EA',reportedByName:'사용자'}],versions:[]});
    if(path.startsWith('/api/'))return respond(401,{ok:false,error:'UNAUTHENTICATED'});
    if(path==='/pdf-stub.js')return res.writeHead(200,{'Content-Type':'text/javascript'}).end('export const GlobalWorkerOptions = {};');
    const relative=path==='/'?'index.html':decodeURIComponent(path.slice(1));
    if(!['index.html','script.js','auth.js','email-verification-ui.js','password-policy.js','mypage.js','saved-document-preview.js','style.css','mypage.css'].includes(relative)&&!/^assets\/[a-z0-9/.-]+$/i.test(relative))return res.writeHead(404).end();
    let content=await readFile(join(project,relative));
    if(relative==='index.html')content=content.toString().replace(/<script src="https:[^"]+"><\/script>/g,'');
    if(relative==='script.js')content=content.toString().replace('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.mjs','/pdf-stub.js');
    res.writeHead(200,{'Content-Type':{'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'}[extname(relative)]||'application/octet-stream'}).end(content);
  }catch{res.writeHead(500).end('Local test server error');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;t.after(()=>new Promise(resolve=>server.close(resolve)));
  const profile=await mkdtemp(join(tmpdir(),'hsso-chem-'));
  const child=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  t.after(async()=>{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.equal(dirname(resolve(profile)),resolve(tmpdir()));assert(basename(profile).startsWith('hsso-chem-'));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
  const wsUrl=await new Promise((resolveUrl,reject)=>{let log='';child.stderr.on('data',chunk=>{log+=chunk;const match=log.match(/DevTools listening on (ws:\/\/\S+)/);if(match)resolveUrl(match[1]);});child.once('error',reject);child.once('exit',()=>reject(new Error('Browser exited before DevTools')));});
  const ws=new WebSocket(wsUrl);await once(ws,'open');t.after(()=>ws.close());let serial=0;const pending=new Map();const errors=[];
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const task=pending.get(message.id);pending.delete(message.id);if(message.error)task.reject(new Error(message.error.message));else task.resolve(message.result);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
  function send(method,params={},sessionId){return new Promise((resolveSend,reject)=>{const id=++serial;pending.set(id,{resolve:resolveSend,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
  const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});const cdp=(method,params)=>send(method,params,sessionId);await cdp('Runtime.enable');await cdp('Page.enable');
  async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description);return result.result.value;}
  async function wait(expression){const until=Date.now()+6000;while(Date.now()<until){if(await evaluate(expression))return;await new Promise(resolveWait=>setTimeout(resolveWait,40));}throw new Error('Timed out: '+expression);}
  for(const width of [1440,768,390]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await cdp('Page.navigate',{url:base+'/#chemicals'});
    await wait(`document.querySelector('.chemical-product-row')?.textContent.includes('WD-40')`);
    const dashboard=await evaluate(`({overflow:document.documentElement.scrollWidth<=innerWidth,summary:document.querySelector('.chemical-summary').textContent,departments:document.querySelector('.chemical-departments').textContent,report:!!document.querySelector('[data-chemical="new"]'),upload:!!document.querySelector('.chemical-storage-note')})`);
    assert.equal(dashboard.overflow,true,`dashboard overflow ${width}`);assert.match(dashboard.summary,/등록 제품\s*1/);assert.match(dashboard.summary,/원문 없음\s*1/);assert.match(dashboard.departments,/시설팀/);assert.equal(dashboard.report,true);assert.equal(dashboard.upload,false);
    await evaluate(`document.querySelector('.chemical-product-row').click()`);await wait(`document.querySelector('.chemical-tabs')`);
    await evaluate(`document.querySelector('[data-tab="usages"]').click()`);assert.match(await evaluate(`document.querySelector('.chemical-detail-body').textContent`),/기계실[\s\S]*시설 자재창고/);
    await evaluate(`document.querySelector('[data-tab="msds"]').click()`);assert.match(await evaluate(`document.querySelector('.chemical-detail-body').textContent`),/MSDS 원문\s*✕ 없음/);
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,`detail overflow ${width}`);
  }
  await evaluate(`document.querySelector('[data-chemical="dashboard"]').click()`);
  await evaluate(`document.querySelector('[data-chemical="new"]').click()`);
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'registration overflow 390');
  await evaluate(`document.querySelector('#chemical-create [name="productName"]').value='WD-40';document.querySelector('#chemical-create [name="productName"]').dispatchEvent(new Event('focusout',{bubbles:true}))`);
  await wait(`document.querySelector('[data-chemical="reuse"]')`);
  assert.match(await evaluate(`document.querySelector('#chemical-candidates').textContent`),/기존 제품에 우리 부서 사용정보 추가/);
  manage=true;await cdp('Page.navigate',{url:base+'/#chemicals'});await wait(`document.querySelector('.chemical-product-row')`);
  await evaluate(`document.querySelector('.chemical-product-row').click()`);await wait(`document.querySelector('.chemical-tabs')`);
  await evaluate(`document.querySelector('[data-tab="msds"]').click()`);
  assert.equal(await evaluate(`document.querySelector('.chemical-storage-note button').disabled`),true);
  assert.match(await evaluate(`document.querySelector('.chemical-storage-note').textContent`),/persistent storage/);
  await evaluate(`document.querySelector('.chemical-quick [data-view-link="maker"]').click()`);
  assert.equal(await evaluate(`location.hash==='#maker'&&!document.querySelector('#maker').hidden`),true);
  assert.deepEqual(errors,[]);
});
