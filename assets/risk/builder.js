import { DEFAULT_QUESTIONS, CUSTOM_TYPES, choiceType } from './schema.js';
const el = (tag, text = '', className = '') => Object.assign(document.createElement(tag), { textContent: text, className });
const button = (text, action) => { const node = el('button', text, 'secondary-button'); node.type = 'button'; node.addEventListener('click', action); return node; };

export function buildSurveyForm(form, survey = {}) {
  form.classList.add('risk-builder'); form.replaceChildren();
  const base = { title: '', target: '', companyName: '', startDate: '', endDate: '', guidance: '현재 작업 중 느끼는 위험요인과 개선 의견을 작성해주세요.', departments: [],
    settings: { collectName: true, collectDepartment: true, collectEmployeeId: false, allowAnonymous: false, allowDuplicates: false, allowEdit: false },
    questions: structuredClone(DEFAULT_QUESTIONS), isActive: true, ...survey };
  const fields = {};
  const info = el('section', '', 'survey-card'); info.append(el('h2', '설문 기본정보'));
  for (const [key, label, id, type] of [['title','설문 제목','survey-title','text'],['companyName','회사명','survey-company','text'],['target','설문 대상','survey-target','text'],['startDate','시작일','survey-start-date','date'],['endDate','종료일','survey-end-date','date'],['guidance','설문 안내문','survey-description','textarea']]) {
    const wrap = el('label', label, 'survey-field'), input = el(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type; input.id = id; input.value = base[key]; input.required = key !== 'guidance'; input.maxLength = key === 'guidance' ? 5000 : key === 'target' ? 300 : 200;
    fields[key] = input; wrap.append(input); info.append(wrap);
  }
  form.append(info);
  let departments = [...base.departments];
  const departmentSection = el('section', '', 'survey-card'), departmentRows = el('div');
  departmentSection.append(el('h2', '부서 목록'), el('p', '근로자는 아래 부서 중에서 선택합니다. 기존 응답의 부서명은 변경하지 않습니다.'), departmentRows);
  function renderDepartments() {
    departmentRows.replaceChildren();
    departments.forEach((name, i) => {
      const row = el('div', '', 'risk-builder-row'), input = el('input'); input.value = name; input.maxLength = 100; input.setAttribute('aria-label', `부서 ${i+1}`); input.dataset.department = String(i);
      input.addEventListener('input', () => departments[i] = input.value);
      row.append(input, button('위로', () => { if(i){[departments[i-1],departments[i]]=[departments[i],departments[i-1]];renderDepartments();} }), button('삭제', () => {departments.splice(i,1);renderDepartments();})); departmentRows.append(row);
    });
  }
  departmentSection.append(button('부서 추가', () => { if(departments.length<100){departments.push('');renderDepartments();departmentRows.lastElementChild.querySelector('input').focus();} })); renderDepartments(); form.append(departmentSection);
  const options = el('section', '', 'survey-card'), checks = {};
  options.append(el('h2', '참여자 정보·설정'), el('p', '익명 응답은 이름·부서·사번을 저장하지 않습니다.'));
  for (const [key, label, suffix] of [['collectName','이름 수집','collect-name'],['collectDepartment','부서 수집','collect-department'],['collectEmployeeId','사번 수집','collect-employee-id'],['allowAnonymous','익명 응답 허용','allow-anonymous'],['allowDuplicates','중복 응답 허용 (사번 기준)','allow-duplicates']]) {
    const labelNode = el('label', label, 'survey-option'), input = el('input'); input.type = 'checkbox'; input.id = 'survey-' + suffix; input.checked = base.settings[key]; checks[key] = input; labelNode.prepend(input); options.append(labelNode);
  }
  const activeLabel = el('label', '설문 활성화', 'survey-option'), active = el('input'); active.type = 'checkbox'; active.id = 'survey-active'; active.checked = base.isActive; activeLabel.prepend(active); options.append(activeLabel); form.append(options);
  let questions = structuredClone(base.questions);
  const questionSection = el('section', '', 'survey-card'), questionRows = el('div');
  questionSection.append(el('h2', '설문 문항'), el('p', '기본 위험성 문항은 전용 계산·조건부 흐름을 유지합니다. 문항을 변경해도 과거 응답은 당시 문항으로 보존됩니다.'), questionRows);
  function renderQuestions() {
    questionRows.replaceChildren();
    questions.forEach((q, i) => {
      const card = el('section', '', 'risk-builder-question'); card.dataset.questionId = q.id;
      const title = el('input'); title.value = q.text; title.maxLength = 500; title.setAttribute('aria-label', `문항 ${i+1} 제목`); title.dataset.field = 'text'; title.addEventListener('input', () => q.text = title.value);
      const description = el('textarea'); description.value = q.description || ''; description.maxLength = 2000; description.placeholder = '설명(선택사항)'; description.setAttribute('aria-label', `문항 ${i+1} 설명(선택사항)`); description.dataset.field = 'description'; description.addEventListener('input', () => q.description = description.value);
      const type = el('select'); type.setAttribute('aria-label', `문항 ${i+1} 유형`); type.dataset.field = 'type';
      if (Object.hasOwn(CUSTOM_TYPES, q.type)) for (const [key, label] of Object.entries(CUSTOM_TYPES)) type.append(new Option(label, key));
      else { const labels={hazard_gate:'객관식',hazard_types:'체크박스',hazard_description:'장문형',hazard_location:'단답형',pre_risk:'위험성 평가',improvement:'장문형',post_risk:'위험성 평가',safe_reason:'객관식'};type.append(new Option(labels[q.type] || '기본 문항', q.type)); type.disabled = true; }
      type.value = q.type; type.addEventListener('change', () => { q.type = type.value; q.options ||= []; if(choiceType(q)&&!q.options.length)q.options=['선택지 1']; renderQuestions(); });
      const requiredLabel = el('label', '필수'), required = el('input'); required.type = 'checkbox'; required.checked = q.required; required.dataset.field = 'required'; required.addEventListener('change', () => q.required = required.checked); requiredLabel.prepend(required);
      const actions = el('div', '', 'risk-builder-row'); actions.append(button('위로', () => {if(i){[questions[i-1],questions[i]]=[questions[i],questions[i-1]];renderQuestions();}}),button('아래로', () => {if(i<questions.length-1){[questions[i+1],questions[i]]=[questions[i],questions[i+1]];renderQuestions();}}),button('문항 삭제', () => {questions.splice(i,1);renderQuestions();}));
      card.append(el('h3', `문항 ${i+1}`), title, description, type, requiredLabel);
      if (choiceType(q)) {
        q.options.forEach((value, n) => { const row=el('div','','risk-builder-row'), input=el('input');input.value=value;input.maxLength=100;input.setAttribute('aria-label',`선택지 ${n+1}`); input.dataset.option=String(n);input.disabled=q.type==='hazard_gate';input.addEventListener('input',()=>q.options[n]=input.value);row.append(input);if(q.type!=='hazard_gate')row.append(button('선택지 삭제',()=>{q.options.splice(n,1);renderQuestions();}));card.append(row); });
        if(q.type!=='hazard_gate')card.append(button('선택지 추가',()=>{if(q.options.length<30){q.options.push('새 선택지');renderQuestions();}}));
      }
      card.append(actions); questionRows.append(card);
    });
  }
  questionSection.append(button('새 문항 추가',()=>{if(questions.length<30){questions.push({id:'c_'+crypto.randomUUID(),type:'single_choice',text:'새 질문',description:'',required:false,options:['선택지 1']});renderQuestions();}}),button('기본 템플릿 복원',()=>{if(confirm('현재 문항 구성을 기본 템플릿으로 바꾸시겠습니까?')){questions=structuredClone(DEFAULT_QUESTIONS);renderQuestions();}})); renderQuestions(); form.append(questionSection);
  return () => ({ schemaVersion: 2, revision: base.revision ?? 0, ...Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value.trim()])),
    settings: Object.fromEntries(Object.entries({ ...base.settings, ...Object.fromEntries(Object.entries(checks).map(([key,input])=>[key,input.checked])) }).filter(([key])=>key!=='allowPhoto')), departments: departments.map(d=>d.trim()).filter(Boolean), questions: structuredClone(questions).filter(q=>q.type!=='photo').map(q=>({...q,text:q.text.trim(),description:(q.description||'').trim(),options:(q.options||[]).map(v=>v.trim())})), isActive: active.checked });
}

export function mountSurveyEditor(container, { survey, back, saved, loginRequired, isCurrent }) {
  const form=el('form','','risk-builder'), heading=el('h1','설문 수정'); container.append(heading,form);
  const read=buildSurveyForm(form,survey), status=el('p');status.setAttribute('role','status');
  const save=el('button','수정 저장','primary-button');save.type='submit';form.append(save,button('취소',back),status);
  let controller;
  form.addEventListener('submit',async event=>{event.preventDefault();if(save.disabled)return;save.disabled=true;controller=new AbortController();
    try {const response=await fetch('/api/risk-surveys/'+encodeURIComponent(survey.id),{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(read()),signal:controller.signal});const result=await response.json();if(!isCurrent())return;if(response.status===401){loginRequired('설문을 수정하려면 다시 로그인해주세요.');return;}if(!response.ok)throw new Error(result.error==='SURVEY_CHANGED'?'다른 곳에서 설문이 변경되었습니다. 다시 열어주세요.':result.error==='MIGRATION_REQUIRED'?'위험성평가 DB 확장 설정이 필요합니다.':'회사명·부서·문항·기간을 확인해주세요.');saved();}catch(error){if(isCurrent()&&error.name!=='AbortError')status.textContent=error.message;}finally{if(isCurrent())save.disabled=false;}
  });
  return ()=>controller?.abort();
}
