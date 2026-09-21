import { onRequest as updateProfile } from '../functions/api/auth/profile.js';
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
import { seedEmailProof } from './helpers/email-proof.mjs';
import { requestEmailCode, verifyEmailCode } from '../server/email-verification.js';
import { collection, item } from '../server/documents.js';
import { onRequest as signup } from '../functions/api/auth/signup.js';
import { onRequest as login } from '../functions/api/auth/login.js';
import { onRequest as logout } from '../functions/api/auth/logout.js';
import { onRequest as me } from '../functions/api/auth/me.js';
import { surveyCollection } from '../server/risk-surveys.js';
import { dailyQuiz, points, kstDate } from '../server/daily-quiz.js';

const browserPath=process.env.HSSO_BROWSER;
test('local browser: protected dashboard, documents, adapters and responsive navigation', {skip:!browserPath,timeout:60000}, async t=>{
  await access(browserPath);
  const db=createTestDB();t.after(()=>db.close());
  db.sqlite.exec(await readFile(new URL('../migrations/0002_saved_documents.sql',import.meta.url),'utf8'));
  db.sqlite.exec(await readFile(new URL('../migrations/0003_risk_assessment.sql',import.meta.url),'utf8'));
  db.sqlite.exec(await readFile(new URL('../migrations/0012_quiz_points.sql',import.meta.url),'utf8'));
  db.sqlite.exec(await readFile(new URL('../migrations/0013_quiz_metadata.sql',import.meta.url),'utf8'));
  db.sqlite.prepare('INSERT INTO daily_quizzes (id,quiz_date,question,option_a,option_b,option_c,option_d,correct_option,explanation,is_active,created_at,category,difficulty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),kstDate(),'작업 전 보호구가 손상된 것을 발견했다면 어떻게 해야 합니까?','관리자에게 알리고 교체한다','그대로 사용한다','테이프로 임시 수리한다','동료 보호구를 몰래 사용한다','A','손상된 보호구는 보호 성능을 보장할 수 없으므로 보고 후 적합한 제품으로 교체해야 합니다.',1,new Date().toISOString(),'보호구','중급');
  // URL paths may contain Korean or spaces; use fileURLToPath for the actual filesystem root.
  const {fileURLToPath}=await import('node:url');const project=fileURLToPath(new URL('..',import.meta.url));
  let base;let failDocuments=false;
  const verificationEnv = { DB: db, RESEND_API_KEY: 'test-placeholder', EMAIL_FROM: 'fixture@example.test', EMAIL_VERIFICATION_SECRET: 'public-test-placeholder-not-a-real-secret' };
  const sentCodes = [];
  const sendCode = context => requestEmailCode(context, async (_, mail) => { sentCodes.push(mail); });
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,base);
      if(url.pathname.startsWith('/api/')) {
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
        const handlers={'/api/auth/email-code':sendCode,'/api/auth/verify-email':verifyEmailCode,'/api/auth/profile':updateProfile,'/api/auth/signup':signup,'/api/auth/login':login,'/api/auth/logout':logout,'/api/auth/me':me,'/api/documents':collection,'/api/risk-surveys':surveyCollection,'/api/daily-quiz':dailyQuiz,'/api/points':points};
        const handler=handlers[url.pathname] || (url.pathname.startsWith('/api/documents/')?item:null);
        if(!handler){res.writeHead(404).end();return;}
        const response=failDocuments&&url.pathname==='/api/documents'?Response.json({ok:false,error:'INTERNAL_SERVER_ERROR'},{status:500}):await handler({request,env:verificationEnv,params:{id:url.pathname.split('/')[3]}});
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
      }
      if(url.pathname==='/pdf-stub.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end('export const GlobalWorkerOptions = {};');return;}
      const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
      if(!['index.html','script.js','auth.js','email-verification-ui.js','password-policy.js','mypage.js','saved-document-preview.js','style.css','mypage.css'].includes(relative)&&!/^assets\/[a-z0-9/.-]+$/i.test(relative)){res.writeHead(404).end();return;}
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
  await click('[data-view-link="signup"]');
  await wait("location.hash === '#signup'");
  await evaluate("window.__signupCalls=0; const originalFetch=window.fetch; window.fetch=(url,options)=>{if(url==='/api/auth/signup')window.__signupCalls++;return originalFetch(url,options);}");
  for (const [value, expected] of [
    ['', ['○ 8자 이상','○ 영문 포함','○ 숫자 포함']],
    ['abcdefgh', ['✓ 8자 이상','✓ 영문 포함','○ 숫자 포함']],
    ['12345678', ['✓ 8자 이상','○ 영문 포함','✓ 숫자 포함']],
    ['abc123', ['○ 8자 이상','✓ 영문 포함','✓ 숫자 포함']],
    ['abc12345', ['✓ 8자 이상','✓ 영문 포함','✓ 숫자 포함']],
    ['', ['○ 8자 이상','○ 영문 포함','○ 숫자 포함']]
  ]) {
    await evaluate(`document.querySelector('#signup-password').value=${JSON.stringify(value)};document.querySelector('#signup-password').dispatchEvent(new Event('input',{bubbles:true}))`);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.auth-password-conditions li')].map(e=>e.textContent)"), expected);
  }
  await evaluate("for(const input of document.querySelectorAll('#signup-form input'))input.value=input.name==='email'?'ui@example.com':input.type==='password'?'abcdefgh':'Example';document.querySelector('#signup-form').requestSubmit()");
  assert.equal(await evaluate("document.querySelector('#signup-password-error').hidden"),false);
  assert.equal(await evaluate("document.querySelector('#signup-password-error').textContent"),'비밀번호는 8자 이상이며 영문과 숫자를 포함해야 합니다.');
  assert.equal(await evaluate('window.__signupCalls'),0);
  await evaluate("document.querySelector('#signup-password').value='abc12345';document.querySelector('#signup-form').requestSubmit()");
  assert.equal(await evaluate("document.querySelector('#signup-password-confirm-error').hidden"),false);
  assert.equal(await evaluate('window.__signupCalls'),0);
  await evaluate("document.querySelector('#signup-password-confirm').value='abc12345';document.querySelector('#signup-form').requestSubmit()");
  assert.equal(await evaluate('window.__signupCalls'),0);
  assert.equal(await evaluate("document.querySelector('#signup-submit').disabled"),true);
  await click('#signup-send-code');
  await wait("!document.querySelector('#signup-code-area').hidden");
  assert.equal(sentCodes.length,1);
  assert.equal(await evaluate("document.querySelector('#signup-send-code').disabled"),true);
  await evaluate(`document.querySelector('#signup-code').value=${JSON.stringify('000000' === sentCodes[0].code ? '000001' : '000000')}`);
  await click('#signup-verify-code');
  await wait("document.querySelector('#signup-verification-message').textContent.includes('올바르지')");
  await evaluate(`document.querySelector('#signup-code').value=${JSON.stringify(sentCodes[0].code)}`);
  await click('#signup-verify-code');
  await wait("!document.querySelector('#signup-submit').disabled");
  assert.equal(await evaluate("document.querySelector('#signup-verification-message').textContent.includes('인증이 완료')"),true);
  // Changing the email immediately invalidates proof, including changing back.
  await evaluate("document.querySelector('#signup-email').value='changed@example.com';document.querySelector('#signup-email').dispatchEvent(new Event('input',{bubbles:true}))");
  assert.equal(await evaluate("document.querySelector('#signup-submit').disabled"),true);
  assert.equal(await evaluate("document.querySelector('#signup-code-area').hidden"),true);
  await evaluate("document.querySelector('#signup-email').value='ui@example.com';document.querySelector('#signup-email').dispatchEvent(new Event('input',{bubbles:true}))");
  assert.equal(await evaluate("document.querySelector('#signup-submit').disabled"),true);
  await click('#signup-send-code');
  await wait("document.querySelector('#signup-verification-message').textContent.includes('잠시 후')");
  // Advance the server resend fixture and the UI clock; no actual 60-second wait.
  db.sqlite.exec('UPDATE email_verifications SET resend_available_at = 0');
  await evaluate("window.__realDateNow=Date.now;Date.now=()=>window.__realDateNow()+61000");
  await wait("!document.querySelector('#signup-send-code').disabled");
  await click('#signup-send-code');
  await wait("!document.querySelector('#signup-code-area').hidden");
  assert.equal(sentCodes.length,2);
  await evaluate(`document.querySelector('#signup-code').value=${JSON.stringify(sentCodes[1].code)}`);
  await click('#signup-verify-code');
  await wait("!document.querySelector('#signup-submit').disabled");
  await evaluate("document.querySelector('#signup-form').requestSubmit()");
  await wait("location.hash === '#login'");
  assert.equal(await evaluate('window.__signupCalls'),1);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM users WHERE email='ui@example.com'").get().n,1);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.auth-password-conditions li')].map(e=>e.textContent)"),['○ 8자 이상','○ 영문 포함','○ 숫자 포함']);
  const fixture={email:'browser@example.com',password:'browser fixture password1',name:'검증 사용자',companyName:'검증 회사',departmentName:'검증 부서',position:'담당자'};
  fixture.emailVerificationProof = await seedEmailProof(db, fixture.email);
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
    await evaluate(`[...document.querySelectorAll('#my-content button')].find(b=>b.textContent==='+ 새 설문 만들기').click()`);assert.equal(await evaluate(`location.hash`),'#risk-survey-create');
    await click('.logo');assert.equal(await evaluate(`document.querySelector('#home').hidden`),false);await wait(`document.querySelectorAll('#home-daily-quiz label').length===4`);assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,`quiz overflow ${width}`);
    if(width<=900)await click('.menu-button');await click('#msds-menu-button');assert.equal(await evaluate(`document.querySelector('#msds-menu').hidden`),false);
    await click('[data-view-link="risk-assessment"]');assert.equal(await evaluate(`document.querySelector('#risk-assessment').hidden`),false);
  }
  // Home system overview: preserve the portal foreground and verify 1/2/3 navigation and responsive visuals.
  for(const width of [1920,1440,1024,768,390]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await cdp('Page.navigate',{url:base+'/'});
    await wait(`document.querySelectorAll('.hsso-system-card').length===3 && !document.querySelector('#home').hidden`);
    await wait(`document.querySelectorAll('#home-daily-quiz label').length===4`);
    const firstPage=await evaluate(`(()=>{
      const scene=document.querySelector('.hsso-ambient-scene'),shell=document.querySelector('.portal-screen-primary > .portal-shell');
      return {page:document.querySelector('#home').dataset.portalPage,indicator:document.querySelector('#portal-page-indicator').textContent,
        foreground:[document.querySelector('.portal-brand'),document.querySelector('.portal-floating-notice'),document.querySelector('.portal-recent'),document.querySelector('.portal-quiz')].every(node=>node.getBoundingClientRect().width>0),
        backgroundSafe:getComputedStyle(scene).position==='absolute'&&getComputedStyle(scene).pointerEvents==='none'&&Number(getComputedStyle(shell).zIndex)>Number(getComputedStyle(scene).zIndex),
        ambientAnimated:getComputedStyle(scene).animationName==='hsso-ambient-gradient',
        constellation:{stars:document.querySelectorAll('.hsso-constellation-stars circle').length,lines:document.querySelectorAll('.hsso-constellation-lines path').length,antares:!!document.querySelector('.hsso-antares'),entrance:getComputedStyle(document.querySelector('.hsso-constellation-stars circle')).animationName.includes('hsso-constellation-enter')},
        shootingStars:[...document.querySelectorAll('.hsso-shooting-star')].every(star=>getComputedStyle(star).display!=='none'&&getComputedStyle(star).animationName.includes('hsso-shooting-star'))};
    })()`);
    assert.equal(firstPage.foreground,true,`existing home foreground ${width}`);
    assert.equal(firstPage.backgroundSafe,true,`ambient layering ${width}`);
    assert.equal(firstPage.ambientAnimated,true,`ambient animation ${width}`);
    assert.deepEqual(firstPage.constellation,{stars:15,lines:9,antares:true,entrance:true},`Scorpius constellation ${width}`);
    assert.equal(firstPage.shootingStars,width>700,`occasional shooting stars ${width}`);
    if(width>=1001){assert.equal(firstPage.page,'0');assert.equal(firstPage.indicator,'1 / 3');}
    await click('.main-nav [data-home-section="systems"]');
    await wait(width>=1001?`document.querySelector('#home').dataset.portalPage==='2' && document.querySelector('#systems').classList.contains('is-active')`:`location.hash==='#systems' && scrollY>0 && document.querySelector('#systems').getBoundingClientRect().bottom>0`);
    const homeLayout=await evaluate(`(()=>{
      const grid=document.querySelector('.hsso-systems-grid');
      const cards=[...document.querySelectorAll('.hsso-system-card')];
      return {
        columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        systemVisible:getComputedStyle(document.querySelector('.hsso-systems')).visibility!=='hidden',
        existing:[document.querySelector('.portal-brand'),document.querySelector('.portal-floating-notice'),document.querySelector('.portal-recent'),document.querySelector('.portal-quiz')].every(Boolean),
        noOverflow:document.documentElement.scrollWidth<=innerWidth && cards.every(card=>card.scrollWidth<=card.clientWidth),
        descriptionsVisible:cards.every(card=>card.querySelector('.hsso-system-description').getBoundingClientRect().height>0),
        links:[...document.querySelectorAll('.hsso-system-features a')].every(link=>link.hash && link.dataset.viewLink),
        visualKinds:!!document.querySelector('.chem-document')&&!!document.querySelector('.chem-analyzer')&&document.querySelectorAll('.chem-results span').length===5&&document.querySelectorAll('.risk-participants > span').length===3&&!!document.querySelector('.risk-survey-panel')&&document.querySelectorAll('.health-task-list > div').length>=4,
        narrativeFlow:[getComputedStyle(document.querySelector('.chem-document')).animationName,getComputedStyle(document.querySelector('.risk-choice i'),'::after').animationName,getComputedStyle(document.querySelector('.health-next-task')).animationName]
      };
    })()`);
    assert.equal(homeLayout.columns,width>=1001?3:width>=701?2:1,`system columns ${width}`);
    assert.equal(homeLayout.systemVisible,true,`system section visible ${width}`);
    assert.equal(homeLayout.existing,true,`existing home content ${width}`);
    assert.equal(homeLayout.noOverflow,true,`system section overflow ${width}`);
    assert.equal(homeLayout.descriptionsVisible,true,`system copy clipped ${width}`);
    assert.equal(homeLayout.links,true,`system links ${width}`);
    assert.equal(homeLayout.visualKinds,true,`system visualization ${width}`);
    assert.deepEqual(homeLayout.narrativeFlow,['chem-document-cycle','risk-option-cycle','health-next-task'],`system narrative animation ${width}`);
    if(width>=1001){
      assert.equal(await evaluate(`document.querySelector('#portal-page-indicator').textContent`),'3 / 3');
      assert.deepEqual(await evaluate(`({up:document.querySelector('#portal-page-up').disabled,down:document.querySelector('#portal-page-down').disabled})`),{up:false,down:true});
      await new Promise(resolve=>setTimeout(resolve,740));await click('#portal-page-up');await wait(`document.querySelector('#home').dataset.portalPage==='1'`);
      assert.equal(await evaluate(`document.querySelector('#portal-page-indicator').textContent`),'2 / 3');
      await new Promise(resolve=>setTimeout(resolve,740));await click('#portal-page-up');await wait(`document.querySelector('#home').dataset.portalPage==='0'`);
      assert.equal(await evaluate(`document.querySelector('#portal-page-up').disabled`),true);
    } else {
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.portal-page-controls')).display`),'none');
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.hsso-ambient-scene')).getPropertyValue('--hsso-parallax-x').trim()`),'0px');
    }
  }
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:base+'/'});await wait(`!document.querySelector('#home').hidden`);
  await new Promise(resolve=>setTimeout(resolve,180));
  if(await evaluate(`matchMedia('(pointer: fine)').matches`)) {
    await evaluate(`window.dispatchEvent(new PointerEvent('pointermove',{clientX:1180,clientY:180}))`);
    await wait(`getComputedStyle(document.querySelector('.hsso-ambient-scene')).getPropertyValue('--hsso-parallax-x').trim()!=='0px'`);
  } else assert.equal(await evaluate(`getComputedStyle(document.querySelector('.hsso-ambient-scene')).getPropertyValue('--hsso-parallax-x').trim()`),'0px');
  await click('#portal-page-down');await wait(`document.querySelector('#home').dataset.portalPage==='1'`);
  assert.equal(await evaluate(`document.querySelector('#portal-page-indicator').textContent`),'2 / 3');
  await new Promise(resolve=>setTimeout(resolve,740));await click('#portal-page-down');await wait(`document.querySelector('#home').dataset.portalPage==='2'`);
  assert.equal(await evaluate(`document.querySelector('#portal-page-down').disabled`),true);
  await cdp('Page.navigate',{url:base+'/'});await wait(`document.querySelector('#home').dataset.portalPage==='0'`);await new Promise(resolve=>setTimeout(resolve,180));
  await click('.main-nav [data-home-section="systems"]');await wait(`document.querySelector('#home').dataset.portalPage==='2'`);
  assert.equal(await evaluate(`location.hash`),'#systems');
  await evaluate(`history.back()`);await wait(`location.hash==='' && document.querySelector('#home').dataset.portalPage==='0'`);
  await new Promise(resolve=>setTimeout(resolve,740));await evaluate(`history.forward()`);await wait(`location.hash==='#systems' && document.querySelector('#home').dataset.portalPage==='2'`);
  await evaluate(`document.querySelector('.hsso-system-features a').focus()`);
  assert.equal(await evaluate(`document.activeElement.matches('.hsso-system-features a')`),true);
  assert.equal(await evaluate(`[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules]).some(rule=>rule.selectorText==='.hsso-system-card:hover' && rule.style.transform.includes('translateY'))`),true);
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.hsso-system-card')).transitionDuration`),'0s');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.hsso-system-card')).transform`),'none');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.hsso-ambient-scene')).animationName`),'none');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.hsso-constellation-stars circle')).animationName`),'none');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.hsso-shooting-star')).display`),'none');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.chem-results span')).animationName`),'none');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.chem-results span')).opacity`),'1');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.risk-survey-panel > em')).opacity`),'1');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.health-next-task')).opacity`),'1');
  await cdp('Emulation.setEmulatedMedia',{features:[]});
  await click('[data-view-link="maker"]');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.hsso-systems')).display`),'none');
  // Profile save/cancel and read-only fields, then MSDS menu styles and interaction.
  for(const width of [1440,390]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await cdp('Page.navigate',{url:base+'/#mypage'});await ready();
    await click('[data-my-section="profile"]');await ready();
    assert.equal(await evaluate("document.querySelector('#my-content').textContent.includes('일반 회원')"),true);
    const beforeProfile=db.sqlite.prepare('SELECT name, company_name, department_name, position FROM users WHERE email=?').get(fixture.email);
    await click('#my-profile-edit');
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.my-profile-form input')].map(e=>e.name)"),['name','companyName','departmentName','position']);
    assert.equal(await evaluate("document.querySelector('.my-profile-form').textContent.includes('browser@example.com') && document.querySelector('.my-profile-form').textContent.includes('일반 회원')"),true);
    await evaluate("document.querySelectorAll('.my-profile-form input').forEach(input=>{input.value='취소할 정보'})");
    await click('#my-profile-cancel');
    assert.deepEqual(db.sqlite.prepare('SELECT name, company_name, department_name, position FROM users WHERE email=?').get(fixture.email),beforeProfile);
    await click('#my-profile-edit');
    await evaluate("document.querySelector('#my-profile-name').value=' ';document.querySelector('.my-profile-form').requestSubmit()");
    assert.equal(await evaluate("document.querySelector('#my-profile-error').textContent"),'이름은 1~50자로 입력해주세요.');
    const changed='수정 사용자 '+width;
    const changedProfile={name:changed,companyName:'수정 회사 '+width,departmentName:'수정 부서 '+width,position:'수정 직급 '+width};
    await evaluate(`for(const [key,value] of Object.entries(${JSON.stringify(changedProfile)}))document.querySelector('.my-profile-form').elements[key].value='  '+value+'  '`);
    for(const [field,value,message] of [['companyName',' ','회사명은 1~100자로 입력해주세요.'],['departmentName','가'.repeat(101),'부서명은 1~100자로 입력해주세요.'],['position','가'.repeat(51),'직급은 1~50자로 입력해주세요.']]) {
      await evaluate(`document.querySelector('.my-profile-form').elements[${JSON.stringify(field)}].value=${JSON.stringify(value)};document.querySelector('.my-profile-form').requestSubmit()`);
      assert.equal(await evaluate("document.querySelector('#my-profile-error').textContent"),message);
      await evaluate(`document.querySelector('.my-profile-form').elements[${JSON.stringify(field)}].value=${JSON.stringify('  '+changedProfile[field]+'  ')}`);
    }
    await evaluate("document.querySelector('.my-profile-form').requestSubmit()");
    await wait("document.querySelector('#my-status').textContent==='정보를 저장했습니다.'");
    assert.equal(await evaluate(`document.querySelector('#my-content').textContent.includes(${JSON.stringify(changed)})`),true);
    assert.equal(db.sqlite.prepare('SELECT name FROM users WHERE email=?').get(fixture.email).name,changed);
    const savedProfile=db.sqlite.prepare('SELECT name, company_name, department_name, position FROM users WHERE email=?').get(fixture.email);
    assert.deepEqual(Object.values(savedProfile),Object.values(changedProfile));
    for(const value of Object.values(changedProfile))assert.equal(await evaluate(`document.querySelector('#my-content').textContent.includes(${JSON.stringify(value)})`),true);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await click('[data-my-section="dashboard"]');await ready();
    assert.equal(await evaluate(`document.querySelector('#my-content h1').textContent.includes(${JSON.stringify(changed)})`),true);
    await click('.logo');
    if(width<=700) {
      // Mobile home intentionally uses the portal drawer instead of the dropdown.
      await click('#portal-menu-button');await wait("!document.querySelector('#portal-menu').hidden");
      assert.equal(await evaluate("document.querySelector('#portal-menu [data-view-link=chemicals]').textContent"),'MSDS 관리');
      assert.notEqual(await evaluate("getComputedStyle(document.querySelector('#portal-menu [data-view-link=maker]')).color"),'rgb(154, 166, 177)');
      await click('#portal-menu [data-view-link="maker"]');
      assert.equal(await evaluate('location.hash'),'#maker');
      await click('[data-view-link="risk-assessment"]');
    }
    async function openMsds() {
      if(width<=900 && !await evaluate("document.querySelector('#main-menu').classList.contains('open')"))await click('.menu-button');
      await click('#msds-menu-button');
      await wait("!document.querySelector('#msds-menu').hidden");
    }
    await openMsds();
    const styles=await evaluate("[...document.querySelectorAll('#msds-menu a')].map(e=>({color:getComputedStyle(e).color,cursor:getComputedStyle(e).cursor,disabled:e.disabled===true,text:e.textContent}))");
    assert.equal(styles.length,3);assert.equal(styles[0].color,'rgb(17, 37, 61)');assert.equal(styles[1].color,'rgb(17, 37, 61)');
    assert.equal(styles[2].color,'rgb(17, 37, 61)');assert.equal(styles[2].disabled,false);assert(styles[2].text.includes('MSDS 관리'));
    for(const [selector,color,background] of [['#msds-menu a','rgb(15, 82, 107)','rgb(242, 247, 248)']]) {
      const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      assert.deepEqual(await evaluate(`(()=>{const s=getComputedStyle(document.querySelector(${JSON.stringify(selector)}));return[s.color,s.backgroundColor]})()`),[color,background],JSON.stringify({width,selector,point,hit:await evaluate(`document.elementFromPoint(${point.x},${point.y})?.outerHTML`),hover:await evaluate(`document.querySelector(${JSON.stringify(selector)}).matches(':hover')`)}));
    }
    assert.equal(await evaluate("document.querySelector('#msds-menu').hidden"),false);
    assert.equal(await evaluate("!!document.querySelector('#portal-menu [data-view-link=chemicals]')"),true);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    for(const view of ['maker','process-guide']) {
      if(await evaluate("document.querySelector('#msds-menu').hidden"))await openMsds();
      await click('#msds-menu [data-view-link="'+view+'"]');
      assert.equal(await evaluate('location.hash'),'#'+view);
      assert.equal(await evaluate(`document.getElementById(${JSON.stringify(view)}).hidden`),false);
    }
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
  await click('[data-view-link="mypage"]');await ready();await wait(`document.querySelectorAll('.my-document-row').length===2`);
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
  // Wait for the asynchronous close event before reopening the same dialog.
  await evaluate("window.__deleteDialogClosed=false;document.querySelector('#my-delete-dialog').addEventListener('close',()=>{window.__deleteDialogClosed=true},{once:true})");
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait(`window.__deleteDialogClosed && !document.querySelector('#my-delete-dialog').open`);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM saved_documents').get().n,2);
  await evaluate(`[...document.querySelectorAll('.my-document-row button')].find(b=>b.textContent==='삭제').click()`);await click('#my-delete-confirm');await wait(`!document.querySelector('#my-delete-dialog').open`);await ready();assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM saved_documents').get().n,1);
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
