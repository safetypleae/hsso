const root=document.querySelector('#boards'),content=document.querySelector('#board-content'),status=document.querySelector('#board-status');
const labels={notice:'공지사항',free:'자유게시판',inquiry:'문의사항'},inquiryStatuses={waiting:'답변 대기',answered:'답변 완료'};
let boardType='notice',offset=0,query='',currentUser=null,generation=0,manageInquiries=false,inquiryFilter='';
const isAdmin=()=>currentUser?.role==='admin';
const inquiryBase=()=>manageInquiries&&isAdmin()?'/api/admin/inquiries':'/api/inquiries';

function el(tag,text='',className=''){const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;}
function button(text,action,className='board-secondary'){const node=el('button',text,className);node.type='button';node.addEventListener('click',action);return node;}
function date(value){return new Date(value).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'});}
async function api(path,options={}){const response=await fetch(path,{credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',...options});const data=await response.json().catch(()=>null);if(!response.ok||data?.ok!==true)throw Object.assign(new Error(data?.error||'REQUEST_FAILED'),{status:response.status});return data;}
async function session(){try{const data=await api('/api/auth/me');currentUser={...data.user,role:data.role};}catch{currentUser=null;}if(!isAdmin())manageInquiries=false;}
function selectNav(){root.querySelectorAll('[data-board-select]').forEach(node=>node.toggleAttribute('aria-current',node.dataset.boardSelect===boardType));}
function heading(actions=true) {
  const descriptions={notice:'HSSO의 주요 소식을 확인하세요.',free:'안전보건 실무자들과 자유롭게 의견을 나누세요.',inquiry:manageInquiries?'전체 문의사항을 확인하고 답변하세요.':'내가 등록한 문의사항과 처리 상태를 확인하세요.'};
  const wrap=el('header','','board-heading'),copy=document.createElement('div');
  copy.append(el('h1',boardType==='inquiry'&&manageInquiries?'문의 관리':labels[boardType]),el('p',descriptions[boardType]));
  if(isAdmin())copy.append(el('span','관리자','board-admin-badge'));
  wrap.append(copy);
  const actionsWrap=el('div','','board-heading-actions');
  if(actions&&currentUser&&(boardType==='free'||(boardType==='inquiry'&&!manageInquiries)||(boardType==='notice'&&isAdmin())))actionsWrap.append(button(boardType==='inquiry'?'문의하기':boardType==='notice'?'공지 작성':'글쓰기',()=>write(),'board-write-button'));
  if(actions&&boardType==='inquiry'&&isAdmin())actionsWrap.append(button(manageInquiries?'내 문의 보기':'전체 문의 관리',()=>{manageInquiries=!manageInquiries;offset=0;list();}));
  wrap.append(actionsWrap);content.append(wrap);
}
function pagination(data){const pages=el('div','','board-pagination');if(offset)pages.append(button('이전',()=>{offset=Math.max(0,offset-20);list();}));pages.append(el('span',`${Math.floor(offset/20)+1} / ${Math.max(1,Math.ceil(data.total/20))}`));if(data.hasMore)pages.append(button('다음',()=>{offset+=20;list();}));content.append(pages);}

function inquiryList(data){if(!data.inquiries.length){content.append(el('p','등록한 문의사항이 없습니다.','board-empty'));return;}const table=el('table','','board-table'),thead=document.createElement('thead'),head=document.createElement('tr');for(const label of ['번호','제목','상태','등록일'])head.append(el('th',label));thead.append(head);const tbody=document.createElement('tbody');data.inquiries.forEach((inquiry,index)=>{const row=document.createElement('tr'),title=document.createElement('td');title.append(button(inquiry.title,()=>detail(inquiry.id),'board-title-button'));row.append(el('td',String(data.total-offset-index)),title,el('td',inquiryStatuses[inquiry.status]||inquiry.status),el('td',date(inquiry.createdAt)));tbody.append(row);});table.append(thead,tbody);content.append(table);pagination(data);}
function boardList(data){const form=el('form','','board-tools'),input=document.createElement('input');input.type='search';input.maxLength=200;input.placeholder='제목 또는 작성자 검색';input.value=query;const submit=el('button','검색');submit.type='submit';form.append(input,submit);form.addEventListener('submit',event=>{event.preventDefault();query=input.value.trim();offset=0;list();});content.append(form);if(!data.posts.length){content.append(el('p',query?'검색 결과가 없습니다.':'등록된 게시글이 없습니다.','board-empty'));return;}const table=el('table','','board-table'),thead=document.createElement('thead'),head=document.createElement('tr');for(const label of ['번호','분류','제목','작성자','등록일','조회수'])head.append(el('th',label));thead.append(head);const tbody=document.createElement('tbody');data.posts.forEach((post,index)=>{const row=document.createElement('tr');row.append(el('td',String(data.total-offset-index)),el('td',labels[post.boardType]));const title=document.createElement('td');title.append(button(post.title,()=>detail(post.id),'board-title-button'));row.append(title,el('td',post.authorName),el('td',date(post.createdAt)),el('td',String(post.viewCount)));tbody.append(row);});table.append(thead,tbody);content.append(table);pagination(data);}

async function list() {
  const version=++generation;content.replaceChildren();status.textContent=boardType==='inquiry'?'문의사항을 불러오는 중입니다.':'게시글을 불러오는 중입니다.';
  selectNav();await session();if(version!==generation)return;heading();
  if(boardType==='inquiry'&&!currentUser){status.textContent='';content.append(el('p','문의사항은 로그인 후 이용할 수 있습니다.','board-empty'));return;}
  if(boardType==='inquiry'&&manageInquiries) {
    const label=el('label','문의 상태 ','board-filter'),select=document.createElement('select');
    for(const [value,text] of [['','전체'],['waiting','답변 대기'],['answered','답변 완료']]){const option=el('option',text);option.value=value;select.append(option);}
    select.value=inquiryFilter;select.addEventListener('change',()=>{inquiryFilter=select.value;offset=0;list();});label.append(select);content.append(label);
  }
  try {
    const path=boardType==='inquiry'?`${inquiryBase()}?${new URLSearchParams({limit:'20',offset:String(offset),...(manageInquiries?{status:inquiryFilter}:{})})}`:`/api/boards?${new URLSearchParams({type:boardType,q:query,limit:'20',offset:String(offset)})}`,data=await api(path);
    if(version!==generation||root.hidden)return;status.textContent='';if(boardType==='inquiry')inquiryList(data);else boardList(data);
  }catch(error){if(version!==generation)return;status.textContent='데이터를 불러오지 못했습니다.';content.append(button('다시 시도',list));}
}

async function detail(id) {
  const version=++generation;content.replaceChildren();status.textContent='내용을 불러오는 중입니다.';
  try {
    await session();if(version!==generation)return;
    const data=await api(boardType==='inquiry'?`${inquiryBase()}/${encodeURIComponent(id)}`:`/api/boards/${encodeURIComponent(id)}`);
    if(version!==generation||root.hidden)return;status.textContent='';
    const article=el('article','','board-detail'),item=boardType==='inquiry'?data.inquiry:data.post;
    article.append(el('h1',item.title));
    const meta=el('div','','board-meta'),values=boardType==='inquiry'?[labels.inquiry,inquiryStatuses[item.status]||item.status,...(item.authorName?[item.authorName]:[]),date(item.createdAt)]:[labels[item.boardType],item.authorName,date(item.createdAt),`조회 ${item.viewCount}`];
    for(const value of values)meta.append(el('span',value));article.append(meta,el('div',item.content,'board-body'));
    if(boardType==='inquiry') {
      if(item.answer){const answer=el('section','','board-answer');answer.append(el('h2','관리자 답변'),el('p',item.answer.content,'board-answer-content'),el('small',`최종 수정 ${date(item.answer.updatedAt)}`));article.append(answer);}
      if(manageInquiries&&isAdmin())article.append(answerForm(item));
    }
    const actions=el('div','','board-actions');actions.append(button('목록으로',list));
    if(boardType!=='inquiry'&&item.canEdit)actions.append(button('수정',()=>write(item)));
    if(boardType==='notice'&&item.canDelete&&isAdmin())actions.append(button('삭제',async event=>{
      if(!window.confirm('이 공지사항을 삭제하시겠습니까?'))return;
      const target=event.currentTarget;target.disabled=true;
      try{await api(`/api/boards/${encodeURIComponent(item.id)}`,{method:'DELETE'});window.dispatchEvent(new Event('hsso:boards-changed'));if(version===generation)list();}
      catch{if(version===generation)status.textContent='삭제하지 못했습니다.';target.disabled=false;}
    }));
    article.append(actions);content.append(article);
  }catch{if(version!==generation)return;status.textContent='내용을 불러올 수 없습니다.';content.append(button('목록으로',list));}
}

function answerForm(item) {
  const version=generation,form=el('form','','board-form board-answer-form'),label=el('label',item.answer?'답변 수정':'답변 작성'),input=document.createElement('textarea');
  input.name='answer';input.required=true;input.maxLength=10000;input.value=item.answer?.content||'';label.append(input);
  const message=el('p','','board-form-message');message.setAttribute('role','status');
  const submit=el('button',item.answer?'답변 수정':'답변 등록','board-submit');submit.type='submit';form.append(label,message,submit);
  form.addEventListener('submit',async event=>{
    event.preventDefault();submit.disabled=true;message.textContent='저장하는 중입니다.';
    try{await api(`/api/admin/inquiries/${encodeURIComponent(item.id)}/answer`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:input.value})});if(version===generation)detail(item.id);}
    catch(error){message.textContent=error.status===403?'관리자 권한이 필요합니다.':'답변을 저장하지 못했습니다.';submit.disabled=false;}
  });return form;
}
function write(post=null){content.replaceChildren();heading(false);const form=el('form','','board-form'),titleLabel=el('label','제목'),title=document.createElement('input');title.name='title';title.maxLength=200;title.required=true;title.value=post?.title||'';titleLabel.append(title);const contentLabel=el('label','내용'),body=document.createElement('textarea');body.name='content';body.maxLength=10000;body.required=true;body.value=post?.content||'';contentLabel.append(body);const message=el('p','','board-form-message');message.setAttribute('role','status');const actions=el('div','','board-actions'),cancel=button('취소',()=>post?detail(post.id):list()),submit=el('button',post?'수정 완료':boardType==='inquiry'?'문의 등록':'등록','board-submit');submit.type='submit';actions.append(cancel,submit);form.append(titleLabel,contentLabel,message,actions);form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;message.textContent='저장하는 중입니다.';try{const isInquiry=boardType==='inquiry',path=isInquiry?'/api/inquiries':post?`/api/boards/${encodeURIComponent(post.id)}`:'/api/boards',payload=isInquiry?{title:title.value,content:body.value}:{boardType:post?.boardType||boardType,title:title.value,content:body.value},data=await api(path,{method:post?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!isInquiry)window.dispatchEvent(new Event('hsso:boards-changed'));offset=0;query='';detail(isInquiry?data.inquiry.id:data.post.id);}catch(error){message.textContent=error.status===401?'로그인이 필요합니다.':'저장하지 못했습니다.';submit.disabled=false;}});content.append(form);title.focus();}

root.querySelectorAll('[data-board-select]').forEach(node=>node.addEventListener('click',()=>{boardType=node.dataset.boardSelect;offset=0;query='';list();}));
document.addEventListener('click',event=>{const link=event.target.closest('[data-board-open], [data-inquiry-open]');if(!link)return;boardType=link.hasAttribute('data-inquiry-open')?'inquiry':link.dataset.boardOpen;offset=0;query='';setTimeout(list,0);},true);
window.addEventListener('popstate',()=>{if(location.hash==='#boards')list();});
if(location.hash==='#boards')list();
