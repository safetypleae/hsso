// Focused home-only browser regression. Run with HSSO_BROWSER pointing to Chrome/Edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const browserPath=process.env.HSSO_BROWSER;
test('home Scorpius background and narrative system visuals', {skip:!browserPath,timeout:45000}, async t=>{
  await access(browserPath);
  const project=fileURLToPath(new URL('..',import.meta.url));
  let base;
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,base);
      if(url.pathname.startsWith('/api/')){res.writeHead(401,{'Content-Type':'application/json'}).end('{"ok":false}');return;}
      if(url.pathname==='/pdf-stub.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end('export const GlobalWorkerOptions = {};');return;}
      const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
      if(!['index.html','script.js','auth.js','email-verification-ui.js','password-policy.js','mypage.js','saved-document-preview.js','style.css','mypage.css'].includes(relative)&&!/^assets\/[a-z0-9/.-]+$/i.test(relative)){res.writeHead(404).end();return;}
      let content=await readFile(join(project,relative));
      if(relative==='index.html')content=content.toString().replace(/<script src="https:[^"]+"><\/script>/g,'');
      if(relative==='script.js')content=content.toString().replace('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.mjs','/pdf-stub.js');
      res.writeHead(200,{'Content-Type':{'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'}[extname(relative)]||'application/octet-stream'}).end(content);
    } catch { res.writeHead(500).end('Local test server error'); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const profile=await mkdtemp(join(tmpdir(),'hsso-home-'));
  const child=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  t.after(async()=>{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.equal(dirname(resolve(profile)),resolve(tmpdir()));assert(basename(profile).startsWith('hsso-home-'));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
  const wsUrl=await new Promise((resolveUrl,reject)=>{let log='';child.stderr.on('data',chunk=>{log+=chunk;const match=log.match(/DevTools listening on (ws:\/\/\S+)/);if(match)resolveUrl(match[1]);});child.once('error',reject);child.once('exit',()=>reject(new Error('Browser exited before DevTools')));});
  const ws=new WebSocket(wsUrl);await once(ws,'open');t.after(()=>ws.close());let serial=0;const pending=new Map();const errors=[];
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const task=pending.get(message.id);pending.delete(message.id);if(message.error)task.reject(new Error(message.error.message));else task.resolve(message.result);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push('console.error');});
  function send(method,params={},sessionId){return new Promise((resolveSend,reject)=>{const id=++serial;pending.set(id,{resolve:resolveSend,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const cdp=(method,params)=>send(method,params,sessionId);await cdp('Runtime.enable');await cdp('Page.enable');
  const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description);return result.result.value;};
  async function wait(expression){const until=Date.now()+5000;while(Date.now()<until){if(await evaluate(expression))return;await new Promise(resolveWait=>setTimeout(resolveWait,30));}throw new Error('Timed out: '+expression);}
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});

  for(const width of [1920,1440,1024,768,390]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await cdp('Page.navigate',{url:base+'/'});await wait(`document.querySelectorAll('.hsso-constellation-stars circle').length===15&&getComputedStyle(document.querySelector('.hsso-constellation-stars circle')).animationName!=='none'`);
    const home=await evaluate(`(()=>{const foreground=['.portal-brand','.portal-floating-notice','.portal-recent','.portal-quiz'].map(selector=>document.querySelector(selector).getBoundingClientRect());const first=document.querySelector('.hsso-constellation-stars circle'),last=document.querySelector('.hsso-constellation-stars circle:last-child');return {overflow:document.documentElement.scrollWidth<=innerWidth,foreground:foreground.every(rect=>rect.width>0&&rect.height>0),stars:document.querySelectorAll('.hsso-constellation-stars circle').length,lines:document.querySelectorAll('.hsso-constellation-lines path').length,antares:!!document.querySelector('.hsso-antares'),delays:[first.style.getPropertyValue('--d'),last.style.getPropertyValue('--d')],entrance:getComputedStyle(first).animationName.includes('hsso-constellation-enter'),network:!!document.querySelector('.hsso-safety-network'),shooting:[...document.querySelectorAll('.hsso-shooting-star')].every(star=>getComputedStyle(star).display!=='none'),rects:foreground.map(({x,y,width,height})=>[x,y,width,height])};})()`);
    assert.equal(home.overflow,true,`page 1 overflow ${width}`);assert.equal(home.foreground,true,`foreground visible ${width}`);assert.equal(home.stars,15,`star count ${width}`);assert.equal(home.lines,9,`line count ${width}`);assert.equal(home.antares,true,`Antares ${width}`);assert.deepEqual(home.delays,['.15s','3.4s'],`entrance delays ${width}`);assert.equal(home.entrance,true,`entrance animation ${width}`);assert.equal(home.network,false,`legacy network ${width}`);assert.equal(home.shooting,width>700,`shooting stars ${width}`);
    if(width===1440){await new Promise(resolveWait=>setTimeout(resolveWait,3700));const after=await evaluate(`['.portal-brand','.portal-floating-notice','.portal-recent','.portal-quiz'].map(selector=>{const {x,y,width,height}=document.querySelector(selector).getBoundingClientRect();return [x,y,width,height]})`);assert.deepEqual(after,home.rects,'constellation entrance must not move foreground');}
    await evaluate(`document.querySelector('.main-nav [data-home-section="systems"]').click()`);await wait(width>=1001?`document.querySelector('#home').dataset.portalPage==='2'`:`location.hash==='#systems'`);
    const systems=await evaluate(`(()=>{const grid=document.querySelector('.hsso-systems-grid'),cards=[...document.querySelectorAll('.hsso-system-card')];return {columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,overflow:document.documentElement.scrollWidth<=innerWidth&&cards.every(card=>card.scrollWidth<=card.clientWidth),chemical:!!document.querySelector('.chem-document')&&!!document.querySelector('.chem-analyzer')&&document.querySelectorAll('.chem-results span').length===5,risk:document.querySelectorAll('.risk-participants>span').length===3&&!!document.querySelector('.risk-survey-panel')&&!!document.querySelector('.risk-comment'),health:document.querySelectorAll('.health-task-list>div').length===4&&!!document.querySelector('.health-board'),animations:[getComputedStyle(document.querySelector('.chem-document')).animationName,getComputedStyle(document.querySelector('.risk-choice i'),'::after').animationName,getComputedStyle(document.querySelector('.health-next-task')).animationName]};})()`);
    assert.equal(systems.columns,width>=1001?3:width>=701?2:1,`system columns ${width}`);assert.equal(systems.overflow,true,`page 3 overflow ${width}`);assert.equal(systems.chemical,true);assert.equal(systems.risk,true);assert.equal(systems.health,true);assert.deepEqual(systems.animations,['chem-document-cycle','risk-option-cycle','health-next-task']);
  }

  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await cdp('Page.navigate',{url:base+'/'});await wait(`document.querySelectorAll('.hsso-constellation-stars circle').length===15`);
  assert.deepEqual(await evaluate(`({star:getComputedStyle(document.querySelector('.hsso-constellation-stars circle')).animationName,line:getComputedStyle(document.querySelector('.hsso-constellation-lines path')).strokeDashoffset,shoot:getComputedStyle(document.querySelector('.hsso-shooting-star')).display,chemical:getComputedStyle(document.querySelector('.chem-results span')).opacity,saved:getComputedStyle(document.querySelector('.risk-survey-panel>em')).opacity,next:getComputedStyle(document.querySelector('.health-next-task')).opacity})`),{star:'none',line:'0px',shoot:'none',chemical:'1',saved:'1',next:'1'});
  assert.deepEqual(errors,[]);
});
