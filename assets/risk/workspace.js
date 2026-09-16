import { buildSurveyForm } from './builder.js';
import { renderPublicForm } from './public-form.js';
import { createSurveyQrButton } from './qr.js';
const el=(tag,text='',className='')=>Object.assign(document.createElement(tag),{textContent:text,className});
export function initRiskSurveyWorkspace(navigate) {
  const form=document.querySelector('#risk-survey-form'),read=buildSurveyForm(form);
  const actions=el('div','','survey-actions'),preview=el('button','미리보기','secondary-button'),save=el('button','설문 저장 및 링크 만들기','primary-button'),note=el('p');
  preview.type='button';preview.id='survey-preview-button';save.type='submit';save.id='survey-create-button';note.id='survey-action-note';note.setAttribute('role','status');actions.append(preview,save);form.append(actions,note);
  // Old static note is outside the form; the editor now owns its status area.
  document.querySelectorAll('#survey-action-note').forEach(node=>{if(node!==note)node.remove();});
  const showSurvey=(survey,token)=>{
    document.querySelector('#worker-survey-title').textContent=survey.title||'위험성평가 설문';document.querySelector('#worker-survey-target').textContent=survey.target;document.querySelector('#worker-survey-period').textContent=`${survey.startDate} ~ ${survey.endDate}`;document.querySelector('#worker-survey-description').textContent=survey.guidance;
    renderPublicForm(document.querySelector('#worker-survey-form'),survey,token);
  };
  preview.addEventListener('click',()=>{history.pushState({},'','#risk-survey-preview');navigate('risk-survey-preview');});
  form.addEventListener('submit',async event=>{event.preventDefault();if(save.disabled)return;const data=read();save.disabled=true;note.textContent='설문을 저장하는 중입니다.';
    try{const response=await fetch('/api/risk-surveys',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(response.status===401){history.pushState({},'','#login');navigate('login');return;}if(!response.ok)throw new Error(result.error==='MIGRATION_REQUIRED'?'위험성평가 DB 확장 설정이 필요합니다.':'회사명·부서 목록·문항·기간을 확인해주세요.');
      const url=`${location.origin}/survey/${result.survey.publicToken}`,link=el('a',url),copy=el('button','링크 복사','secondary-button');link.href=url;link.target='_blank';link.rel='noopener';copy.type='button';copy.addEventListener('click',async()=>{await navigator.clipboard.writeText(url);copy.textContent='복사됨';});note.replaceChildren(document.createTextNode('설문 저장 완료 · '),link,copy,createSurveyQrButton({publicToken:result.survey.publicToken,title:data.title}));
    }catch(error){note.textContent=error.message;}finally{save.disabled=false;}
  });
  const match=/^\/survey\/([a-f0-9]{64})\/?$/.exec(location.pathname);
  const controller={preview:()=>showSurvey(read(),null)};
  if(match){
    navigate('risk-survey-preview');document.querySelector('#risk-survey-preview > .back-button').hidden=true;document.querySelector('.site-header').hidden=true;document.querySelector('.site-footer').hidden=true;
    const workerForm=document.querySelector('#worker-survey-form');workerForm.replaceChildren(el('p','설문을 불러오는 중입니다.'));
    fetch(`/api/public/risk-surveys/${encodeURIComponent(match[1])}`,{credentials:'omit',cache:'no-store'}).then(async response=>{const result=await response.json();if(!response.ok)throw new Error(({SURVEY_INACTIVE:'현재 응답을 받고 있지 않은 설문입니다.',SURVEY_NOT_STARTED:'아직 시작되지 않은 설문입니다.',SURVEY_ENDED:'종료된 설문입니다.'})[result.error]||'설문을 찾을 수 없습니다.');showSurvey(result.survey,match[1]);}).catch(error=>{workerForm.replaceChildren(el('p',error.message));});
  }else if(location.hash==='#risk-survey-preview')controller.preview();
  return controller;
}
