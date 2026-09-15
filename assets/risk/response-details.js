const el=(tag,text='',className='')=>Object.assign(document.createElement(tag),{textContent:text,className});
export function photoGallery(photos) {
  const gallery=el('div','','risk-photo-gallery');
  for(const [i,photo]of photos.entries()){
    const link=el('a');link.href=photo.url;link.target='_blank';link.rel='noopener';const image=el('img');image.src=photo.url;image.alt=`첨부사진 ${i+1}`;image.loading='lazy';image.addEventListener('error',()=>{link.replaceChildren(document.createTextNode('첨부사진을 불러오지 못했습니다. 다시 열기'));});link.append(image);gallery.append(link);
  }
  return gallery;
}
export function appendResponseExtras(container,surveyId,response) {
  const definition=response.questionSnapshot||[];
  for(const q of definition.filter(q=>q.id.startsWith('c_'))){const value=response.answers?.[q.id];if(value==null||value==='')continue;container.append(el('h3',q.text),el('p',Array.isArray(value)?value.join(', '):String(value)));}
  if(response.photos?.length){container.append(el('h2','첨부사진 보기'),photoGallery(response.photos.map(p=>({...p,url:`/api/risk-surveys/${encodeURIComponent(surveyId)}/responses/${encodeURIComponent(response.id)}/photos/${encodeURIComponent(p.id)}`}))));}
}
export function confirmSurveyDeletion(survey,{deleted,loginRequired}){
  const dialog=el('dialog','','risk-qr-dialog'),title=el('h2','설문 삭제 확인'),description=el('p',`“${survey.title}” 설문과 응답 ${survey.responseCount}건, 문항 이력, 첨부사진이 함께 삭제됩니다. 기존 링크와 QR도 사용할 수 없습니다. 되돌릴 수 없습니다.`);
  const label=el('label','확인을 위해 설문 제목을 그대로 입력해주세요.'),input=el('input');input.setAttribute('aria-label','삭제할 설문 제목');label.append(input);
  const confirm=el('button','설문 영구 삭제','primary-button'),cancel=el('button','취소','secondary-button'),status=el('p');confirm.type=cancel.type='button';confirm.disabled=true;status.setAttribute('role','status');
  input.addEventListener('input',()=>confirm.disabled=input.value!==survey.title);cancel.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove());
  confirm.addEventListener('click',async()=>{confirm.disabled=cancel.disabled=true;input.disabled=true;try{const response=await fetch('/api/risk-surveys/'+encodeURIComponent(survey.id),{method:'DELETE',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmTitle:input.value})});if(response.status===401){dialog.close();loginRequired('설문을 삭제하려면 다시 로그인해주세요.');return;}if(!response.ok)throw new Error();dialog.close();deleted();}catch{status.textContent='삭제하지 못했습니다. 다시 시도해주세요.';confirm.disabled=cancel.disabled=input.disabled=false;}});
  dialog.addEventListener('cancel',event=>{if(cancel.disabled)event.preventDefault();});dialog.append(title,description,label,confirm,cancel,status);document.body.append(dialog);dialog.showModal();input.focus();
}
