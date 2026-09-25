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
  const project=fileURLToPath(new URL('..',import.meta.url));let base,manage=false,uploaded=false,persistedIngredients=[],managedDepartments=[{id:'22222222-2222-4222-8222-222222222222',name:'시설팀',status:'active'},{id:'66666666-6666-4666-8666-666666666666',name:'객실관리팀',status:'active'}],productInfo={productName:'WD-40',manufacturer:'제조사',supplier:'공급사',productCode:'WD40',generalUse:'윤활',productStatus:'ACTIVE'};
  const server=createServer(async(req,res)=>{try{
    const url=new URL(req.url,base),path=url.pathname;
    const respond=(code,data)=>res.writeHead(code,{'Content-Type':'application/json'}).end(JSON.stringify(data));
    if(path==='/api/companies')return respond(200,{ok:true,companies:[{id:'11111111-1111-4111-8111-111111111111',name:'테스트 회사',status:'active',membershipStatus:'active'}]});
    if(path==='/api/chemicals/context')return respond(200,{ok:true,access:{companyId:'11111111-1111-4111-8111-111111111111',departmentId:'22222222-2222-4222-8222-222222222222',read:true,report:true,manage,companyAdmin:manage},departments:managedDepartments.filter(item=>item.status==='active').map(({id,name})=>({id,name}))});
    if(path==='/api/companies/11111111-1111-4111-8111-111111111111/departments'&&req.method==='GET')return respond(200,{ok:true,departments:managedDepartments});
    if(path==='/api/companies/11111111-1111-4111-8111-111111111111/departments'&&req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));managedDepartments.push({id:'77777777-7777-4777-8777-777777777777',name:body.name,status:'active'});return respond(201,{ok:true,department:managedDepartments.at(-1)});}
    if(path==='/api/chemicals/candidates')return respond(200,{ok:true,candidates:[{id:'33333333-3333-4333-8333-333333333333',productName:'WD-40',manufacturer:'제조사'}]});
    if(path==='/api/chemicals/dashboard')return respond(200,{ok:true,summary:{products:1,withMsds:uploaded?1:0,withoutMsds:uploaded?0:1,registered:uploaded?1:0,needsReview:0},departments:[{id:'22222222-2222-4222-8222-222222222222',name:'시설팀',products:1,withoutMsds:uploaded?0:1,needsReview:0}],gaps:{useLocationEmpty:0,storageLocationEmpty:0}});
    if(path==='/api/chemicals')return respond(200,{ok:true,products:[{id:'33333333-3333-4333-8333-333333333333',productName:'WD-40',manufacturer:'제조사',departmentNames:'시설팀',currentVersionId:uploaded?'55555555-5555-4555-8555-555555555555':null,needsReview:0,updatedAt:'2026-09-21T00:00:00.000Z'}]});
    if(path==='/api/chemicals/33333333-3333-4333-8333-333333333333/versions'&&req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const form=await new Request(base+path,{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}).formData(),composition=JSON.parse(String(form.get('composition')||'{"ingredients":[]}'));persistedIngredients=composition.ingredients.map((row,index)=>({...row,id:String(index),sortOrder:index}));uploaded=true;return respond(201,{ok:true,version:{id:'55555555-5555-4555-8555-555555555555',versionNo:1,isCurrent:true},ingredientCount:persistedIngredients.length});}
    if(path==='/api/chemicals/33333333-3333-4333-8333-333333333333'&&req.method==='PATCH'){const chunks=[];for await(const chunk of req)chunks.push(chunk);productInfo={...productInfo,...JSON.parse(Buffer.concat(chunks))};return respond(200,{ok:true});}
    if(path==='/api/chemicals/33333333-3333-4333-8333-333333333333')return respond(200,{ok:true,product:{id:'33333333-3333-4333-8333-333333333333',...productInfo,createdByName:'사용자',createdAt:'2026-09-21T00:00:00.000Z',currentVersionId:uploaded?'55555555-5555-4555-8555-555555555555':null,needsReview:0,versionNo:uploaded?1:null,originalFilename:uploaded?'WD-40_MSDS.pdf':null,fileSize:uploaded?1048576:null,issueDate:uploaded?'2026-08-10':null,revisionDate:uploaded?'2026-08-14':null,submissionNumber:uploaded?'AA123':null,uploadedByName:uploaded?'관리자':null,uploadedAt:uploaded?'2026-09-21T00:00:00.000Z':null},usages:[{id:'44444444-4444-4444-8444-444444444444',departmentId:'22222222-2222-4222-8222-222222222222',departmentName:'시설팀',purpose:'윤활',useLocation:'기계실',storageLocation:'시설 자재창고',stockQuantity:5,stockUnit:'EA',averageUsageQuantity:3,averageUsagePeriod:'월',usageUnit:'EA',reportedByName:'사용자'}],versions:uploaded?[{id:'55555555-5555-4555-8555-555555555555',versionNo:1,originalFilename:'WD-40_MSDS.pdf',fileSize:1048576,revisionDate:'2026-08-14',isCurrent:1,needsReview:0,uploadedAt:'2026-09-21T00:00:00.000Z'}]:[],currentIngredients:persistedIngredients});
    if(path.startsWith('/api/'))return respond(401,{ok:false,error:'UNAUTHENTICATED'});
    if(path==='/pdf-stub.js')return res.writeHead(200,{'Content-Type':'text/javascript'}).end(`export const GlobalWorkerOptions={};export const OPS={};export function getDocument({data}){const source=new TextDecoder().decode(data);if(source.includes('FAIL'))return{promise:Promise.reject(new Error('parse failed'))};const lines=source.includes('PARTIAL')?['1. 화학제품과 회사에 관한 정보','제품명 | Partial Product','2. 유해성·위험성','3. 구성성분의 명칭 및 함유량']:['1. 화학제품과 회사에 관한 정보','제품명 | WD-40 Multi-Use Product','제조사 | WD-40 Company','공급자 | Korea Supplier','제품 코드 | WD40-001','작성일 | 2026-08-10','개정일 | 2026-08-14','제출번호 | AA12345','2. 유해성·위험성','신호어 | 위험','3. 구성성분의 명칭 및 함유량','화학물질명 | 관용명 및 이명 | CAS 번호 또는 식별번호 | 함유량(%)','Toluene | Methylbenzene | 108-88-3 | 10~20%','4. 응급조치 요령'];const items=lines.map((str,index)=>({str,transform:[1,0,0,10,0,1000-index*30],width:str.length*8,height:10}));return{promise:Promise.resolve({numPages:1,getPage:async()=>({getTextContent:async()=>({items}),cleanup(){}})})}}`);
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
    const dashboard=await evaluate(`({overflow:document.documentElement.scrollWidth<=innerWidth,summary:document.querySelector('.chemical-summary').textContent,departments:document.querySelector('.chemical-departments').textContent,report:!!document.querySelector('[data-chemical="new"]'),excel:!!document.querySelector('[data-chemical="export"]'),upload:!!document.querySelector('.chemical-storage-note')})`);
    assert.equal(dashboard.overflow,true,`dashboard overflow ${width}`);assert.match(dashboard.summary,/등록 제품\s*1/);assert.match(dashboard.summary,/MSDS 등록 완료\s*0/);assert.match(dashboard.summary,/원문 없음\s*1/);assert.doesNotMatch(dashboard.summary,/검토 전/);assert.match(dashboard.departments,/시설팀/);assert.equal(dashboard.report,true);assert.equal(dashboard.excel,true);assert.equal(dashboard.upload,false);
    await evaluate(`document.querySelector('.chemical-product-row').click()`);await wait(`document.querySelector('.chemical-tabs')`);
    await evaluate(`document.querySelector('[data-tab="usages"]').click()`);assert.match(await evaluate(`document.querySelector('.chemical-detail-body').textContent`),/기계실[\s\S]*시설 자재창고/);
    await evaluate(`document.querySelector('[data-tab="msds"]').click()`);assert.match(await evaluate(`document.querySelector('.chemical-detail-body').textContent`),/MSDS 원문\s*✕ 없음/);
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,`detail overflow ${width}`);
  }
  await evaluate(`document.querySelector('[data-chemical="dashboard"]').click()`);
  await evaluate(`document.querySelector('[data-chemical="new"]').click()`);
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'registration overflow 390');
  assert.equal(await evaluate(`!!document.querySelector('#chemical-create .chemical-upload-section')`),false,'reporter upload area hidden');
  assert.match(await evaluate(`document.querySelector('#chemical-create .chemical-msds-guidance').textContent`),/MSDS 원문은 안전부서\/MSDS 관리자가 등록합니다/);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#chemical-create [name="departmentId"] option')].map(option=>option.textContent)`),['시설팀','객실관리팀'],'membership department does not limit MSDS usage departments');
  await evaluate(`document.querySelector('#chemical-create [name="productName"]').value='WD-40';document.querySelector('#chemical-create [name="productName"]').dispatchEvent(new Event('focusout',{bubbles:true}))`);
  await wait(`document.querySelector('[data-chemical="reuse"]')`);
  assert.match(await evaluate(`document.querySelector('#chemical-candidates').textContent`),/기존 제품에 우리 부서 사용정보 추가/);
  manage=true;await cdp('Page.navigate',{url:base+'/#chemicals'});await wait(`document.querySelector('.chemical-product-row')`);
  await evaluate(`document.querySelector('[data-chemical="manage-departments"]').click()`);await wait(`document.querySelector('.chemical-department-management')`);
  assert.match(await evaluate(`document.querySelector('.chemical-department-management').textContent`),/MSDS 관리 부서/);assert.deepEqual(await evaluate(`[...document.querySelectorAll('.chemical-department-form [name="name"]')].map(input=>input.value)`),['시설팀','객실관리팀']);
  await evaluate(`(()=>{const form=document.querySelector('.chemical-department-add');form.elements.name.value='조경팀';form.requestSubmit();})()`);await wait(`[...document.querySelectorAll('.chemical-department-form [name="name"]')].some(input=>input.value==='조경팀')`);
  await evaluate(`document.querySelector('[data-chemical="new"]').click()`);
  assert.equal(await evaluate(`!!document.querySelector('#chemical-create .chemical-upload-section input[type="file"]')`),true,'manager product + PDF UI');
  await evaluate(`(()=>{const input=document.querySelector('#chemical-create input[type="file"]'),transfer=new DataTransfer();transfer.items.add(new File(['%PDF-1.7'], 'WD-40.pdf',{type:'application/pdf'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelector('#chemical-create .chemical-analysis-status')?.textContent.includes('분석 완료')`);
  assert.deepEqual(await evaluate(`Object.fromEntries(['productName','manufacturer','supplier','productCode','issueDate','revisionDate','submissionNumber'].map(name=>[name,document.querySelector('#chemical-create [name="'+name+'"]').value]))`),{productName:'WD-40 Multi-Use Product',manufacturer:'WD-40 Company',supplier:'Korea Supplier',productCode:'WD40-001',issueDate:'2026-08-10',revisionDate:'2026-08-14',submissionNumber:'AA12345'});
  assert.match(await evaluate(`document.querySelector('#chemical-create .chemical-composition-editor').textContent`),/구성성분\s*1개[\s\S]*자동 추출/);
  assert.deepEqual(await evaluate(`Object.fromEntries(['compositionChemicalName','compositionSynonym','compositionCasValue','compositionAmountRaw'].map(name=>[name,document.querySelector('#chemical-create [name="'+name+'"]').value]))`),{compositionChemicalName:'Toluene',compositionSynonym:'Methylbenzene',compositionCasValue:'108-88-3',compositionAmountRaw:'10~20%'});
  await evaluate(`document.querySelector('#chemical-create [data-chemical="add-ingredient"]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('#chemical-create .chemical-composition-row').length`),2);
  await evaluate(`document.querySelectorAll('#chemical-create [data-chemical="remove-ingredient"]')[1].click()`);
  assert.equal(await evaluate(`document.querySelectorAll('#chemical-create .chemical-composition-row').length`),1);
  await evaluate(`(()=>{const field=document.querySelector('#chemical-create [name="productName"]');field.value='사용자 수정 제품명';field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert.equal(await evaluate(`document.querySelector('#chemical-create [data-auto-for="productName"]').textContent`),'수정됨');
  await evaluate(`(()=>{const input=document.querySelector('#chemical-create input[type="file"]'),transfer=new DataTransfer();transfer.items.add(new File(['%PDF-FAIL'], 'broken.pdf',{type:'application/pdf'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelector('#chemical-create .chemical-analysis-status')?.textContent.includes('직접 입력')`);
  assert.equal(await evaluate(`document.querySelector('#chemical-create [name="productName"]').value`),'사용자 수정 제품명','analysis failure preserves editable manual input');
  await evaluate(`document.querySelector('[data-chemical="dashboard"]').click()`);
  await evaluate(`document.querySelector('[data-chemical="new"]').click()`);
  await evaluate(`(()=>{const input=document.querySelector('#chemical-create input[type="file"]'),transfer=new DataTransfer();transfer.items.add(new File(['%PDF-PARTIAL'], 'partial.pdf',{type:'application/pdf'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelector('#chemical-create .chemical-analysis-status')?.textContent.includes('분석 완료')`);
  assert.match(await evaluate(`document.querySelector('#chemical-create .chemical-composition-editor').textContent`),/표 구조가 복잡하여 자동 분석이 제한됩니다/);
  assert.deepEqual(await evaluate(`Object.fromEntries(['manufacturer','supplier','productCode','issueDate','revisionDate','submissionNumber'].map(name=>[name,document.querySelector('#chemical-create [name="'+name+'"]').value]))`),{manufacturer:'',supplier:'',productCode:'',issueDate:'',revisionDate:'',submissionNumber:''},'missing parsed values stay empty');
  await evaluate(`document.querySelector('[data-chemical="dashboard"]').click()`);
  await evaluate(`document.querySelector('.chemical-product-row').click()`);await wait(`document.querySelector('.chemical-tabs')`);
  await evaluate(`document.querySelector('[data-tab="usages"]').click()`);
  const usageText=await evaluate(`document.querySelector('.chemical-detail-body').textContent`);assert.match(usageText,/\+ 사용부서 추가/);assert.match(usageText,/사용정보 수정/);assert.match(usageText,/삭제/);
  await evaluate(`document.querySelector('[data-tab="msds"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-chemical="show-upload"]').textContent`),'MSDS 원문 등록');
  await evaluate(`document.querySelector('[data-chemical="show-upload"]').click()`);
  assert.equal(await evaluate(`!!document.querySelector('.chemical-msds-upload input[accept*=".pdf"]')`),true);
  await evaluate(`(()=>{const input=document.querySelector('.chemical-msds-upload input[type="file"]'),transfer=new DataTransfer();transfer.items.add(new File(['%PDF-1.7'], 'WD-40_MSDS.pdf',{type:'application/pdf'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelector('.chemical-msds-upload .chemical-analysis-status')?.textContent.includes('분석 완료')`);
  assert.match(await evaluate(`document.querySelector('.chemical-analysis-comparison').textContent`),/기존 정보:\s*WD-40[\s\S]*MSDS 분석/);
  assert.equal(await evaluate(`document.querySelector('[name="analysis_productName"]').value`),'WD-40 Multi-Use Product');
  assert.match(await evaluate(`document.querySelector('.chemical-msds-upload .chemical-composition-editor').textContent`),/구성성분\s*1개[\s\S]*자동 추출/);
  assert.equal(await evaluate(`document.querySelector('.chemical-msds-upload [name="compositionChemicalName"]').value`),'Toluene');
  assert.equal(await evaluate(`document.querySelector('[name="analysisChoice_productName"]:checked').value`),'keep','conflicting product name is not overwritten by default');
  assert.match(await evaluate(`document.querySelector('.chemical-msds-status').textContent`),/✕ 없음/,'analysis alone is not persisted');
  await evaluate(`document.querySelector('.chemical-msds-upload [name="compositionAmountRaw"]').value='5~10%'`);
  await evaluate(`document.querySelector('.chemical-msds-upload [name="compositionCasValue"]').value='108-88-4';document.querySelector('.chemical-msds-upload').requestSubmit()`);
  await wait(`document.querySelector('.chemical-msds-upload [name="compositionCasValue"]').validationMessage.includes('checksum')`);
  assert.equal(uploaded,false,'invalid CAS does not upload');
  await evaluate(`document.querySelector('.chemical-msds-upload [name="compositionCasValue"]').value='108-88-3';document.querySelector('.chemical-msds-upload [name="compositionCasValue"]').dispatchEvent(new Event('input',{bubbles:true}))`);
  await evaluate(`document.querySelector('[name="analysisChoice_productName"][value="apply"]').click()`);
  await evaluate(`document.querySelector('.chemical-msds-upload').requestSubmit()`);
  await wait(`document.querySelector('.chemical-msds-status')?.textContent.includes('✓ 있음')`);
  assert.equal(await evaluate(`document.querySelector('.chemical-detail-head h2').textContent`),'WD-40 Multi-Use Product','explicit analysis choice updates the existing product without creating another product');
  assert.equal(await evaluate(`document.querySelector('[data-chemical="show-upload"]').textContent`),'새 버전 등록');
  assert.match(await evaluate(`document.querySelector('.chemical-saved-composition').textContent`),/구성성분 1개[\s\S]*Toluene[\s\S]*108-88-3[\s\S]*5~10%[\s\S]*검토 완료/,'re-entry renders DB-authoritative reviewed ingredients');
  const badge=await evaluate(`(()=>{const badge=document.querySelector('.chemical-saved-ingredient-list article em'),style=getComputedStyle(badge),box=badge.getBoundingClientRect();return {display:style.display,alignItems:style.alignItems,lineHeight:style.lineHeight,width:box.width,height:box.height,text:badge.textContent}})()`);assert.equal(badge.display,'flex');assert.equal(badge.alignItems,'center');assert.notEqual(badge.lineHeight,'normal');assert(badge.width<100&&badge.height<30);assert.equal(badge.text,'검토 완료');
  assert.match(await evaluate(`document.querySelector('.chemical-detail-body').textContent`),/MSDS 상태\s*등록 완료/);
  assert.equal(await evaluate(`document.querySelectorAll('.chemical-file-actions a').length>=4`),true);
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'upload detail overflow 390');
  await evaluate(`document.querySelector('.chemical-quick [data-view-link="maker"]').click()`);
  assert.equal(await evaluate(`location.hash==='#maker'&&!document.querySelector('#maker').hidden`),true);
  assert.deepEqual(errors,[]);
});
