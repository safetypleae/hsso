import { mountRiskAssessmentWorkspace } from './assessment-items.js';

const STATUS = { UNREVIEWED: '검토 전', ACCEPTED: '채택', HOLD: '보류', REJECTED: '제외' };
const REASONS = {
  ALREADY_REFLECTED: '기존 평가에 이미 반영', IMPROVEMENT_COMPLETED: '과거 개선 완료', DUPLICATE: '중복 의견',
  NOT_A_HAZARD: '위험요인으로 판단하지 않음', OTHER: '기타'
};
const el = (tag, text = '', className = '') => Object.assign(document.createElement(tag), { textContent: text, className });
const koreanDate = value => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', ...options });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) throw Object.assign(new Error(data?.error || 'REQUEST_FAILED'), { status: response.status, code: data?.error });
  return data;
}

function actionButton(text, action, className = 'secondary-button') {
  const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node;
}

export function mountRiskReviews(root, { id, back, isCurrent, loginRequired }) {
  const shell = el('section', '', 'risk-reviews');
  const status = el('p', '검토 의견을 불러오는 중입니다.', 'risk-review-message'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  root.append(shell); let disposed = false, childDispose = () => {}, state = { department: '', reviewStatus: '', q: '', offset: 0 }, data;
  const active = () => !disposed && isCurrent();
  const path = suffix => `/api/risk-surveys/${encodeURIComponent(id)}/reviews${suffix}`;

  function openAssessment(options = {}) {
    childDispose(); shell.replaceChildren();
    childDispose = mountRiskAssessmentWorkspace(shell, { companyId:data.survey.companyId, ...options, back:()=>{childDispose();childDispose=()=>{};load();}, isCurrent:active, loginRequired });
  }

  function header() {
    const backButton = actionButton('← 설문 상세로 돌아가기', back); const title = el('h1', '설문 결과 관리자 검토함'); title.tabIndex = -1;
    shell.append(backButton, title, el('p', '근로자 의견을 채택·보류·제외하고 향후 위험성평가 항목으로 사용할 의견을 선별합니다.', 'my-secondary'), status);
    title.focus({ preventScroll: true });
  }

  async function connectCompany() {
    status.textContent = '검토를 시작할 회사 워크스페이스를 선택해주세요.';
    try {
      const companyData = await request('/api/companies'); if (!active()) return;
      const companies = companyData.companies.filter(company => company.role === 'company_admin' && company.membershipStatus === 'active' && company.status === 'active');
      if (!companies.length) { status.textContent = '활성 상태의 회사 관리자 권한이 있어야 검토함을 사용할 수 있습니다.'; return; }
      const form = el('form', '', 'risk-review-scope'), label = el('label', '회사 워크스페이스');
      const select = document.createElement('select'); select.name = 'companyId';
      for (const company of companies) { const option = el('option', company.name); option.value = company.id; select.append(option); }
      const submit = el('button', '연결 후 검토 시작', 'primary-button'); submit.type = 'submit'; label.append(select); form.append(label, submit);
      form.addEventListener('submit', async event => {
        event.preventDefault(); submit.disabled = true; status.textContent = '설문을 회사에 연결하는 중입니다.';
        try { await request(path('/scope'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId: select.value }) }); if (active()) await load(); }
        catch { if (active()) { status.textContent = '회사 연결에 실패했습니다. 새로고침 후 다시 시도해주세요.'; submit.disabled = false; } }
      });
      shell.append(form);
    } catch (error) { if (active()) status.textContent = error.status === 401 ? (loginRequired('관리자 검토함을 이용하려면 로그인이 필요합니다.'), '') : '회사 권한 정보를 불러오지 못했습니다.'; }
  }

  function summary() {
    const box = el('div', '', 'risk-review-summary');
    for (const [key, label] of [['total','전체 의견'],['unreviewed','검토 전'],['accepted','채택'],['hold','보류'],['rejected','제외']]) {
      const item = el('section'); item.append(el('span', label), el('strong', String(data.summary[key]))); box.append(item);
    }
    return box;
  }

  function filters() {
    const form = el('form', '', 'risk-review-filters');
    const selectField = (labelText, name, options, selected) => {
      const label = el('label', labelText), select = document.createElement('select'); select.name = name;
      for (const [value, text] of options) { const option = el('option', text); option.value = value; select.append(option); } select.value = selected; label.append(select); form.append(label);
    };
    selectField('부서', 'department', [['','전체 부서'], ...data.departments.map(value => [value,value])], state.department);
    selectField('검토 상태', 'reviewStatus', [['','전체 상태'], ...Object.entries(STATUS)], state.reviewStatus);
    const searchLabel = el('label', '의견 검색'), search = document.createElement('input'); search.type = 'search'; search.name = 'q'; search.maxLength = 100; search.value = state.q; search.placeholder = '예: 계단, 미끄럼, 전기'; searchLabel.append(search); form.append(searchLabel);
    const submit = el('button', '검색', 'primary-button'); submit.type = 'submit'; form.append(submit);
    form.addEventListener('submit', event => { event.preventDefault(); const values = new FormData(form); state = { department: values.get('department'), reviewStatus: values.get('reviewStatus'), q: String(values.get('q')).trim(), offset: 0 }; load(); });
    form.querySelectorAll('select').forEach(select => select.addEventListener('change', () => form.requestSubmit()));
    return form;
  }

  async function save(response, reviewStatus, rejectionReason, reviewNote, buttons) {
    buttons.forEach(button => { button.disabled = true; }); status.textContent = '검토 상태를 저장하는 중입니다.';
    try {
      const result = await request(path('/' + encodeURIComponent(response.id)), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewStatus, rejectionReason, reviewNote }) });
      if (!active()) return;
      const before = response.reviewStatus; Object.assign(response, result.review);
      const keys = { UNREVIEWED: 'unreviewed', ACCEPTED: 'accepted', HOLD: 'hold', REJECTED: 'rejected' };
      if (before !== reviewStatus) { data.summary[keys[before]]--; data.summary[keys[reviewStatus]]++; }
      status.textContent = `${STATUS[reviewStatus]} 상태로 저장했습니다.`; renderLoaded();
    } catch (error) {
      if (!active()) return; status.textContent = error.code === 'REVIEW_NOTE_REQUIRED' ? '기타 제외 사유에는 메모를 입력해주세요.' : '검토 상태를 저장하지 못했습니다.';
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function reviewCard(response) {
    const card = el('article', '', `risk-review-card is-${response.reviewStatus.toLowerCase()}`), top = el('div', '', 'risk-review-card-top');
    const badge = el('span', STATUS[response.reviewStatus], 'risk-review-badge');
    top.append(badge, el('span', response.department || '부서 미기재', 'my-secondary'), el('time', koreanDate(response.submittedAt), 'my-secondary')); card.append(top);
    const work = [response.hazardTypes?.join(', '), response.location].filter(Boolean).join(' · ');
    if (work) card.append(el('p', work, 'risk-review-work'));
    if (response.hazardDescription) { const block = el('section', '', 'risk-review-opinion'); block.append(el('h3', '위험요인 / 상황'), el('p', response.hazardDescription)); card.append(block); }
    if (response.improvementSuggestion) { const block = el('section', '', 'risk-review-opinion'); block.append(el('h3', '근로자 개선 의견'), el('p', response.improvementSuggestion)); card.append(block); }
    if (!response.hazardDescription && !response.improvementSuggestion && response.safeReason) { const block = el('section', '', 'risk-review-opinion'); block.append(el('h3', '근로자 의견'), el('p', response.safeReason)); card.append(block); }
    const standard = new Set(['q1','q2','q3','q4','q5','q6','q7','safe_reason']);
    for (const question of response.questionSnapshot || []) {
      const answer = response.answers?.[question.id];
      if (standard.has(question.id) || answer == null || answer === '' || typeof answer === 'object' && !Array.isArray(answer)) continue;
      const block = el('section', '', 'risk-review-opinion'); block.append(el('h3', question.text), el('p', Array.isArray(answer) ? answer.join(', ') : String(answer))); card.append(block);
    }
    if (response.reviewedAt) {
      const detail = [response.rejectionReason ? REASONS[response.rejectionReason] : '', response.reviewNote, `검토 ${koreanDate(response.reviewedAt)}`].filter(Boolean).join(' · ');
      card.append(el('p', detail, 'risk-review-audit'));
    }
    if (response.reviewStatus === 'ACCEPTED') {
      const conversion = el('div','','risk-review-conversion');
      if (response.assessmentItemId) conversion.append(el('strong','평가항목 작성 완료'),actionButton('평가항목 보기/수정',()=>openAssessment({itemId:response.assessmentItemId})));
      else conversion.append(actionButton('평가항목 만들기',()=>openAssessment({source:response}),'primary-button'));
      card.append(conversion);
    }
    const controls = el('div', '', 'risk-review-controls'), buttons = [];
    const accepted = actionButton('채택', () => save(response, 'ACCEPTED', null, '', buttons)); buttons.push(accepted);
    const hold = actionButton('보류', () => showEditor('HOLD')); buttons.push(hold);
    const rejected = actionButton('제외', () => showEditor('REJECTED')); buttons.push(rejected); controls.append(accepted, hold, rejected); card.append(controls);
    const editor = el('form', '', 'risk-review-editor'); editor.hidden = true; card.append(editor);
    function showEditor(kind) {
      editor.replaceChildren(); editor.hidden = false;
      if (kind === 'REJECTED') {
        const label = el('label', '제외 사유'), select = document.createElement('select');
        for (const [value,text] of Object.entries(REASONS)) { const option = el('option', text); option.value = value; select.append(option); }
        select.value = response.rejectionReason || 'ALREADY_REFLECTED'; label.append(select); editor.append(label);
        const noteLabel = el('label', '기타 사유 메모'), note = document.createElement('textarea'); note.maxLength = 2000; note.rows = 2; note.value = response.rejectionReason === 'OTHER' ? response.reviewNote || '' : ''; noteLabel.append(note); noteLabel.hidden = select.value !== 'OTHER'; editor.append(noteLabel);
        select.addEventListener('change', () => { noteLabel.hidden = select.value !== 'OTHER'; if (noteLabel.hidden) note.value = ''; else note.focus(); });
        const saveButton = el('button', '제외 저장', 'primary-button'); saveButton.type = 'submit'; editor.append(saveButton);
        editor.onsubmit = event => { event.preventDefault(); save(response, kind, select.value, select.value === 'OTHER' ? note.value : '', [...buttons, saveButton]); };
        select.focus(); return;
      }
      const noteLabel = el('label', '관리자 메모 (선택)'), note = document.createElement('textarea'); note.maxLength = 2000; note.rows = 2; note.value = response.reviewStatus === 'HOLD' ? response.reviewNote || '' : ''; noteLabel.append(note); editor.append(noteLabel);
      const saveButton = el('button', '보류 저장', 'primary-button'); saveButton.type = 'submit'; editor.append(saveButton);
      editor.onsubmit = event => { event.preventDefault(); save(response, kind, null, note.value, [...buttons, saveButton]); };
      note.focus();
    }
    return card;
  }

  function renderLoaded() {
    if (!active()) return;
    const savedStatus = status.textContent; shell.replaceChildren(); header(); status.textContent = savedStatus || `${data.survey.companyName} 검토함`;
    const assessmentActions=el('div','','my-actions');assessmentActions.append(actionButton('위험성평가표',()=>openAssessment()),actionButton('직접 평가항목 추가',()=>openAssessment({direct:true}),'primary-button'),actionButton('채택 의견만 보기',()=>{state.reviewStatus='ACCEPTED';state.offset=0;load();}));
    shell.append(summary(), assessmentActions, filters());
    let rows = data.responses;
    if (state.reviewStatus) rows = rows.filter(response => response.reviewStatus === state.reviewStatus);
    const list = el('div', '', 'risk-review-list'); rows.forEach(response => list.append(reviewCard(response)));
    shell.append(rows.length ? list : el('p', '조건에 맞는 의견이 없습니다.', 'my-empty'));
    const pages = el('div', '', 'my-actions');
    if (state.offset) pages.append(actionButton('이전', () => { state.offset = Math.max(0, state.offset - data.limit); load(); }));
    if (data.hasMore) pages.append(actionButton('다음', () => { state.offset += data.limit; load(); }));
    if (pages.children.length) shell.append(pages);
  }

  async function load() {
    if (!active()) return; status.textContent = '검토 의견을 불러오는 중입니다.';
    const query = new URLSearchParams({ limit: '50', offset: String(state.offset) });
    if (state.department) query.set('department', state.department); if (state.reviewStatus) query.set('status', state.reviewStatus); if (state.q) query.set('q', state.q);
    try { data = await request(path('?' + query)); if (active()) { status.textContent = ''; renderLoaded(); } }
    catch (error) {
      if (!active()) return;
      if (error.status === 401) { loginRequired('관리자 검토함을 이용하려면 로그인이 필요합니다.'); return; }
      if (error.code === 'REVIEW_SCOPE_REQUIRED') { shell.replaceChildren(); header(); await connectCompany(); return; }
      status.textContent = error.status === 403 ? '회사 관리자만 설문 의견을 검토할 수 있습니다.' : '검토함을 불러오지 못했습니다.';
    }
  }
  header(); load();
  return () => { disposed = true; childDispose(); };
}
