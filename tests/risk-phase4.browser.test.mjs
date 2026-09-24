import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('browser: Phase 4 preview-confirm-integrated workflow and responsive table',{skip:!process.env.HSSO_BROWSER,timeout:30000},async t=>{
  const project=fileURLToPath(new URL('..',import.meta.url)),companyId=crypto.randomUUID(),workbookId=crypto.randomUUID();let base,imported=false,submitted=null;
  const item={sourceRowNumber:8,workNumber:'1',workProcess:'크레인 점검',hazardFactor:'끼임',hazardSituation:'회전체 끼임 위험',currentMeasures:'방호덮개',likelihood:3,severity:4,riskScore:12,reductionMeasures:'인터록 설치',afterLikelihood:null,afterSeverity:null,afterRiskScore:null,plannedCompletionDate:null,actualCompletionDate:null,responsiblePerson:'',legacyImprovementNumber:'OLD-7',legalBasis:'산업안전보건기준',alreadyImported:false};
  const server=createServer(async(req,res)=>{const url=new URL(req.url,base);
    if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/assets/risk/phase4.css"><div id="app"></div><script type="module">import{mountRiskPhase4}from'/assets/risk/phase4.js';mountRiskPhase4(document.querySelector('#app'),{companyId:${JSON.stringify(companyId)},back(){},isCurrent:()=>true,loginRequired(){}});const wait=q=>new Promise((ok,no)=>{let n=0,t=setInterval(()=>{if(document.querySelector(q)){clearInterval(t);ok()}else if(++n>100){clearInterval(t);no(new Error(q))}},25)});try{await wait('.risk-phase4-book');[...document.querySelectorAll('button')].find(v=>v.textContent==='평가항목 미리보기').click();await wait('.risk-phase4-preview-item');document.querySelector('[name=workProcess]').value='브라우저 수정 작업';document.querySelector('.risk-phase4-preview').requestSubmit();await wait('.risk-phase4-table-wrap tbody tr');const result=document.createElement('output');result.id='browser-result';result.textContent='PASS|'+document.querySelector('.risk-phase4-table-wrap').textContent+'|overflow:'+(document.documentElement.scrollWidth<=innerWidth);document.body.append(result)}catch(error){document.body.dataset.error=error.message}</script>`);return;}
    if(url.pathname.startsWith('/assets/')){try{const path=resolve(project,url.pathname.slice(1));assert(path.startsWith(project));res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css':'text/javascript'}).end(await readFile(path));}catch{res.writeHead(404).end();}return;}
    if(url.pathname.startsWith('/api/')){let body='';for await(const chunk of req)body+=chunk;const json=value=>{res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ok:true,...value}));};
      if(url.pathname.endsWith('/risk-workbooks'))return json({workbooks:[{id:workbookId,originalFilename:'회사양식.xlsx',referenceYear:2026,size:1000}]});
      if(url.pathname.endsWith('/preview'))return json({workbook:{id:workbookId,originalFilename:'회사양식.xlsx'},items:[item]});
      if(url.pathname.endsWith('/import')){submitted=JSON.parse(body);imported=true;return json({importedCount:1});}
      if(url.pathname.endsWith('/integrated'))return json({items:imported?[{...item,id:crypto.randomUUID(),sourceType:'EXCEL_IMPORT',sourceLabel:'기존 Excel',workProcess:submitted.items[0].workProcess,improvementNumber:'OLD-7'}]:[]});
      if(url.pathname.endsWith('/carry-forward'))return json({fromYear:2025,toYear:2026,items:[]});}
    res.writeHead(404).end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;t.after(()=>{server.closeAllConnections();server.close();});
  const profile=await mkdtemp(join(tmpdir(),'hsso-phase4-browser-'));t.after(async()=>{assert.equal(dirname(resolve(profile)),resolve(tmpdir()));assert(basename(profile).startsWith('hsso-phase4-browser-'));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  const child=spawn(process.env.HSSO_BROWSER,['--headless=new','--disable-gpu','--no-sandbox','--disable-crash-reporter','--no-first-run','--disable-background-networking','--dump-dom','--virtual-time-budget=7000','--window-size=390,800','--user-data-dir='+profile,base],{windowsHide:true,stdio:['ignore','pipe','ignore']}),chunks=[];child.stdout.on('data',chunk=>chunks.push(chunk));const[code]=await once(child,'exit'),dom=Buffer.concat(chunks).toString('utf8');assert.equal(code,0);assert.match(dom,/id="browser-result"/);assert.match(dom,/class="risk-phase4-summary">총 1건 · 기존 Excel 1건 · 올해 신규 0건 · 전년도 승계 0건/);assert.match(dom,/PASS\|.*기존 Excel.*브라우저 수정 작업.*OLD-7.*overflow:true/s);assert.equal(submitted.items[0].workProcess,'브라우저 수정 작업');assert.equal(submitted.items[0].riskScore,null);
});
