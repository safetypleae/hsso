import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDB } from './helpers/d1-memory.mjs';
import { collection, item, MAX_BODY_BYTES } from '../server/documents.js';
import { onRequest as signup } from '../functions/api/auth/signup.js';
import { onRequest as login } from '../functions/api/auth/login.js';

const origin='https://local.example';
const warning={productName:'안전 제품 100%_A',ghsCodes:['GHS02'],signalWord:'위험',hazardStatements:'H225 원문\n두 번째 줄',precautions:[{category:'예방',statements:['P210 원문']}],supplierName:'공급자',supplierPhone:'02-000-0000'};
const processGuide={productName:'관리요령 제품',signalWord:'경고',ghs:['GHS07'],hazardStatements:'원문 그대로',handling:{safeHandling:'취급 원문'},firstAid:{eye:'눈',skin:'피부',inhalation:'흡입',ingestion:'섭취'},accidentResponse:{fire:'화재',spill:'누출'},selectedPpe:['301'],ppeNone:false};
const payload=(type='warning_label')=>({documentType:type,title:type==='warning_label'?'경고표지 문서':'관리요령 문서',documentData:structuredClone(type==='warning_label'?warning:processGuide)});

async function call(db,cookie,{method='GET',id,body,raw,query='',requestOrigin=origin,contentType='application/json'}={}) {
  const headers={'Content-Type':contentType}; if(cookie)headers.Cookie=cookie;if(requestOrigin!==null)headers.Origin=requestOrigin;
  const request=new Request(origin+'/api/documents'+(id?'/'+id:'')+query,{method,headers,...(['POST','DELETE'].includes(method)?{body:raw??(body===undefined?undefined:JSON.stringify(body))}:{})});
  const response=await (id?item:collection)({request,env:{DB:db},params:{id}});
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),null);
  return {status:response.status,data:await response.json()};
}
async function fixture(t) {
  const db=createTestDB();t.after(()=>db.close());
  db.sqlite.exec(readFileSync(new URL('../migrations/0002_saved_documents.sql',import.meta.url),'utf8'));
  const accounts=[];
  for(const email of ['one@example.com','two@example.com']) {
    const body={email,password:'fixture password',name:'테스트',companyName:'회사',departmentName:'부서',position:'직급'};
    const request=()=>new Request(origin+'/api/auth/test',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await signup({request:request(),env:{DB:db}})).status,201);
    const response=await login({request:request(),env:{DB:db}});const user=(await response.json()).user;
    accounts.push({id:user.id,cookie:response.headers.get('set-cookie').split(';')[0]});
  }
  return {db,a:accounts[0],b:accounts[1]};
}
async function save(db,a,type) {const result=await call(db,a.cookie,{method:'POST',body:payload(type)});assert.equal(result.status,201);return result.data.document;}

test('anonymous POST, list, detail and delete are denied',async t=>{
  const {db}=await fixture(t);
  for(const options of [{method:'POST',body:payload()},{},{id:crypto.randomUUID()},{method:'DELETE',id:crypto.randomUUID()}]) assert.equal((await call(db,null,options)).status,401);
});
test('both preview shapes round-trip without rewriting; server owns identity and 90-day dates',async t=>{
  const {db,a,b}=await fixture(t);
  for(const type of ['warning_label','process_guide']) {
    const input={...payload(type),user_id:b.id,created_at:'2000-01-01',expires_at:'2100-01-01'};
    const before=Date.now();const saved=await call(db,a.cookie,{method:'POST',body:input});assert.equal(saved.status,201);
    const doc=saved.data.document;assert(Date.parse(doc.createdAt)>=before);assert.equal(Date.parse(doc.expiresAt)-Date.parse(doc.createdAt),90*86400000);
    assert.equal(db.sqlite.prepare('SELECT user_id FROM saved_documents WHERE id=?').get(doc.id).user_id,a.id);
    assert.deepEqual((await call(db,a.cookie,{id:doc.id})).data.document.documentData,input.documentData);
  }
});
test('unsupported types, blank titles, missing preview data, extra binary fields and invalid GHS rejected',async t=>{
  const {db,a}=await fixture(t);
  for(const body of [{...payload(),documentType:'risk_survey'},{...payload(),title:' '},{...payload(),documentData:{}},{...payload(),documentData:{...warning,pdf:'base64'}},{...payload(),documentData:{...warning,ghsCodes:['../../secret']}}])assert.equal((await call(db,a.cookie,{method:'POST',body})).status,400);
});
test('other owner cannot read or delete; owner deletes only own document',async t=>{
  const {db,a,b}=await fixture(t);const doc=await save(db,a);
  assert.equal((await call(db,b.cookie,{id:doc.id})).status,404);
  assert.equal((await call(db,b.cookie,{id:doc.id,method:'DELETE'})).status,404);
  assert.equal((await call(db,b.cookie)).data.documents.length,0);
  assert.equal((await call(db,a.cookie,{id:doc.id,method:'DELETE'})).status,200);
  assert.equal((await call(db,a.cookie,{id:doc.id})).status,404);
});
test('search trims input and matches title/product with literal SQL wildcards',async t=>{
  const {db,a}=await fixture(t);await save(db,a);await save(db,a,'process_guide');
  for(const q of [' 경고표지 ','100%_A'])assert.equal((await call(db,a.cookie,{query:'?q='+encodeURIComponent(q)})).data.documents.length,1);
  assert.equal((await call(db,a.cookie,{query:'?q='+encodeURIComponent("' OR 1=1 --")})).data.documents.length,0);
});
test('type filters and dashboard counts come from all retained owner rows',async t=>{
  const {db,a,b}=await fixture(t);await save(db,a);await save(db,a,'process_guide');await save(db,b);
  const result=await call(db,a.cookie,{query:'?type=process_guide&limit=1'});
  assert.equal(result.data.documents.length,1);assert.equal(result.data.documents[0].documentType,'process_guide');assert.deepEqual(result.data.summary,{warning_label:1,process_guide:1});
});
test('period filters include KST today, 7, 30, 90 days',async t=>{
  const {db,a}=await fixture(t);
  for(const age of [0,3,15,60]) {const doc=await save(db,a);db.sqlite.prepare('UPDATE saved_documents SET created_at=? WHERE id=?').run(new Date(Date.now()-age*86400000).toISOString(),doc.id);}
  for(const [period,count] of [['today',1],['7',2],['30',3],['90',4]])assert.equal((await call(db,a.cookie,{query:'?period='+period})).data.documents.length,count);
});
test('expired documents absent from list/detail/summary, and expired sessions denied',async t=>{
  const {db,a}=await fixture(t);const doc=await save(db,a);
  db.sqlite.prepare('UPDATE saved_documents SET expires_at=? WHERE id=?').run(new Date(Date.now()-1).toISOString(),doc.id);
  const result=await call(db,a.cookie);assert.equal(result.data.documents.length,0);assert.equal(result.data.summary.warning_label,0);assert.equal((await call(db,a.cookie,{id:doc.id})).status,404);
  db.sqlite.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').run(new Date(0).toISOString(),a.id);
  assert.equal((await call(db,a.cookie)).status,401);
});
test('default 20, maximum 50 and offset pagination',async t=>{
  const {db,a}=await fixture(t);const doc=await save(db,a);const row=db.sqlite.prepare('SELECT * FROM saved_documents').get();
  for(let i=0;i<54;i++)db.sqlite.prepare('INSERT INTO saved_documents VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),a.id,row.document_type,row.title,row.search_text,row.document_data,row.created_at,row.expires_at);
  assert.equal((await call(db,a.cookie)).data.documents.length,20);
  const capped=await call(db,a.cookie,{query:'?limit=500'});assert.equal(capped.data.limit,50);assert.equal(capped.data.documents.length,50);assert.equal(capped.data.hasMore,true);
  const next=await call(db,a.cookie,{query:'?limit=50&offset=50'});assert.equal(next.data.documents.length,5);assert.equal(next.data.hasMore,false);assert(doc.id);
});
test('invalid JSON, body limit, filters and methods fail safely',async t=>{
  const {db,a}=await fixture(t);
  assert.equal((await call(db,a.cookie,{method:'POST',raw:'{'})).status,400);
  assert.equal((await call(db,a.cookie,{method:'POST',raw:'x'.repeat(MAX_BODY_BYTES+1)})).status,413);
  assert.equal((await call(db,a.cookie,{method:'POST',body:payload(),contentType:'text/plain'})).status,400);
  for(const query of ['?limit=0','?limit=-1','?offset=-1','?type=risk','?period=365'])assert.equal((await call(db,a.cookie,{query})).status,400);
  assert.equal((await call(db,a.cookie,{method:'PUT'})).status,405);
});
test('POST and DELETE block foreign/null Origin; absent Origin follows auth policy',async t=>{
  const {db,a}=await fixture(t);const doc=await save(db,a);
  for(const requestOrigin of ['https://evil.example','null','https://local.example.evil']) {
    assert.equal((await call(db,a.cookie,{method:'POST',body:payload(),requestOrigin})).status,403);
    assert.equal((await call(db,a.cookie,{method:'DELETE',id:doc.id,requestOrigin})).status,403);
  }
  assert.equal((await call(db,a.cookie,{method:'POST',body:payload(),requestOrigin:null})).status,201);
});
test('DB errors are generic for every endpoint and do not expose internals',async t=>{
  const {db,a}=await fixture(t);const doc=await save(db,a);db.fail=true;
  for(const options of [{},{method:'POST',body:payload()},{id:doc.id},{id:doc.id,method:'DELETE'}])assert.deepEqual(await call(db,a.cookie,options),{status:500,data:{ok:false,error:'INTERNAL_SERVER_ERROR'}});
});
test('responses omit identity internals, password/session hashes and raw tokens; values are bound',async t=>{
  const {db,a}=await fixture(t);const doc=await save(db,a);
  for(const options of [{},{id:doc.id}]) {
    const serialized=JSON.stringify((await call(db,a.cookie,options)).data);
    for(const secret of ['password_hash','token_hash','user_id','fixture password',a.cookie.split('=')[1]])assert(!serialized.includes(secret));
  }
  assert(db.calls.filter(call=>call.sql.includes('saved_documents')).every(call=>!call.sql.includes(a.id)&&!call.sql.includes(warning.productName)));
});
