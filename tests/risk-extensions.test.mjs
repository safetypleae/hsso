import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, createSurvey, call, responsePayload } from './helpers/risk-fixture.mjs';
import { extendedFixture, extendedPayload, definedResponse, invoke, applyRiskExtension, png } from './helpers/risk-extended.mjs';
import { surveyCollection, surveyItem, publicSurvey, publicResponses, adminResponseItem, responseCsv } from '../server/risk-surveys.js';
import { surveyStatistics, responseXlsx } from '../server/risk-statistics.js';
import { responsePhoto, cleanupPhotos, MAX_PHOTO_BYTES } from '../server/risk-photos.js';
import { onRequest as photoRoute } from '../functions/api/risk-surveys/[id]/responses/[responseId]/photos/[photoId].js';

async function create(context, input=extendedPayload()) {const result=await invoke(surveyCollection,context,{method:'POST',data:input});assert.equal(result.status,201,JSON.stringify(result.data));return result.data.survey;}
const submit=(context,survey,data=definedResponse(),files)=>invoke(publicResponses,context,{method:'POST',cookie:'',token:survey.publicToken,data,files});
const custom=[
  {id:'c_single',type:'single_choice',text:'보호구 지급',required:true,options:['예','아니오']},
  {id:'c_multi',type:'multiple_choice',text:'필요 장비',required:false,options:['안전모','안전화']},
  {id:'c_drop',type:'dropdown',text:'근무조',required:true,options:['주간','야간']},
  {id:'c_short',type:'short_text',text:'짧은 의견',required:false,options:[]},
  {id:'c_long',type:'long_text',text:'상세 의견',required:false,options:[]}
];
function withCustom(){const input=definedResponse();Object.assign(input.answers,{c_single:'예',c_multi:['안전모','안전화'],c_drop:'야간',c_short:'원본 보존',c_long:'첫 줄\n둘째 줄'});return input;}

test('additive migration leaves existing columns/data unchanged, legacy public response survives before/after',async t=>{
  const context=await fixture(t),survey=await createSurvey(context.db,context.a);
  const columns=context.db.sqlite.prepare('PRAGMA table_info(risk_responses)').all();
  assert.equal((await call(publicResponses,context.db,{method:'POST',params:{token:survey.publicToken},data:responsePayload()})).status,201);
  const before=context.db.sqlite.prepare('SELECT * FROM risk_responses').all();
  assert.equal((await invoke(surveyCollection,context,{method:'POST',data:extendedPayload()})).data.error,'MIGRATION_REQUIRED');
  const legacy=await invoke(publicSurvey,context,{cookie:'',token:survey.publicToken});assert.equal(legacy.status,200);assert.equal(legacy.data.survey.questions.length,9);
  const input=definedResponse(0);input.department='';input.employeeId='E2';assert.equal((await submit(context,survey,input)).status,201);
  applyRiskExtension(context.db);
  assert.deepEqual(context.db.sqlite.prepare('PRAGMA table_info(risk_responses)').all(),columns);
  assert.deepEqual(context.db.sqlite.prepare('SELECT * FROM risk_responses WHERE id=?').all(before[0].id),before);
  const stats=await invoke(surveyStatistics,context,{id:survey.id});assert.equal(stats.data.total,2);assert.equal(stats.data.survey.companyName,'');
  assert.equal((await invoke(responseCsv,context,{id:survey.id})).status,200);
});

test('company, authored departments, custom definitions and anonymous public submission',async t=>{
  const context=await extendedFixture(t),payload=extendedPayload();payload.questions.push(...custom);
  const survey=await create(context,payload),get=await invoke(publicSurvey,context,{cookie:'',token:survey.publicToken});
  assert.equal(get.data.survey.companyName,payload.companyName);assert.deepEqual(get.data.survey.departments,['BM오션','BM환경']);assert.equal(get.data.survey.photoUploadAvailable,true);
  assert.equal((await submit(context,survey,withCustom())).status,201);
  const row=context.db.sqlite.prepare('SELECT * FROM risk_responses').get(),snapshot=JSON.parse(row.response_data);
  assert.equal(snapshot.answers.c_short,'원본 보존');assert.equal(snapshot.questionSnapshot.length,14);assert.equal(row.pre_risk_score,20);
  const invalid=withCustom();invalid.department='임의 부서';assert.equal((await submit(context,survey,invalid)).data.error,'INVALID_DEPARTMENT');
  const anon=withCustom();anon.isAnonymous=true;assert.equal((await submit(context,survey,anon)).status,201);
  const anonymous=context.db.sqlite.prepare('SELECT respondent_name,department,employee_id FROM risk_responses WHERE is_anonymous=1').get();assert.deepEqual({...anonymous},{respondent_name:null,department:null,employee_id:null});
  for(const change of [input=>delete input.answers.c_single,input=>input.answers.c_multi=['허용안됨'],input=>input.answers.q5.likelihood=6,input=>input.companyName='위조']){const invalid=withCustom();change(invalid);assert.equal((await submit(context,survey,invalid)).status,400);}
});

test('custom statistics, rating dimensions and company+department XLSX share filters',async t=>{
  const context=await extendedFixture(t),payload=extendedPayload();payload.questions.push(...custom);const survey=await create(context,payload);
  assert.equal((await submit(context,survey,withCustom())).status,201);
  const other=withCustom();other.department='BM환경';other.employeeId='E2';other.answers.c_single='아니오';assert.equal((await submit(context,survey,other)).status,201);
  const query='?company='+encodeURIComponent(payload.companyName)+'&department='+encodeURIComponent('BM오션');
  const result=await invoke(surveyStatistics,context,{id:survey.id,query});assert.equal(result.data.total,1);
  const q=id=>result.data.questions.find(q=>q.id===id);
  assert.equal(q('c_single').distribution[0].count,1);assert.equal(q('c_multi').kind,'multiple');assert.equal(q('c_multi').distribution[1].percent,100);assert.deepEqual(q('c_long').answers,['첫 줄\n둘째 줄']);
  assert.equal(q('q5').dimensions[0].distribution[4].percent,100);assert.equal(q('q5').dimensions[1].distribution[3].count,1);
  assert.equal(q('q7').dimensions[0].distribution[1].count,1);assert.equal(q('q7').dimensions[1].distribution[1].count,1);
  const xlsx=await invoke(responseXlsx,context,{id:survey.id,query}),bytes=Buffer.from(await xlsx.response.arrayBuffer());
  assert(bytes.includes(Buffer.from('원본 보존')));assert(bytes.includes(Buffer.from('회사명')));assert(bytes.includes(Buffer.from('HSSO 회사')));assert(!bytes.includes(Buffer.from('BM환경')));assert(bytes.includes(Buffer.from('첨부사진 수')));
  assert.equal((await invoke(surveyStatistics,context,{id:survey.id,query:'?company=other'})).data.total,0);
});

test('edit preserves token and old question snapshots; removed/changed questions remain in stats/XLSX',async t=>{
  const context=await extendedFixture(t),payload=extendedPayload();payload.questions.push(...custom);const survey=await create(context,payload);assert.equal((await submit(context,survey,withCustom())).status,201);
  const edit={...payload,revision:1,title:'수정 제목',companyName:'변경 회사',departments:['객실관리'],questions:payload.questions.filter(q=>q.id!=='c_short').map(q=>q.id==='c_single'?{...q,text:'새로운 제목',options:['지급','미지급']}:q)};
  const changed=await invoke(surveyItem,context,{id:survey.id,method:'PATCH',data:edit});assert.equal(changed.status,200);assert.equal(changed.data.survey.publicToken,survey.publicToken);assert.equal(changed.data.survey.revision,2);
  assert.equal((await submit(context,survey,withCustom())).status,409);
  assert.equal((await invoke(surveyItem,context,{id:survey.id,method:'PATCH',data:edit})).status,409);
  const next=withCustom();next.revision=2;next.department='객실관리';next.employeeId='E2';next.answers.c_single='지급';delete next.answers.c_short;assert.equal((await submit(context,survey,next)).status,201);
  const stats=await invoke(surveyStatistics,context,{id:survey.id});assert.equal(stats.data.total,2);assert(stats.data.questions.some(q=>q.id==='c_short'&&q.archived&&q.answers[0]==='원본 보존'));assert.equal(stats.data.questions.filter(q=>q.id==='c_single').length,2);
  const xlsx=await invoke(responseXlsx,context,{id:survey.id});const bytes=Buffer.from(await xlsx.response.arrayBuffer());assert(bytes.includes(Buffer.from('원본 보존')));assert(bytes.includes(Buffer.from('이전 문항')));
});

test('editing legacy survey archives original definition without rewriting its response',async t=>{
  const context=await extendedFixture(t),survey=await createSurvey(context.db,context.a);
  await call(publicResponses,context.db,{method:'POST',params:{token:survey.publicToken},data:responsePayload()});
  const before=context.db.sqlite.prepare('SELECT response_data FROM risk_responses').get().response_data;
  const edit={...extendedPayload(),revision:0};edit.questions[2].text='수정된 위험상황';
  assert.equal((await invoke(surveyItem,context,{id:survey.id,method:'PATCH',data:edit})).status,200);
  assert.equal(context.db.sqlite.prepare('SELECT response_data FROM risk_responses').get().response_data,before);
  const stats=await invoke(surveyStatistics,context,{id:survey.id});assert(stats.data.questions.some(q=>q.id==='q3'&&q.archived&&q.answers.includes('사다리 위험')));
});

test('owner-only edit/delete, cross-Origin protection and required deletion confirmation',async t=>{
  const context=await extendedFixture(t),survey=await create(context);
  for(const method of ['PATCH','DELETE']){
    const data=method==='PATCH'?{...extendedPayload(),revision:1}:{confirmTitle:survey.title};
    assert.equal((await invoke(surveyItem,context,{id:survey.id,method,data,cookie:''})).status,401);
    assert.equal((await invoke(surveyItem,context,{id:survey.id,method,data,cookie:context.b.cookie})).status,404);
    assert.equal((await invoke(surveyItem,context,{id:survey.id,method,data,origin:'https://evil.test'})).status,403);
  }
  assert.equal((await invoke(surveyItem,context,{id:survey.id,method:'DELETE',data:{confirmTitle:'wrong'}})).status,400);
  assert.equal((await invoke(surveyItem,context,{id:survey.id,method:'DELETE',data:{confirmTitle:survey.title}})).status,200);
  assert.equal((await invoke(publicSurvey,context,{token:survey.publicToken,cookie:''})).status,404);
});

test('private R2 photo storage, owner reads, statistics links, cascaded delete with retry queue',async t=>{
  const context=await extendedFixture(t),survey=await create(context);
  const result=await submit(context,survey,definedResponse(),[new File([png],'사진.png',{type:'image/png'})]);assert.equal(result.status,201,JSON.stringify(result.data));
  const photo=context.db.sqlite.prepare('SELECT * FROM risk_response_photos').get();assert.equal(context.env.RISK_PHOTOS.objects.size,1);assert.equal(context.db.sqlite.prepare('SELECT COUNT(*) AS n FROM risk_photo_deletions').get().n,0);
  for(const handler of [responsePhoto,photoRoute]){
    const args={id:survey.id,responseId:photo.response_id,photoId:photo.id};assert.equal((await invoke(handler,context,{...args,cookie:''})).status,401);assert.equal((await invoke(handler,context,{...args,cookie:context.b.cookie})).status,404);
    const read=await invoke(handler,context,args);assert.equal(read.status,200);assert.deepEqual(Buffer.from(await read.response.arrayBuffer()),png);assert.equal(read.response.headers.get('Cache-Control'),'no-store');
  }
  const detail=await invoke(adminResponseItem,context,{id:survey.id,responseId:photo.response_id});assert.equal(detail.data.response.photos.length,1);assert(!JSON.stringify(detail.data).includes('object_key'));
  const stats=await invoke(surveyStatistics,context,{id:survey.id});assert(stats.data.questions.find(q=>q.id==='q8').photos[0].url.includes(photo.id));
  context.env.RISK_PHOTOS.failDelete=true;
  assert.equal((await invoke(surveyItem,context,{id:survey.id,method:'DELETE',data:{confirmTitle:survey.title}})).status,200);
  for(const table of ['risk_surveys','risk_responses','risk_survey_metadata','risk_survey_versions','risk_response_photos'])assert.equal(context.db.sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
  assert.equal(context.db.sqlite.prepare('SELECT COUNT(*) AS n FROM risk_photo_deletions').get().n,1);
  assert.equal((await invoke(responsePhoto,context,{id:survey.id,responseId:photo.response_id,photoId:photo.id})).status,404);
  context.env.RISK_PHOTOS.failDelete=false;await cleanupPhotos(context.env);assert.equal(context.env.RISK_PHOTOS.objects.size,0);
});

test('photo MIME/size/count validation, missing binding and storage failure do not save partial responses',async t=>{
  const context=await extendedFixture(t),survey=await create(context);
  const image=()=>new File([png],'photo.png',{type:'image/png'});
  for(const files of [[new File(['<svg onload=alert(1)>'],'fake.png',{type:'image/png'})],[new File([png],'fake.jpg',{type:'image/jpeg'})],[new File([new Uint8Array(MAX_PHOTO_BYTES+1)],'big.png',{type:'image/png'})],[image(),image(),image(),image()]])assert.equal((await submit(context,survey,definedResponse(),files)).status,400);
  const bucket=context.env.RISK_PHOTOS;delete context.env.RISK_PHOTOS;assert.equal((await submit(context,survey,definedResponse(),[image()])).status,503);context.env.RISK_PHOTOS=bucket;
  bucket.failPut=true;assert.equal((await submit(context,survey,definedResponse(),[image()])).status,500);
  assert.equal(context.db.sqlite.prepare('SELECT COUNT(*) AS n FROM risk_responses').get().n,0);assert.equal(bucket.objects.size,0);
});

test('custom-only questionnaire and removed hazard gate remain answerable without fabricating risk scores',async t=>{
  const context=await extendedFixture(t),payload=extendedPayload();payload.questions=[custom[0]];const survey=await create(context,payload);
  const response={...definedResponse(),answers:{c_single:'예'}};assert.equal((await submit(context,survey,response)).status,201);
  const row=context.db.sqlite.prepare('SELECT id,pre_risk_score FROM risk_responses').get();assert.equal(row.pre_risk_score,null);
  const detail=await invoke(adminResponseItem,context,{id:survey.id,responseId:row.id});assert.equal(detail.data.response.hasHazard,null);
});
