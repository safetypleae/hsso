import { mountRiskStatistics } from './assets/risk/statistics.js';
import { createSurveyQrButton } from './assets/risk/qr.js';
import { mountSurveyEditor } from './assets/risk/builder.js';
import { appendResponseExtras, confirmSurveyDeletion } from './assets/risk/response-details.js';
import { mountRiskReviews } from './assets/risk/reviews.js';
import { mountRiskImprovements } from './assets/risk/improvements.js';

const TYPES = { warning_label: '경고표지', process_guide: '작업공정별 관리요령' };
const $ = selector => document.querySelector(selector);
const el = (tag, text, className = '') => Object.assign(document.createElement(tag), { textContent: text, className });
const date = value => new Date(value).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

export function initMyPage(navigate, readWarning, readProcess, mountPreview) {
  const root = $('#mypage'); const content = $('#my-content'); const status = $('#my-status');
  let generation = 0; let current = 'dashboard'; let user; let role; let offset = 0; let riskReviewAvailable = false;
  let filters = { type: '', period: '90', q: '' };
  const latestInviteLinks = new Map();
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
      const actions=el('div','','my-actions'); actions.append(copyButton(survey.publicToken),createSurveyQrButton(survey),button('관리',()=>riskDetail(survey.id)),button('통계 보기',()=>riskStatistics(survey.id))); if(riskReviewAvailable)actions.append(button('관리자 검토',()=>riskReviews(survey.id))); row.append(name,meta,actions); list.append(row); }
    return list;
  }
  async function riskWorkspace(data) {
    heading('위험성평가','설문 진행 상태와 근로자 응답을 관리합니다.');
    const actions=el('div','','my-actions'); const create=button('+ 새 설문 만들기',()=>navigate('risk-survey-create')); create.className='primary-button'; actions.append(create); content.append(actions,riskSummary(data));
    if(data.surveys.length) content.append(riskRows(data.surveys)); else { const empty=el('section','','my-empty'); empty.append(el('h2','아직 저장된 위험성평가가 없습니다.'),el('p','새 설문을 만들면 공개 링크와 응답 관리 화면이 생성됩니다.')); content.append(empty); }
  }
  function riskStatistics(id) {
    const version = ++generation; clearContent(); status.textContent = '';
    disposePreview = mountRiskStatistics(content, { id, back: () => riskDetail(id), isCurrent: () => version === generation && !root.hidden, loginRequired });
  }
  function riskReviews(id) {
    const version = ++generation; clearContent(); status.textContent = '';
    disposePreview = mountRiskReviews(content, { id, back: () => riskDetail(id), isCurrent: () => version === generation && !root.hidden, loginRequired });
  }
  async function riskDetail(id) {
    const version=++generation; clearContent(); status.textContent='설문을 불러오는 중입니다.';
    try { const [{survey},responseData]=await Promise.all([api('/api/risk-surveys/'+encodeURIComponent(id)),api('/api/risk-surveys/'+encodeURIComponent(id)+'/responses?limit=20&offset=0')]); if(version!==generation||root.hidden)return; status.textContent='';
      content.append(button('← 위험성평가로 돌아가기',()=>{current='risk';load();})); heading(survey.title,`${survey.target} · ${survey.startDate} ~ ${survey.endDate}`);
      const info=el('dl','','my-profile'); for(const [label,value] of [['상태',RISK_STATUS[survey.status]],['안내',survey.guidance],['응답 수',`${survey.responseCount}건`],['공유 링크',publicUrl(survey.publicToken)]]) { info.append(el('dt',label),el('dd',value)); } content.append(info);
      const actions=el('div','','my-actions'); actions.append(copyButton(survey.publicToken)); const toggle=button(survey.isActive?'비활성으로 전환':'활성으로 전환',async()=>{toggle.disabled=true;try{await api('/api/risk-surveys/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({isActive:!survey.isActive})});await riskDetail(id);}catch{toggle.disabled=false;status.textContent='상태를 변경하지 못했습니다.';}}); actions.append(toggle);
      const download=document.createElement('a'); download.className='secondary-button'; download.textContent='응답 다운로드'; download.href=`/api/risk-surveys/${encodeURIComponent(id)}/responses.csv`; actions.append(download); content.append(actions,el('h2','응답 목록'));
      actions.append(button('통계 보기',()=>riskStatistics(id)));
      if(riskReviewAvailable)actions.append(button('관리자 검토',()=>riskReviews(id)));
      actions.append(createSurveyQrButton(survey));
      actions.append(button('설문 수정',()=>{const version=++generation;clearContent();status.textContent='';disposePreview=mountSurveyEditor(content,{survey,back:()=>riskDetail(id),saved:()=>riskDetail(id),loginRequired,isCurrent:()=>version===generation&&!root.hidden});}));
      actions.append(button('설문 삭제',()=>confirmSurveyDeletion(survey,{deleted:()=>{current='risk';load();},loginRequired})));
      renderResponses(id,responseData,0);
    } catch(error){fail(error,version);}
  }
  function renderResponses(surveyId,data,responseOffset) {
    if(!data.responses.length){content.append(el('p','아직 제출된 응답이 없습니다.','my-empty'));return;}
    const list=el('div','','my-document-list'); for(const response of data.responses){const row=el('article','','my-document-row my-risk-row'),name=el('div','','my-document-name');name.append(el('span',date(response.submittedAt),'my-secondary'),el('h3',response.isAnonymous?'익명':(response.respondentName||'이름 없음')),el('p',response.isAnonymous?'개인정보 비공개':[response.department,response.employeeId].filter(Boolean).join(' · '),'my-secondary'));const meta=el('div','','my-document-meta');meta.append(el('span',`위험요인 ${response.hasHazard?'있음':'없음'}`));if(response.hasHazard)meta.append(el('span',`${response.hazardTypes.join(', ')} · ${response.preRiskScore} → ${response.postRiskScore}`));const actions=el('div','','my-actions');actions.append(button('상세',()=>riskResponseDetail(surveyId,response.id)));row.append(name,meta,actions);list.append(row);}content.append(list);
    const pages=el('div','','my-actions');if(responseOffset)pages.append(button('이전',async()=>{const next=Math.max(0,responseOffset-20);renderResponsePage(surveyId,next);}));if(data.hasMore)pages.append(button('다음',()=>renderResponsePage(surveyId,responseOffset+20)));content.append(pages);
  }
  async function renderResponsePage(id,next){await riskDetail(id); if(next){const data=await api(`/api/risk-surveys/${encodeURIComponent(id)}/responses?limit=20&offset=${next}`); const list=content.querySelector('.my-document-list:last-of-type');list?.nextElementSibling?.remove();list?.remove();renderResponses(id,data,next);}}
  async function riskResponseDetail(surveyId,responseId){const version=++generation;clearContent();status.textContent='응답을 불러오는 중입니다.';try{const {response}=await api(`/api/risk-surveys/${encodeURIComponent(surveyId)}/responses/${encodeURIComponent(responseId)}`);if(version!==generation||root.hidden)return;status.textContent='';content.append(button('← 설문 상세로 돌아가기',()=>riskDetail(surveyId)));heading('응답 상세',`제출일 ${date(response.submittedAt)}`);const fields=[['이름',response.isAnonymous?'익명':response.respondentName],['부서',response.isAnonymous?null:response.department],['사번',response.isAnonymous?null:response.employeeId],['위험요인 여부',response.hasHazard?'있음':'없음'],['위험유형',response.hazardTypes.join(', ')],['위험상황',response.hazardDescription],['작업장소',response.location],['개선 전 위험성',response.preRiskScore==null?null:`발생가능성 ${response.preLikelihood} × 중대성 ${response.preSeverity} = ${response.preRiskScore}`],['개선의견',response.improvementSuggestion],['개선 후 예상 위험성',response.postRiskScore==null?null:`발생가능성 ${response.postLikelihood} × 중대성 ${response.postSeverity} = ${response.postRiskScore}`],['안전 사유',response.safeReason]];const info=el('dl','','my-profile my-response-detail');for(const [label,value] of fields.filter(([,value])=>value!==null&&value!=='')){info.append(el('dt',label),el('dd',value));}content.append(info);appendResponseExtras(content,surveyId,response);}catch(error){fail(error,version);}}
  function renderProfile(editing = false, notice = '') {
    const version = ++generation;
    clearContent(); status.textContent = notice;
    heading('내 정보', editing ? '이름, 회사명, 부서명, 직급을 수정할 수 있습니다. 이메일과 관리자 여부는 변경할 수 없습니다.' : '현재 등록된 회원정보입니다.');
    const form = el('form', '', 'my-profile-form'); form.noValidate = true;
    const fields = el('dl', '', 'my-profile');
    const limits = { name: 50, companyName: 100, departmentName: 100, position: 50 };
    const inputs = {};
    for (const [key, label] of Object.entries({ name: '이름', email: '이메일', companyName: '회사명', departmentName: '부서명', position: '직급' })) {
      const term = el('dt', label), value = el('dd', user[key] || '—');
      if (Object.hasOwn(limits, key) && editing) {
        const input = document.createElement('input');
        input.id = `my-profile-${key}`; input.name = key; input.value = user[key] || ''; input.required = true;
        input.autocomplete = { name: 'name', companyName: 'organization', departmentName: 'off', position: 'organization-title' }[key];
        input.setAttribute('aria-describedby', 'my-profile-error');
        inputs[key] = { input, label };
        const labelNode = el('label', label); labelNode.htmlFor = input.id;
        term.replaceChildren(labelNode); value.replaceChildren(input);
      }
      fields.append(term, value);
    }
    fields.append(el('dt', '관리자 여부'), el('dd', role === 'admin' ? '관리자' : '일반 회원'));
    form.append(fields);
    const actions = el('div', '', 'my-actions');
    if (!editing) {
      const edit = button('정보 수정', () => renderProfile(true)); edit.id = 'my-profile-edit';
      actions.append(edit); form.append(actions); content.append(form); return;
    }
    const error = el('p', '', 'my-profile-error'); error.id = 'my-profile-error'; error.setAttribute('role', 'alert');
    const save = el('button', '저장', 'primary-button'); save.type = 'submit'; save.id = 'my-profile-save';
    const cancel = button('취소', () => { renderProfile(); $('#my-profile-edit').focus(); }); cancel.id = 'my-profile-cancel';
    actions.append(save, cancel); form.append(error, actions); content.append(form); inputs.name.input.focus();
    for (const { input } of Object.values(inputs)) input.addEventListener('input', () => { error.textContent = ''; input.removeAttribute('aria-invalid'); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (save.disabled) return;
      const values = {};
      for (const [key, { input, label }] of Object.entries(inputs)) {
        values[key] = input.value.trim();
        if (!values[key] || Array.from(values[key]).length > limits[key]) {
          error.textContent = `${label}은 1~${limits[key]}자로 입력해주세요.`; input.setAttribute('aria-invalid', 'true'); input.focus(); return;
        }
      }
      save.disabled = cancel.disabled = true;
      for (const { input } of Object.values(inputs)) input.disabled = true;
      save.textContent = '저장 중...'; error.textContent = '';
      form.setAttribute('aria-busy', 'true');
      try {
        const result = await api('/api/auth/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
        if (version !== generation || root.hidden) return;
        user = result.user;
        renderProfile(false, '정보를 저장했습니다.');
      } catch (failure) {
        if (version !== generation || root.hidden) return;
        if (failure.status === 401) { loginRequired('정보를 수정하려면 다시 로그인해주세요.'); return; }
        error.textContent = failure.status === 400 ? '입력한 회원정보와 각 항목의 길이를 확인해주세요.' : '정보를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.';
      } finally {
        if (version === generation && !root.hidden) {
          save.disabled = cancel.disabled = false;
          for (const { input } of Object.values(inputs)) input.disabled = false;
          save.textContent = '저장'; form.removeAttribute('aria-busy');
        }
      }
    });
  }
  const APPLICATION_STATUS = { pending: '승인 대기', approved: '승인', rejected: '반려' };
  const COMPANY_STATUS = { active: '활성', suspended: '정지', archived: '종료' };
  function formField(form, name, label, value = '', options = {}) {
    const wrap = el('label', label), input = options.textarea ? document.createElement('textarea') : document.createElement('input');
    input.name = name; input.value = value; input.maxLength = options.maxLength || 100; input.required = options.required !== false;
    if (options.textarea) input.rows = options.rows || 4;
    wrap.append(input); form.append(wrap); return input;
  }
  async function renderCompanyWorkspace() {
    const version = ++generation; clearContent(); status.textContent = '회사·권한 정보를 불러오는 중입니다.';
    try {
      const inviteToken = new URLSearchParams(location.search).get('companyInvite');
      const [applicationData, companyData, permissionData, operatorData, receivedInvite] = await Promise.all([
        api('/api/company-admin-applications'), api('/api/companies'), api('/api/company-permissions'), role === 'admin' ? api('/api/admin/company-admin-applications?limit=100') : Promise.resolve(null),
        inviteToken ? api('/api/company-invitations/' + encodeURIComponent(inviteToken)).catch(error => ({ error })) : Promise.resolve(null)
      ]);
      if (version !== generation || root.hidden) return;
      status.textContent = ''; heading('회사·권한 관리', '회사 관리자 신청과 연결된 회사 워크스페이스를 관리합니다.');
      if (inviteToken) {
        const received = el('section', '', 'my-company-section'); received.append(el('h2', '받은 담당자 초대'));
        if (receivedInvite?.error) {
          received.append(el('p', receivedInvite.error.status === 403 ? '현재 로그인한 이메일과 초대 이메일이 일치하지 않습니다.' : receivedInvite.error.status === 409 ? '만료되었거나 더 이상 사용할 수 없는 초대입니다.' : '초대 정보를 확인할 수 없습니다.', 'my-profile-error'));
        } else if (receivedInvite?.invitation) {
          const item = receivedInvite.invitation;
          received.append(el('p', `${item.companyName} · ${item.departmentName}`), el('p', `업무 권한: MSDS 관리 · 상태: ${item.status === 'pending' ? '수락 가능' : item.status}`, 'my-secondary'));
          if (item.status === 'pending') {
            const accept = el('button', '초대 수락', 'primary-button'); accept.type = 'button';
            accept.addEventListener('click', async () => { accept.disabled = true; try { await api('/api/company-invitations/' + encodeURIComponent(inviteToken), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const url = new URL(location.href); url.searchParams.delete('companyInvite'); history.replaceState(history.state, '', url); await renderCompanyWorkspace(); } catch (error) { status.textContent = error.status === 403 ? '초대 이메일과 로그인 이메일이 일치하지 않습니다.' : '초대를 수락하지 못했습니다.'; accept.disabled = false; } });
            received.append(accept);
          }
        }
        content.append(received);
      }
      const applicationSection = el('section', '', 'my-company-section'); applicationSection.append(el('h2', '최초 회사 관리자 신청'));
      if (applicationData.applications.length) {
        const list = el('div');
        for (const item of applicationData.applications) {
          const card = el('article', '', 'my-application-card');
          card.append(el('h3', item.companyName), el('p', `${item.departmentName} · ${item.positionTitle} · ${APPLICATION_STATUS[item.status]}`, 'my-secondary'), el('p', item.reason));
          if (item.additionalInfo) card.append(el('p', `추가 확인정보: ${item.additionalInfo}`, 'my-secondary'));
          if (item.reviewNote) card.append(el('p', `처리 의견: ${item.reviewNote}`, 'my-secondary'));
          list.append(card);
        }
        applicationSection.append(list);
      }
      const applicationForm = el('form', '', 'my-company-form');
      const companyName = formField(applicationForm, 'companyName', '회사명', user.companyName || '', { maxLength: 100 });
      const departmentName = formField(applicationForm, 'departmentName', '부서명', user.departmentName || '', { maxLength: 100 });
      const positionTitle = formField(applicationForm, 'positionTitle', '직책', user.position || '', { maxLength: 50 });
      const reason = formField(applicationForm, 'reason', '신청 사유', '', { textarea: true, maxLength: 2000 });
      const additionalInfo = formField(applicationForm, 'additionalInfo', '추가 확인정보 (선택)', '', { textarea: true, maxLength: 2000, required: false, rows: 3 });
      const applyMessage = el('p', '', 'my-workspace-message'); applyMessage.setAttribute('role', 'status');
      const apply = el('button', '신청하기', 'primary-button'); apply.type = 'submit'; applicationForm.append(applyMessage, apply);
      applicationForm.addEventListener('submit', async event => {
        event.preventDefault(); apply.disabled = true; applyMessage.textContent = '';
        try { await api('/api/company-admin-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyName: companyName.value, departmentName: departmentName.value, positionTitle: positionTitle.value, reason: reason.value, additionalInfo: additionalInfo.value }) }); await renderCompanyWorkspace(); }
        catch (error) { applyMessage.textContent = error.status === 409 ? '동일한 회사에 승인 대기 중인 신청이 있습니다.' : '신청을 저장하지 못했습니다.'; apply.disabled = false; }
      });
      applicationSection.append(applicationForm); content.append(applicationSection);

      const connected = el('section', '', 'my-company-section'); connected.append(el('h2', '연결된 회사'));
      if (!companyData.companies.length) connected.append(el('p', '연결된 회사 워크스페이스가 없습니다.', 'my-secondary'));
      for (const company of companyData.companies) {
        const card = el('article', '', 'my-company-card'); card.append(el('h2', company.name), el('p', `내 권한: ${company.role === 'company_admin' ? '회사 관리자' : '구성원'} · 회사 상태: ${COMPANY_STATUS[company.status] || company.status}`, 'my-secondary'));
        const mine = permissionData.permissions.filter(permission => permission.companyId === company.id && permission.status === 'active');
        if (company.role !== 'company_admin' && mine.length) {
          const assignments = el('div', '', 'my-company-section'); assignments.append(el('h3', '내 담당 업무'));
          for (const permission of mine) assignments.append(el('p', `${permission.departmentName} · MSDS 관리 · 활성`));
          card.append(assignments);
        }
        if (company.role === 'company_admin' && company.membershipStatus === 'active') {
          const [departmentData, invitationData, memberData] = await Promise.all([
            api(`/api/companies/${encodeURIComponent(company.id)}/departments`),
            api(`/api/companies/${encodeURIComponent(company.id)}/invitations`),
            api(`/api/companies/${encodeURIComponent(company.id)}/members`)
          ]);
          if (version !== generation || root.hidden) return;
          const list = el('div'); list.append(el('h3', '부서 목록'));
          for (const department of departmentData.departments) {
            const row = el('form', '', 'my-department-row'), name = document.createElement('input'), state = document.createElement('select');
            name.name = 'name'; name.value = department.name; name.maxLength = 100; name.required = true; name.setAttribute('aria-label', '부서명');
            for (const [value, label] of [['active', '활성'], ['inactive', '비활성']]) { const option = el('option', label); option.value = value; state.append(option); }
            state.value = department.status; state.setAttribute('aria-label', '부서 상태');
            const save = el('button', '저장', 'secondary-button'); save.type = 'submit';
            row.append(name, state, save); row.addEventListener('submit', async event => { event.preventDefault(); save.disabled = true; try { await api(`/api/companies/${encodeURIComponent(company.id)}/departments/${encodeURIComponent(department.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.value, status: state.value }) }); await renderCompanyWorkspace(); } catch (error) { status.textContent = error.status === 409 ? '같은 이름의 부서가 이미 있습니다.' : '부서를 수정하지 못했습니다.'; save.disabled = false; } });
            list.append(row);
          }
          const add = el('form', '', 'my-company-form'), addName = formField(add, 'name', '새 부서명', '', { maxLength: 100 }), addButton = el('button', '부서 추가', 'primary-button'); addButton.type = 'submit'; add.append(addButton);
          add.addEventListener('submit', async event => { event.preventDefault(); addButton.disabled = true; try { await api(`/api/companies/${encodeURIComponent(company.id)}/departments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: addName.value }) }); await renderCompanyWorkspace(); } catch (error) { status.textContent = error.status === 409 ? '같은 이름의 부서가 이미 있습니다.' : '부서를 추가하지 못했습니다.'; addButton.disabled = false; } });
          card.append(list, add);

          const membersSection = el('section', '', 'my-company-section'); membersSection.append(el('h3', '회사 구성원'));
          for (const member of memberData.members) {
            const memberCard = el('article', '', 'my-application-card');
            memberCard.append(el('h3', `${member.name} · ${member.email}`), el('p', `${member.role === 'company_admin' ? '회사 관리자 · 회사 전체 관리' : '부서 담당자'} · ${member.status === 'active' ? '활성' : member.status}`, 'my-secondary'));
            for (const assignment of member.assignments) {
              const row = el('div', '', 'my-department-row'); row.append(el('span', assignment.departmentName), el('span', `MSDS 관리 · ${assignment.status === 'active' ? '활성' : '해제'}`));
              if (assignment.status === 'active') {
                const revoke = el('button', '권한 해제', 'secondary-button'); revoke.type = 'button';
                revoke.addEventListener('click', async () => { revoke.disabled = true; try { await api(`/api/companies/${encodeURIComponent(company.id)}/permissions/${encodeURIComponent(assignment.id)}`, { method: 'DELETE' }); await renderCompanyWorkspace(); } catch { status.textContent = '업무 권한을 해제하지 못했습니다.'; revoke.disabled = false; } });
                row.append(revoke);
              }
              memberCard.append(row);
            }
            membersSection.append(memberCard);
          }
          card.append(membersSection);

          const inviteSection = el('section', '', 'my-company-section'); inviteSection.append(el('h3', '담당자 초대'));
          const activeDepartments = departmentData.departments.filter(department => department.status === 'active');
          if (activeDepartments.length) {
            const inviteForm = el('form', '', 'my-company-form'), emailLabel = el('label', '초대 이메일'), email = document.createElement('input'), departmentLabel = el('label', '담당 부서'), department = document.createElement('select'), permissionLabel = el('label', '업무 권한'), permission = document.createElement('select');
            email.type = 'email'; email.name = 'email'; email.maxLength = 254; email.required = true; emailLabel.append(email);
            for (const item of activeDepartments) { const option = el('option', item.name); option.value = item.id; department.append(option); } departmentLabel.append(department);
            const permissionOption = el('option', 'MSDS 관리'); permissionOption.value = 'msds_manage'; permission.append(permissionOption); permissionLabel.append(permission);
            const inviteMessage = el('div', '', 'my-workspace-message'), submit = el('button', '초대 링크 생성', 'primary-button'); submit.type = 'submit'; inviteForm.append(emailLabel, departmentLabel, permissionLabel, inviteMessage, submit);
            inviteForm.addEventListener('submit', async event => { event.preventDefault(); submit.disabled = true; inviteMessage.replaceChildren(); try { const result = await api(`/api/companies/${encodeURIComponent(company.id)}/invitations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.value, departmentId: department.value, permission: permission.value }) }); latestInviteLinks.set(result.invitation.id, location.origin + result.invitePath); await renderCompanyWorkspace(); } catch (error) { inviteMessage.textContent = error.status === 409 ? '동일한 대기 중 초대가 있거나 이미 회사 전체 권한을 가진 사용자입니다.' : '초대를 생성하지 못했습니다.'; submit.disabled = false; } });
            inviteSection.append(inviteForm);
          }
          inviteSection.append(el('h3', '보낸 초대'));
          if (!invitationData.invitations.length) inviteSection.append(el('p', '보낸 초대가 없습니다.', 'my-secondary'));
          for (const invitation of invitationData.invitations) {
            const inviteCard = el('article', '', 'my-application-card'), label = { pending: '대기', accepted: '수락', revoked: '취소', expired: '만료' }[invitation.status] || invitation.status;
            inviteCard.append(el('h3', invitation.inviteeEmail), el('p', `${invitation.departmentName} · MSDS 관리 · ${label}`, 'my-secondary'), el('p', `생성일 ${date(invitation.createdAt)} · 만료일 ${date(invitation.expiresAt)}`, 'my-secondary'));
            if (invitation.status === 'pending') {
              const actions = el('div', '', 'my-actions'), link = latestInviteLinks.get(invitation.id);
              if (link) { const copy = el('button', '초대 링크 복사', 'secondary-button'); copy.type = 'button'; copy.addEventListener('click', async () => { await navigator.clipboard.writeText(link); copy.textContent = '복사됨'; }); actions.append(copy); }
              const revoke = el('button', '초대 취소', 'secondary-button'); revoke.type = 'button'; revoke.addEventListener('click', async () => { revoke.disabled = true; try { await api(`/api/companies/${encodeURIComponent(company.id)}/invitations/${encodeURIComponent(invitation.id)}`, { method: 'DELETE' }); latestInviteLinks.delete(invitation.id); await renderCompanyWorkspace(); } catch { status.textContent = '초대를 취소하지 못했습니다.'; revoke.disabled = false; } }); actions.append(revoke); inviteCard.append(actions);
            }
            inviteSection.append(inviteCard);
          }
          card.append(inviteSection);
        }
        connected.append(card);
      }
      content.append(connected);

      if (operatorData) {
        const operator = el('section', '', 'my-company-section'); operator.append(el('h2', 'HSSO 운영자 · 회사 관리자 신청 관리'), el('p', `전체 ${operatorData.total}건`, 'my-secondary'));
        for (const item of operatorData.applications) {
          const card = el('article', '', 'my-application-card');
          card.append(el('h3', `${item.companyName} · ${APPLICATION_STATUS[item.status]}`), el('p', `${item.applicantName} (${item.applicantEmail}) · ${item.departmentName} · ${item.positionTitle}`, 'my-secondary'), el('p', `신청 사유: ${item.reason}`));
          if (item.additionalInfo) card.append(el('p', `추가 확인정보: ${item.additionalInfo}`));
          card.append(el('p', `신청일: ${date(item.createdAt)}${item.reviewerName ? ` · 처리자: ${item.reviewerName} · 처리일: ${date(item.reviewedAt)}` : ''}`, 'my-secondary'));
          if (item.reviewNote) card.append(el('p', `처리 의견: ${item.reviewNote}`, 'my-secondary'));
          if (item.status === 'pending') {
            const form = el('form', '', 'my-company-form'), note = formField(form, 'reviewNote', '처리 의견 / 반려 사유', '', { textarea: true, maxLength: 2000, required: false, rows: 3 }), actions = el('div', '', 'my-actions'), approve = el('button', '승인', 'primary-button'), reject = el('button', '반려', 'secondary-button');
            approve.type = reject.type = 'button'; actions.append(approve, reject); form.append(actions);
            approve.addEventListener('click', async () => { approve.disabled = reject.disabled = true; try { await api(`/api/admin/company-admin-applications/${encodeURIComponent(item.id)}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewNote: note.value }) }); await renderCompanyWorkspace(); } catch { status.textContent = '신청을 승인하지 못했습니다.'; approve.disabled = reject.disabled = false; } });
            reject.addEventListener('click', async () => { if (!note.value.trim()) { note.required = true; note.reportValidity(); return; } approve.disabled = reject.disabled = true; try { await api(`/api/admin/company-admin-applications/${encodeURIComponent(item.id)}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewNote: note.value }) }); await renderCompanyWorkspace(); } catch { status.textContent = '신청을 반려하지 못했습니다.'; approve.disabled = reject.disabled = false; } });
            card.append(form);
          }
          operator.append(card);
        }
        content.append(operator);
      }
    } catch (error) {
      if (version !== generation || root.hidden) return;
      if (error.status === 401) { loginRequired('회사·권한 관리를 이용하려면 로그인이 필요합니다.'); return; }
      status.textContent = '회사·권한 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
    }
  }
  async function load() {
    const version = ++generation; clearContent(); status.textContent = '불러오는 중입니다.';
    $('#my-nav').hidden = true;
    try {
      const session = await api('/api/auth/me');
      if (version !== generation || root.hidden) return;
      user = session.user;
      role = session.role;
      $('#my-nav').hidden = false;
      $('#my-nav').querySelectorAll('button').forEach(node=>{
        if (node.dataset.mySection === current) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current');
      });
      if (current === 'profile') {
        renderProfile(); return;
      }
      if (current === 'company') { await renderCompanyWorkspace(); return; }
      if (current === 'risk') { const [data,companies]=await Promise.all([api('/api/risk-surveys'),api('/api/companies').catch(()=>({companies:[]}))]); if(version!==generation||root.hidden)return; riskReviewAvailable=companies.companies.some(company=>company.role==='company_admin'&&company.membershipStatus==='active'&&company.status==='active'); status.textContent=''; await riskWorkspace(data); return; }
      if (current === 'improvements') { status.textContent=''; disposePreview=mountRiskImprovements(content,{back:()=>{current='dashboard';load();},isCurrent:()=>version===generation&&!root.hidden,loginRequired}); return; }
      const params = new URLSearchParams(current === 'dashboard' ? {period:'90',limit:'5'} : {...filters,limit:'20',offset:String(offset)});
      const data = await api('/api/documents?' + params);
      if (version !== generation || root.hidden) return;
      status.textContent = '';
      if (current === 'dashboard') {
        heading(`안녕하세요, ${user.name}님.`,[user.companyName,user.departmentName,user.position].filter(Boolean).join(' · '));
        const summary = el('div','','my-summary');
        for (const [key,label] of Object.entries(TYPES)) { const item = el('section'); item.append(el('h2',label),el('strong',`${data.summary[key]}건`),el('p','최근 90일 저장 문서','my-secondary')); summary.append(item); }
        const [riskData,pointData]=await Promise.all([api('/api/risk-surveys'),api('/api/points').catch(()=>null)]); if(version!==generation||root.hidden)return;
        const risk = el('section'); risk.append(el('h2','위험성평가'),el('strong',`${riskData.summary.active}개 진행 중`),el('p',`전체 응답 ${riskData.summary.responses}건`,'my-secondary')); summary.append(risk); content.append(summary,el('h2','최근 문서'));
        content.append(data.documents.length ? rowList(data.documents,data.serverNow,false) : empty());
        if(pointData){const points=el('section','','my-company-section');points.append(el('h2','안전 포인트'),el('strong',`${pointData.total} P`),el('h3','최근 내역'));if(pointData.entries.length){const list=el('div','','my-document-list');for(const entry of pointData.entries){const row=el('div','','my-document-row');row.append(el('strong',`${entry.amount>0?'+':''}${entry.amount}P`),el('span',entry.reason==='quiz_correct'?'오늘의 안전보건 퀴즈':entry.reason),el('span',date(entry.createdAt),'my-secondary'));list.append(row);}points.append(list);}else points.append(el('p','아직 포인트 내역이 없습니다.','my-secondary'));content.append(points);}
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
  return view=>{++generation;clearContent();$('#my-nav').hidden=true;status.textContent='';if(dialog.open)dialog.close();if(view==='mypage'){current=new URLSearchParams(location.search).has('companyInvite')?'company':'dashboard';offset=0;load();}};
}
