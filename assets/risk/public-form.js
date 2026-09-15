import { choiceType, multipleType, visibleQuestion, LIKELIHOOD, SEVERITY } from './schema.js';
const el=(tag,text='',className='')=>Object.assign(document.createElement(tag),{textContent:text,className});
export function renderPublicForm(form, survey, token = null) {
  form.replaceChildren(); form.classList.add('risk-public-form');
  const answers={}, controls=new Map(), cards=new Map();
  const info=el('p',`회사명: ${survey.companyName || '회사 미등록'}`); info.id='worker-company'; form.append(info);
  const participants=el('section','','worker-section'), personal={};
  for(const [key,label,id,enabled] of [['department','부서','worker-department',survey.settings.collectDepartment],['respondentName','이름','worker-name',survey.settings.collectName],['employeeId','사번','worker-employee-id',survey.settings.collectEmployeeId]]) {
    const wrap=el('label',label,'survey-field'),input=el(key==='department'?'select':'input');input.id=id;input.maxLength=300;
    if(key==='department'){input.append(new Option(survey.departments.length?'부서를 선택해주세요':'등록된 부서가 없습니다',''));for(const name of survey.departments)input.append(new Option(name,name));}
    input.disabled=!enabled || key==='department'&&!survey.departments.length;wrap.hidden=!enabled;wrap.append(input);participants.append(wrap);personal[key]=input;
  }
  const anonymousLabel=el('label','익명으로 응답','worker-choice'), anonymous=el('input');anonymous.type='checkbox';anonymous.id='worker-anonymous';anonymousLabel.prepend(anonymous);anonymousLabel.hidden=!survey.settings.allowAnonymous;participants.append(anonymousLabel);form.append(participants);
  function updateParticipants(){for(const [key,input]of Object.entries(personal)){const enabled=survey.settings[{department:'collectDepartment',respondentName:'collectName',employeeId:'collectEmployeeId'}[key]];input.disabled=!enabled||anonymous.checked||key==='department'&&!survey.departments.length;input.required=!input.disabled&&!survey.settings.allowAnonymous;}}
  anonymous.addEventListener('change',updateParticipants);updateParticipants();
  let photos;
  for(const q of survey.questions) {
    const card=el('section','','worker-section');card.dataset.questionId=q.id;card.append(el('h2',q.text+(q.required?' *':'')));cards.set(q.id,card);
    const nodes=[]; controls.set(q.id,nodes);
    if(q.type==='photo') {
      photos=el('input');photos.type='file';photos.id='worker-photo';photos.accept='image/png,image/jpeg';photos.multiple=true;photos.disabled=!survey.photoUploadAvailable&&!token?false:!survey.photoUploadAvailable;
      card.append(photos,el('p',survey.photoUploadAvailable||!token?'JPEG·PNG, 최대 3장, 장당 5MB.':'사진 저장소 설정 전에는 첨부할 수 없습니다.'));nodes.push(photos);
    } else if(choiceType(q)) {
      if(q.type==='dropdown'){
        const select=el('select');select.append(new Option('선택해주세요',''));for(const value of q.options)select.append(new Option(value,value));select.name='answer-'+q.id;select.addEventListener('change',()=>{answers[q.id]=select.value;updateBranches();});card.append(select);nodes.push(select);
      }else for(const [i,value] of q.options.entries()){
        const label=el('label',value,'worker-choice'),input=el('input');input.type=multipleType(q)?'checkbox':'radio';input.name=q.id==='q1'?'workerHasHazard':q.id==='safe_reason'?'workerSafeReason':'answer-'+q.id;input.value=q.id==='q1'?(value==='예'?'yes':'no'):value;input.dataset.answer=value;input.id='answer-'+q.id+'-'+i;
        input.addEventListener('change',()=>{answers[q.id]=multipleType(q)?nodes.filter(n=>n.checked).map(n=>n.dataset.answer):value;updateBranches();});label.prepend(input);card.append(label);nodes.push(input);
      }
    }else if(['pre_risk','post_risk'].includes(q.type)){
      const phase=q.type==='pre_risk'?'before':'after';
      for(const [dimension,label,values]of [['likelihood','발생가능성',LIKELIHOOD],['severity','중대성',SEVERITY]]){
        const wrap=el('label',label,'survey-field'),select=el('select');select.id=`worker-${phase}-${dimension}`;select.name=select.id;select.append(new Option('선택해주세요',''));values.forEach((v,i)=>select.append(new Option(`${i+1} · ${v}`,String(i+1))));
        select.addEventListener('change',()=>{answers[q.id]={...answers[q.id],[dimension]:select.value?Number(select.value):null};output.textContent=answers[q.id].likelihood&&answers[q.id].severity?`위험성 ${answers[q.id].likelihood*answers[q.id].severity}`:'발생가능성과 중대성을 선택해주세요.';});wrap.append(select);card.append(wrap);nodes.push(select);
      }
      const output=el('output','발생가능성과 중대성을 선택해주세요.');card.append(output);
    }else{
      const input=el(['short_text','hazard_location'].includes(q.type)?'input':'textarea');input.id=({q3:'worker-hazard-description',q4:'worker-hazard-location',q6:'worker-improvement'})[q.id]||'answer-'+q.id;input.name='answer-'+q.id;input.maxLength=['short_text','hazard_location'].includes(q.type)?300:5000;input.addEventListener('input',()=>answers[q.id]=input.value.trim());card.append(input);nodes.push(input);
    }
    form.append(card);
  }
  function updateBranches(){for(const q of survey.questions){const visible=visibleQuestion(q,survey.questions,answers,survey.settings);cards.get(q.id).hidden=!visible;for(const input of controls.get(q.id)){input.disabled=!visible||q.type==='photo'&&!!token&&!survey.photoUploadAvailable;input.required=visible&&q.required&&!multipleType(q)&&q.type!=='photo';}}}
  updateBranches();
  const submit=el('button','제출하기','primary-button');submit.type='submit';submit.id='worker-submit-button';const message=el('p');message.id='worker-submit-message';message.setAttribute('role','status');form.append(submit,message);
  form.onsubmit=async event=>{
    event.preventDefault();if(submit.disabled)return;if(!token){message.textContent='미리보기에서는 응답이 저장되지 않습니다.';return;}
    const sent={};for(const q of survey.questions)if(visibleQuestion(q,survey.questions,answers,survey.settings)&&q.type!=='photo'&&answers[q.id]!==undefined)sent[q.id]=answers[q.id];
    const files=photos&&!photos.disabled?[...photos.files]:[];
    if(files.length>3||files.some(f=>f.size>5*1024*1024||!['image/jpeg','image/png'].includes(f.type))){message.textContent='사진은 JPEG·PNG 최대 3장, 장당 5MB까지 첨부할 수 있습니다.';return;}
    const values=Object.fromEntries(Object.entries(personal).map(([k,input])=>[k,input.disabled?'':input.value.trim()]));
    const payload={schemaVersion:2,revision:survey.revision,answers:sent,...values,isAnonymous:anonymous.checked || survey.settings.allowAnonymous&&!values.respondentName&&!values.department&&!values.employeeId};
    const multipart=new FormData();multipart.append('payload',JSON.stringify(payload));files.forEach(file=>multipart.append('photos',file));
    submit.disabled=true;message.textContent='응답을 제출하는 중입니다.';
    try{const response=await fetch(`/api/public/risk-surveys/${encodeURIComponent(token)}/responses`,{method:'POST',credentials:'omit',headers:files.length?{}:{'Content-Type':'application/json'},body:files.length?multipart:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw new Error(({SURVEY_CHANGED:'설문이 변경되었습니다. 새로고침 후 다시 작성해주세요.',DUPLICATE_RESPONSE:'이미 제출된 사번입니다.',PHOTO_STORAGE_UNAVAILABLE:'사진 저장소를 사용할 수 없습니다. 담당자에게 문의해주세요.',INVALID_PHOTO:'사진 파일의 형식·용량을 확인해주세요.',INVALID_DEPARTMENT:'등록된 부서를 선택해주세요.'})[result.error]||'필수 문항과 입력 내용을 확인해주세요.');message.textContent='응답이 제출되었습니다.';form.querySelectorAll('input,select,textarea,button').forEach(node=>node.disabled=true);}catch(error){submit.disabled=false;message.textContent=error.message;}
  };
}
