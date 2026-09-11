const TYPES = { warning_label: '경고표지', process_guide: '작업공정별 관리요령' };
const $ = selector => document.querySelector(selector);
const el = (tag, text, className = '') => Object.assign(document.createElement(tag), { textContent: text, className });
const date = value => new Date(value).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

export function initMyPage(navigate, readWarning, readProcess, mountPreview) {
  const root = $('#mypage'); const content = $('#my-content'); const status = $('#my-status');
  let generation = 0; let current = 'dashboard'; let user; let offset = 0;
  let filters = { type: '', period: '90', q: '' };
  let pendingDelete; let opener;
  const dialog = $('#my-delete-dialog');
  let disposePreview = () => {};
  function clearContent() { disposePreview(); disposePreview = () => {}; content.replaceChildren(); }
  function loginRequired(message) {
    navigate('login');
    const target = $('#login-message'); target.textContent = message; target.hidden = false; target.focus();
  }
  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', ...options });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) throw Object.assign(new Error('Request failed'), { status: response.status });
    return body;
  }
  function button(text, action) { const node = el('button', text, 'secondary-button'); node.type = 'button'; node.addEventListener('click', action); return node; }
  function heading(title, description) {
    const titleNode = el('h1', title); titleNode.tabIndex = -1;
    content.append(titleNode, el('p', description, 'my-secondary'));
    titleNode.focus({ preventScroll: true });
  }
  function empty() {
    const box = el('div', '', 'my-empty'); box.append(el('h2','저장된 문서가 없습니다.'), el('p','HSSO에서 경고표지 또는 작업공정별 관리요령을 만든 뒤 내 문서에 저장할 수 있습니다.'));
    const actions = el('div','','my-actions'); actions.append(button('경고표지 만들기',()=>navigate('maker')),button('관리요령 만들기',()=>navigate('process-guide'))); box.append(actions); return box;
  }
  function rowList(documents, serverNow, removable) {
    const list = el('div','','my-document-list');
    for (const doc of documents) {
      const row = el('article','','my-document-row'); const description = el('div','','my-document-name');
      description.append(el('span',TYPES[doc.documentType],'my-secondary'),el('h3',doc.title));
      const meta = el('div','','my-document-meta'); meta.append(el('span',`생성일 ${date(doc.createdAt)}`));
      if (removable) meta.append(el('span',`보관 ${Math.max(0,Math.ceil((Date.parse(doc.expiresAt)-Date.parse(serverNow))/86400000))}일 남음`));
      const actions = el('div','','my-actions'); actions.append(button('보기',()=>detail(doc.id)));
      if (removable) actions.append(button('삭제',event=>{ pendingDelete = doc.id; opener = event.currentTarget; $('#my-delete-title').textContent = doc.title; $('#my-delete-status').textContent = ''; dialog.showModal(); $('#my-delete-cancel').focus(); }));
      row.append(description,meta,actions); list.append(row);
    }
    return list;
  }
  function fail(error, version) {
    if (version !== generation || root.hidden) return;
    clearContent();
    if (error.status === 401) { loginRequired('마이페이지를 이용하려면 로그인이 필요합니다.'); return; }
    status.textContent = '문서를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
    content.append(button('다시 시도',()=>load()));
  }
  const RISK_STATUS = { scheduled:'진행 예정', active:'진행 중', ended:'종료', inactive:'비활성' };
  const publicUrl = token => `${location.origin}/survey/${token}`;
  function copyButton(token) { return button('링크 복사', async event => { await navigator.clipboard.writeText(publicUrl(token)); event.currentTarget.textContent='복사됨'; }); }
  function riskSummary(data) {
    const summary=el('div','','my-summary my-risk-summary');
    for(const [key,label] of [['total','전체 설문'],['active','진행 중'],['ended','종료'],['responses','총 응답 수']]) { const item=el('section'); item.append(el('h2',label),el('strong',String(data.summary[key]))); summary.append(item); }
    return summary;
  }
  function riskRows(surveys) {
    const list=el('div','','my-document-list');
    for(const survey of surveys) { const row=el('article','','my-document-row my-risk-row'), name=el('div','','my-document-name'); name.append(el('span',RISK_STATUS[survey.status]||survey.status,'my-secondary'),el('h3',survey.title),el('p',survey.target,'my-secondary'));
      const meta=el('div','','my-document-meta'); meta.append(el('span',`${survey.startDate} ~ ${survey.endDate}`),el('span',`응답 ${survey.responseCount}건`),el('span',`생성일 ${date(survey.createdAt)}`));
      const actions=el('div','','my-actions'); actions.append(copyButton(survey.publicToken),button('관리',()=>riskDetail(survey.id))); row.append(name,meta,actions); list.append(row); }
    return list;
  }
  async function riskWorkspace(data) {
    heading('위험성평가','설문 진행 상태와 근로자 응답을 관리합니다.');
    const actions=el('div','','my-actions'); const create=button('+ 새 설문 만들기',()=>navigate('risk-survey-create')); create.className='primary-button'; actions.append(create); content.append(actions,riskSummary(data));
    if(data.surveys.length) content.append(riskRows(data.surveys)); else { const empty=el('section','','my-empty'); empty.append(el('h2','아직 저장된 위험성평가가 없습니다.'),el('p','새 설문을 만들면 공개 링크와 응답 관리 화면이 생성됩니다.')); content.append(empty); }
  }
  async function riskDetail(id) {
    const version=++generation; clearContent(); status.textContent='설문을 불러오는 중입니다.';
    try { const [{survey},responseData]=await Promise.all([api('/api/risk-surveys/'+encodeURIComponent(id)),api('/api/risk-surveys/'+encodeURIComponent(id)+'/responses?limit=20&offset=0')]); if(version!==generation||root.hidden)return; status.textContent='';
      content.append(button('← 위험성평가로 돌아가기',()=>{current='risk';load();})); heading(survey.title,`${survey.target} · ${survey.startDate} ~ ${survey.endDate}`);
      const info=el('dl','','my-profile'); for(const [label,value] of [['상태',RISK_STATUS[survey.status]],['안내',survey.guidance],['응답 수',`${survey.responseCount}건`],['공유 링크',publicUrl(survey.publicToken)]]) { info.append(el('dt',label),el('dd',value)); } content.append(info);
      const actions=el('div','','my-actions'); actions.append(copyButton(survey.publicToken)); const toggle=button(survey.isActive?'비활성으로 전환':'활성으로 전환',async()=>{toggle.disabled=true;try{await api('/api/risk-surveys/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({isActive:!survey.isActive})});await riskDetail(id);}catch{toggle.disabled=false;status.textContent='상태를 변경하지 못했습니다.';}}); actions.append(toggle);
      const download=document.createElement('a'); download.className='secondary-button'; download.textContent='응답 다운로드'; download.href=`/api/risk-surveys/${encodeURIComponent(id)}/responses.csv`; actions.append(download); content.append(actions,el('h2','응답 목록'));
      renderResponses(id,responseData,0);
    } catch(error){fail(error,version);}
  }
  function renderResponses(surveyId,data,responseOffset) {
    if(!data.responses.length){content.append(el('p','아직 제출된 응답이 없습니다.','my-empty'));return;}
    const list=el('div','','my-document-list'); for(const response of data.responses){const row=el('article','','my-document-row my-risk-row'),name=el('div','','my-document-name');name.append(el('span',date(response.submittedAt),'my-secondary'),el('h3',response.isAnonymous?'익명':(response.respondentName||'이름 없음')),el('p',response.isAnonymous?'개인정보 비공개':[response.department,response.employeeId].filter(Boolean).join(' · '),'my-secondary'));const meta=el('div','','my-document-meta');meta.append(el('span',`위험요인 ${response.hasHazard?'있음':'없음'}`));if(response.hasHazard)meta.append(el('span',`${response.hazardTypes.join(', ')} · ${response.preRiskScore} → ${response.postRiskScore}`));const actions=el('div','','my-actions');actions.append(button('상세',()=>riskResponseDetail(surveyId,response.id)));row.append(name,meta,actions);list.append(row);}content.append(list);
    const pages=el('div','','my-actions');if(responseOffset)pages.append(button('이전',async()=>{const next=Math.max(0,responseOffset-20);renderResponsePage(surveyId,next);}));if(data.hasMore)pages.append(button('다음',()=>renderResponsePage(surveyId,responseOffset+20)));content.append(pages);
  }
  async function renderResponsePage(id,next){await riskDetail(id); if(next){const data=await api(`/api/risk-surveys/${encodeURIComponent(id)}/responses?limit=20&offset=${next}`); const list=content.querySelector('.my-document-list:last-of-type');list?.nextElementSibling?.remove();list?.remove();renderResponses(id,data,next);}}
  async function riskResponseDetail(surveyId,responseId){const version=++generation;clearContent();status.textContent='응답을 불러오는 중입니다.';try{const {response}=await api(`/api/risk-surveys/${encodeURIComponent(surveyId)}/responses/${encodeURIComponent(responseId)}`);if(version!==generation||root.hidden)return;status.textContent='';content.append(button('← 설문 상세로 돌아가기',()=>riskDetail(surveyId)));heading('응답 상세',`제출일 ${date(response.submittedAt)}`);const fields=[['이름',response.isAnonymous?'익명':response.respondentName],['부서',response.isAnonymous?null:response.department],['사번',response.isAnonymous?null:response.employeeId],['위험요인 여부',response.hasHazard?'있음':'없음'],['위험유형',response.hazardTypes.join(', ')],['위험상황',response.hazardDescription],['작업장소',response.location],['개선 전 위험성',response.preRiskScore==null?null:`발생가능성 ${response.preLikelihood} × 중대성 ${response.preSeverity} = ${response.preRiskScore}`],['개선의견',response.improvementSuggestion],['개선 후 예상 위험성',response.postRiskScore==null?null:`발생가능성 ${response.postLikelihood} × 중대성 ${response.postSeverity} = ${response.postRiskScore}`],['안전 사유',response.safeReason]];const info=el('dl','','my-profile my-response-detail');for(const [label,value] of fields.filter(([,value])=>value!==null&&value!=='')){info.append(el('dt',label),el('dd',value));}content.append(info);}catch(error){fail(error,version);}}
  async function load() {
    const version = ++generation; clearContent(); status.textContent = '불러오는 중입니다.';
    $('#my-nav').hidden = true;
    try {
      const session = await api('/api/auth/me');
      if (version !== generation || root.hidden) return;
      user = session.user;
      $('#my-nav').hidden = false;
      $('#my-nav').querySelectorAll('button').forEach(node=>{
        if (node.dataset.mySection === current) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current');
      });
      if (current === 'profile') {
        heading('내 정보','현재 등록된 회원정보입니다.');
        const fields = el('dl','','my-profile');
        for (const [key,label] of Object.entries({name:'이름',email:'이메일',companyName:'회사명',departmentName:'부서명',position:'직급'})) fields.append(el('dt',label),el('dd',user[key] || '—'));
        content.append(fields); status.textContent = ''; return;
      }
      if (current === 'risk') { const data=await api('/api/risk-surveys'); if(version!==generation||root.hidden)return; status.textContent=''; await riskWorkspace(data); return; }
      const params = new URLSearchParams(current === 'dashboard' ? {period:'90',limit:'5'} : {...filters,limit:'20',offset:String(offset)});
      const data = await api('/api/documents?' + params);
      if (version !== generation || root.hidden) return;
      status.textContent = '';
      if (current === 'dashboard') {
        heading(`안녕하세요, ${user.name}님.`,[user.companyName,user.departmentName,user.position].filter(Boolean).join(' · '));
        const summary = el('div','','my-summary');
        for (const [key,label] of Object.entries(TYPES)) { const item = el('section'); item.append(el('h2',label),el('strong',`${data.summary[key]}건`),el('p','최근 90일 저장 문서','my-secondary')); summary.append(item); }
        const riskData=await api('/api/risk-surveys'); if(version!==generation||root.hidden)return;
        const risk = el('section'); risk.append(el('h2','위험성평가'),el('strong',`${riskData.summary.active}개 진행 중`),el('p',`전체 응답 ${riskData.summary.responses}건`,'my-secondary')); summary.append(risk); content.append(summary,el('h2','최근 문서'));
        content.append(data.documents.length ? rowList(data.documents,data.serverNow,false) : empty());
      } else {
        heading('내 문서','HSSO에서 만든 문서를 최근 3개월(90일) 동안 확인할 수 있습니다.');
        const form = el('form','','my-filters');
        function select(name,label,options) { const wrap = el('label',label); const input = document.createElement('select'); input.name = name; for (const [value,text] of Object.entries(options)) { const opt = el('option',text); opt.value=value; input.append(opt); } input.value=filters[name]; wrap.append(input); form.append(wrap); input.addEventListener('change',()=>{ filters[name]=input.value; offset=0; load(); }); }
        select('type','문서 종류',{'':'전체',...TYPES}); select('period','기간',{'today':'오늘','7':'최근 7일','30':'최근 30일','90':'최근 3개월'});
        const label = el('label','제품명 / 문서명 검색','my-search'); const input = document.createElement('input'); input.type='search'; input.name='q'; input.maxLength=200; input.value=filters.q; label.append(input);
        const submit=el('button','검색','primary-button'); submit.type='submit'; form.append(label,submit);
        form.addEventListener('submit',event=>{event.preventDefault();filters.q=input.value.trim();offset=0;load();}); content.append(form);
        if (data.documents.length) content.append(rowList(data.documents,data.serverNow,true));
        else if (filters.q || filters.type || filters.period !== '90' || offset) content.append(el('p','조건에 맞는 문서가 없습니다.','my-empty'));
        else content.append(empty());
        const pages=el('div','','my-actions'); if(offset) pages.append(button('이전',()=>{offset=Math.max(0,offset-20);load();})); if(data.hasMore) pages.append(button('다음',()=>{offset+=20;load();})); content.append(pages);
      }
    } catch(error) { fail(error,version); }
  }
  async function detail(id) {
    const version=++generation; clearContent();status.textContent='문서를 불러오는 중입니다.';
    try {
      const {document:doc}=await api('/api/documents/'+encodeURIComponent(id));
      if(version!==generation || root.hidden) return;
      status.textContent='';
      content.append(button('← 내 문서로 돌아가기',()=>{current='documents';load();}));
      heading(doc.title,`${TYPES[doc.documentType]} · 저장일 ${date(doc.createdAt)} · 보관 만료일 ${date(doc.expiresAt)}`);
      disposePreview = mountPreview(content, doc);
    } catch(error) { fail(error,version); }
  }
  $('#my-delete-cancel').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',event=>{if($('#my-delete-confirm').disabled)event.preventDefault();});
  dialog.addEventListener('close',()=>{pendingDelete=null;if(opener?.isConnected)opener.focus();});
  $('#my-delete-confirm').addEventListener('click',async()=>{
    const id=pendingDelete;if(!id)return; const version=generation;
    const confirm=$('#my-delete-confirm');confirm.disabled=true;$('#my-delete-cancel').disabled=true;
    try {await api('/api/documents/'+encodeURIComponent(id),{method:'DELETE'});if(version!==generation||root.hidden)return;dialog.close();offset=0;await load();}
    catch(error){if(version!==generation||root.hidden)return;if(error.status===401){dialog.close();loginRequired('마이페이지를 이용하려면 로그인이 필요합니다.');}else $('#my-delete-status').textContent='삭제하지 못했습니다. 잠시 후 다시 시도해주세요.';}
    finally{confirm.disabled=false;$('#my-delete-cancel').disabled=false;}
  });
  $('#my-nav').addEventListener('click',event=>{const target=event.target.closest('[data-my-section]');if(target){current=target.dataset.mySection;offset=0;load();}});
  for(const [id,type,reader] of [['save-warning','warning_label',readWarning],['save-process','process_guide',readProcess]]) {
    const trigger=$('#'+id);const message=$('#'+id+'-status');
    trigger.addEventListener('click',async()=>{
      if(trigger.disabled)return;trigger.disabled=true;message.textContent='저장 중입니다.';
      try {
        await api('/api/auth/me');
        const data=reader();if(!data?.productName?.trim()){message.textContent='제품명이 있는 문서의 Preview를 먼저 완성해주세요.';return;}
        await api('/api/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({documentType:type,title:data.productName,documentData:data})});
        message.textContent='내 문서에 저장되었습니다.';
      }catch(error){if(error.status===401){message.textContent='';loginRequired('문서를 저장하려면 로그인이 필요합니다.');}else message.textContent=error.status===413?'문서가 저장 가능한 크기를 초과했습니다.':'문서를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.';}
      finally{trigger.disabled=false;}
    });
  }
  document.addEventListener('visibilitychange',()=>{if(!root.hidden){if(document.hidden){++generation;clearContent();$('#my-nav').hidden=true;status.textContent='로그인 상태를 확인하고 있습니다.';}else load();}});
  window.addEventListener('pagehide',()=>{++generation;clearContent();$('#my-nav').hidden=true;});
  window.addEventListener('pageshow',event=>{if(event.persisted&&!root.hidden)load();});
  return view=>{++generation;clearContent();$('#my-nav').hidden=true;status.textContent='';if(dialog.open)dialog.close();if(view==='mypage'){current='dashboard';offset=0;load();}};
}
