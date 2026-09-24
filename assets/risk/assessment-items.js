import { LIKELIHOOD, SEVERITY } from './schema.js';
import { mountRiskImprovements } from './improvements.js';
import { mountRiskPhase4 } from './phase4.js';

const el = (tag, text = '', className = '') => Object.assign(document.createElement(tag), { textContent: text, className });
const button = (text, action, className = 'secondary-button') => { const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node; };
const date = value => new Date(value).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
const IMPROVEMENT_STATUS = { REQUESTED:'개선요청', SUBMITTED:'제출완료', REVISION_REQUIRED:'보완요청', APPROVED:'최종완료' };

async function request(path, options = {}) {
  const response = await fetch(path, { credentials:'same-origin', mode:'same-origin', redirect:'error', cache:'no-store', ...options });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) throw Object.assign(new Error(data?.error || 'REQUEST_FAILED'), { status:response.status, code:data?.error });
  return data;
}

export function mountRiskAssessmentWorkspace(root, { companyId, source = null, itemId = null, direct = false, back, isCurrent, loginRequired }) {
  let disposed = false, offset = 0, filters = { department:'', source:'' };
  const active = () => !disposed && isCurrent();
  const base = `/api/companies/${encodeURIComponent(companyId)}/risk-assessment-items`;
  const status = el('p', '', 'risk-assessment-message'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const fail = error => { if (!active()) return; if (error.status === 401) loginRequired('위험성평가표를 이용하려면 로그인이 필요합니다.'); else status.textContent = error.status === 403 ? '회사 관리자만 평가항목을 관리할 수 있습니다.' : '요청을 처리하지 못했습니다.'; };

  function heading(title, description) {
    root.replaceChildren(); root.append(button('← 관리자 검토함으로 돌아가기', back)); const h1 = el('h1', title); h1.tabIndex = -1; root.append(h1, el('p', description, 'my-secondary'), status); h1.focus({preventScroll:true});
  }

  function sourceReference(value) {
    if (!value) return null;
    const box = el('aside', '', 'risk-assessment-source'); box.append(el('h2','근로자 설문 원문'));
    for (const [label,text] of [['부서',value.department],['작업장소',value.location],['위험유형',value.hazardTypes?.join(', ')],['위험상황',value.hazardDescription],['개선의견',value.improvementSuggestion],['제출일',value.submittedAt ? date(value.submittedAt) : '']]) {
      if (!text) continue; const row = el('div'); row.append(el('strong',label),el('p',text)); box.append(row);
    }
    return box;
  }

  async function showEditor(currentSource = null, currentId = null) {
    heading(currentId ? '평가항목 수정' : currentSource ? '채택 의견을 평가항목으로 변환' : '직접 평가항목 추가', '근로자 원문과 별도로 실제 위험성평가표에 사용할 내용을 작성합니다.');
    status.textContent = '입력 화면을 준비하는 중입니다.';
    try {
      const [meta, detail] = await Promise.all([request(base + '?limit=1&offset=0'), currentId ? request(base + '/' + encodeURIComponent(currentId)) : Promise.resolve(null)]); if (!active()) return;
      const item = detail?.item, reference = item?.source || currentSource;
      heading(currentId ? '평가항목 수정' : reference ? '채택 의견을 평가항목으로 변환' : '직접 평가항목 추가', '가능성 × 중대성은 화면과 서버에서 자동 계산됩니다.');
      const ref = sourceReference(reference); if (ref) root.append(ref);
      const form = el('form', '', 'risk-assessment-form'), inputs = {};
      const field = (name,labelText,tag='input') => { const label=el('label',labelText), input=document.createElement(tag); input.name=name; input.required=true; input.maxLength={workProcess:500,hazardFactor:1000,hazardSituation:5000,currentMeasures:5000,reductionMeasures:5000}[name]; if(tag==='textarea')input.rows=3; label.append(input); form.append(label); inputs[name]=input; return input; };
      const departmentLabel=el('label','부서'), department=document.createElement('select'); department.name='departmentId'; department.required=!reference; department.append(new Option(reference?'부서 미지정 또는 원문 부서 유지':'부서를 선택해주세요.',''));
      for(const row of meta.departments)department.append(new Option(row.name,row.id)); departmentLabel.append(department); form.append(departmentLabel); inputs.departmentId=department;
      field('workProcess','작업/공정'); field('hazardFactor','유해·위험요인'); field('hazardSituation','위험상황 및 잠재적 결과','textarea'); field('currentMeasures','현재 안전보건조치','textarea');
      const dimensions=el('div','','risk-assessment-dimensions');
      for(const [name,labelText,values] of [['likelihood','가능성',LIKELIHOOD],['severity','중대성',SEVERITY]]) { const label=el('label',labelText), select=document.createElement('select'); select.name=name; select.required=true; select.append(new Option('선택해주세요.','')); values.forEach((value,index)=>select.append(new Option(`${index+1} · ${value}`,String(index+1)))); label.append(select); dimensions.append(label); inputs[name]=select; }
      const scoreBox=el('div','','risk-assessment-score'); scoreBox.append(el('span','개선 전 위험성')); const score=el('output','—'); scoreBox.append(score); dimensions.append(scoreBox); form.append(dimensions);
      field('reductionMeasures','위험성 감소대책','textarea');
      const updateScore=()=>{const likelihood=Number(inputs.likelihood.value),severity=Number(inputs.severity.value);score.value=likelihood&&severity?String(likelihood*severity):'—';score.textContent=score.value;}; inputs.likelihood.addEventListener('change',updateScore);inputs.severity.addEventListener('change',updateScore);
      const values = item || { departmentId:meta.departments.find(row=>row.name===reference?.department)?.id || '', workProcess:reference?.location || '', hazardFactor:reference?.hazardTypes?.join(', ') || '', hazardSituation:reference?.hazardDescription || '', currentMeasures:'', likelihood:reference?.preLikelihood || '', severity:reference?.preSeverity || '', reductionMeasures:reference?.improvementSuggestion || '' };
      for(const [name,input] of Object.entries(inputs))input.value=values[name] ?? ''; updateScore();
      const actions=el('div','','my-actions'), save=el('button',currentId?'수정 저장':'평가항목 저장','primary-button'); save.type='submit'; actions.append(save,button('취소',currentId||!reference?showList:back)); form.append(actions);
      form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;status.textContent='평가항목을 저장하는 중입니다.';const payload={departmentId:inputs.departmentId.value||null,workProcess:inputs.workProcess.value,hazardFactor:inputs.hazardFactor.value,hazardSituation:inputs.hazardSituation.value,currentMeasures:inputs.currentMeasures.value,likelihood:Number(inputs.likelihood.value),severity:Number(inputs.severity.value),riskScore:Number(score.value),reductionMeasures:inputs.reductionMeasures.value};if(!currentId)payload.sourceResponseId=reference?.id||reference?.responseId||null;try{await request(currentId?base+'/'+encodeURIComponent(currentId):base,{method:currentId?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(active())await showList();}catch(error){if(active()){status.textContent=error.code==='SOURCE_ALREADY_CONVERTED'?'이미 평가항목으로 작성된 의견입니다.':'평가항목을 저장하지 못했습니다. 입력 내용을 확인해주세요.';save.disabled=false;}}});
      root.append(form);
    } catch(error){fail(error);}
  }

  function itemCard(item) {
    const card=el('article','','risk-assessment-item'), top=el('div','','risk-assessment-item-top');top.append(el('span',item.sourceType==='SURVEY'?'근로자 설문':'관리자 직접등록','risk-review-badge'),el('strong',item.departmentName||'부서 미지정'),el('span',`위험성 ${item.riskScore}`,'risk-assessment-risk'));card.append(top,el('h2',item.workProcess));
    const details=el('dl');for(const [label,value] of [['유해·위험요인',item.hazardFactor],['위험상황 및 잠재적 결과',item.hazardSituation],['현재 조치',item.currentMeasures],['가능성',item.likelihood],['중대성',item.severity],['위험성 감소대책',item.reductionMeasures]])details.append(el('dt',label),el('dd',String(value)));card.append(details);
    if(item.improvement)card.append(el('p',`${IMPROVEMENT_STATUS[item.improvement.status]||item.improvement.status} · ${item.improvement.departmentName} · ${item.improvement.dueDate}`,'risk-assessment-improvement-status'));
    const actions=el('div','','my-actions'), edit=button('수정',()=>showEditor(null,item.id)), improvement=button(item.improvement?'개선조치 보기':'개선요청',()=>mountRiskImprovements(root,{companyId,item:item.improvement?null:item,requestId:item.improvement?.id||null,admin:true,back:showList,isCurrent:active,loginRequired}),'primary-button'), remove=button('삭제',async()=>{if(!confirm('이 평가항목을 삭제하시겠습니까? 원본 설문 의견은 유지됩니다.'))return;remove.disabled=true;try{await request(base+'/'+encodeURIComponent(item.id),{method:'DELETE'});if(active())await showList();}catch(error){remove.disabled=false;status.textContent=error.code==='IMPROVEMENT_REQUEST_EXISTS'?'개선요청 이력이 있는 평가항목은 삭제할 수 없습니다.':'평가항목을 삭제하지 못했습니다.';}});actions.append(improvement,edit,remove);card.append(actions);return card;
  }

  async function showList() {
    heading('위험성평가표','작성된 평가항목을 확인하고 수정할 수 있습니다.'); status.textContent='평가항목을 불러오는 중입니다.';
    const query=new URLSearchParams({limit:'50',offset:String(offset)});if(filters.department)query.set('department',filters.department);if(filters.source)query.set('source',filters.source);
    try{const data=await request(base+'?'+query);if(!active())return;heading('위험성평가표','작성된 평가항목을 확인하고 수정할 수 있습니다.');status.textContent='';const actions=el('div','','my-actions');actions.append(button('직접 평가항목 추가',()=>showEditor(null,null),'primary-button'),button('개선조치 관리',()=>mountRiskImprovements(root,{companyId,admin:true,back:showList,isCurrent:active,loginRequired})),button('연간 평가·Excel',()=>mountRiskPhase4(root,{companyId,back:showList,isCurrent:active,loginRequired})));root.append(actions);
      const form=el('form','','risk-assessment-filters'), department=el('select'), sourceSelect=el('select');department.append(new Option('전체 부서',''));data.departmentNames.forEach(name=>department.append(new Option(name,name)));department.value=filters.department;sourceSelect.append(new Option('전체 출처',''),new Option('근로자 설문','SURVEY'),new Option('관리자 직접등록','DIRECT'));sourceSelect.value=filters.source;
      for(const [labelText,select] of [['부서',department],['출처',sourceSelect]]){const label=el('label',labelText);label.append(select);form.append(label);}const apply=el('button','적용','primary-button');apply.type='submit';form.append(apply);form.addEventListener('submit',event=>{event.preventDefault();filters={department:department.value,source:sourceSelect.value};offset=0;showList();});root.append(form);
      const list=el('div','','risk-assessment-list');data.items.forEach(item=>list.append(itemCard(item)));root.append(data.items.length?list:el('p','작성된 평가항목이 없습니다.','my-empty'));const pages=el('div','','my-actions');if(offset)pages.append(button('이전',()=>{offset=Math.max(0,offset-data.limit);showList();}));if(data.hasMore)pages.append(button('다음',()=>{offset+=data.limit;showList();}));if(pages.children.length)root.append(pages);
    }catch(error){fail(error);}
  }

  if (itemId) showEditor(null,itemId); else if (source) showEditor(source,null); else if (direct) showEditor(null,null); else showList();
  return () => { disposed=true; };
}
