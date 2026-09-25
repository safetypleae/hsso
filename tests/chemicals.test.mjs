import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDB } from './helpers/d1-memory.mjs';
import { hashToken } from '../server/auth-session.js';
import { context,dashboard,candidates,collection,item,usages,usageItem,versions,ingredients,versionFile,exportWorkbook,MAX_MSDS_BYTES } from '../server/chemicals.js';
import { chemicalWorkbook,departmentSheetNames } from '../server/chemical-xlsx.js';
import { readZip } from '../server/risk-template-xlsx.js';
import { onRequest as versionsRoute } from '../functions/api/chemicals/[id]/versions.js';
import { onRequest as ingredientsRoute } from '../functions/api/chemicals/[id]/versions/[versionId]/ingredients.js';
import { onRequest as exportRoute } from '../functions/api/chemicals/export.xlsx.js';

const origin='https://local.example';
const product={productName:'WD-40',manufacturer:'WD-40 Company',supplier:'공급사',productCode:'WD40',generalUse:'윤활'};
const usage=departmentId=>({departmentId,purpose:'설비 윤활',useLocation:'기계실',storageLocation:'시설 자재창고',stockQuantity:5,stockUnit:'EA',averageUsageQuantity:3,averageUsagePeriod:'월',usageUnit:'EA'});
async function fixture(t){
  const db=createTestDB();t.after(()=>db.close());
  for(const name of ['0010_company_workspaces.sql','0011_company_invitations_permissions.sql','0014_chemical_management.sql','0015_chemical_msds_checksum.sql','0016_chemical_msds_ingredients.sql'])db.sqlite.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  const users={};for(const name of ['admin','reporter','reader','manager','other']){
    const id=crypto.randomUUID(),token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
    db.sqlite.prepare('INSERT INTO users (id,email,password_hash,name,company_name,department_name,position) VALUES (?,?,?,?,?,?,?)').run(id,`${name}@test.com`,'x',name,'x','x','x');
    db.sqlite.prepare('INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').run(crypto.randomUUID(),id,await hashToken(token),new Date(Date.now()+3600000).toISOString());
    users[name]={id,cookie:`hsso_session=${token}`};
  }
  const companyA=crypto.randomUUID(),companyB=crypto.randomUUID(),departmentA=crypto.randomUUID(),departmentA2=crypto.randomUUID(),departmentB=crypto.randomUUID(),now=new Date().toISOString();
  for(const [id,name,owner] of [[companyA,'회사 A',users.admin.id],[companyB,'회사 B',users.other.id]])db.sqlite.prepare('INSERT INTO companies VALUES (?,?,?,?,?,?,?)').run(id,name,name,'active',owner,now,now);
  for(const [id,company,name,owner] of [[departmentA,companyA,'시설팀',users.admin.id],[departmentA2,companyA,'객실정비팀',users.admin.id],[departmentB,companyB,'타사 부서',users.other.id]])db.sqlite.prepare('INSERT INTO company_departments VALUES (?,?,?,?,?,?,?,?)').run(id,company,name,name,'active',owner,now,now);
  for(const [name,company,role,dept] of [['admin',companyA,'company_admin',departmentA],['reporter',companyA,'member',departmentA],['reader',companyA,'member',null],['manager',companyA,'member',departmentA2],['other',companyB,'company_admin',departmentB]])db.sqlite.prepare('INSERT INTO company_memberships VALUES (?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),company,users[name].id,role,'active',dept,'',now,now);
  db.sqlite.prepare('INSERT INTO company_permission_grants (id,company_id,user_id,department_id,permission,status,granted_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),companyA,users.manager.id,departmentA2,'msds_manage','active',users.admin.id,now,now);
  return {db,users,companyA,companyB,departmentA,departmentA2,departmentB};
}
async function call(f,handler,user='admin',companyId=f.companyA,{method='GET',body,path='',params={},originHeader=origin}={}){
  const request=new Request(`${origin}/api/chemicals${path}?companyId=${companyId}`,{method,headers:{Origin:originHeader,'Content-Type':'application/json',...(user?{Cookie:f.users[user].cookie}:{})},...(['GET','HEAD'].includes(method)?{}:{body:JSON.stringify(body??{})})});
  const response=await handler({request,env:{DB:f.db},params});return {status:response.status,data:await response.json()};
}
async function create(f,user='reporter',companyId=f.companyA,departmentId=f.departmentA,override={}){
  return call(f,collection,user,companyId,{method:'POST',body:{product,usage:usage(departmentId),createNew:false,...override}});
}

test('company and permission boundaries apply to products, usages, and MSDS uploads',async t=>{
  const f=await fixture(t),created=await create(f);assert.equal(created.status,201);const id=created.data.productId,usageId=created.data.usageId;
  assert.equal((await call(f,item,'other',f.companyB,{params:{id}})).status,404);
  assert.equal((await call(f,usageItem,'other',f.companyB,{params:{usageId}})).status,404);
  assert.equal((await call(f,collection,'other',f.companyB)).data.products.length,0);
  const readerCreated=await create(f,'reader',f.companyA,f.departmentA2,{product:{...product,productName:'현장 발견 제품'},createNew:true});assert.equal(readerCreated.status,201);
  assert.equal((await call(f,item,'reader',f.companyA,{params:{id:readerCreated.data.productId}})).data.product.currentVersionId,null);
  const readerDashboard=(await call(f,dashboard,'reader')).data.summary;assert.equal(readerDashboard.products,2);assert.equal(readerDashboard.withoutMsds,2);
  assert.equal((await call(f,item,'reporter',f.companyA,{method:'PATCH',params:{id},body:{...product,productStatus:'ARCHIVED'}})).status,403);
  assert.equal((await call(f,versions,'reporter',f.companyA,{method:'POST',params:{id}})).status,403);
  assert.equal((await call(f,versions,'manager',f.companyA,{method:'POST',params:{id}})).data.error,'MSDS_STORAGE_UNAVAILABLE');
  assert.equal((await call(f,versions,'other',f.companyB,{method:'POST',params:{id}})).status,404);
  assert.equal((await call(f,collection,'reporter',f.companyA,{method:'POST',body:{product:{...product,productName:'소속 외 부서 제품'},usage:usage(f.departmentA2),createNew:true}})).status,201);
  assert.equal((await call(f,usageItem,'reporter',f.companyA,{method:'PATCH',params:{usageId},body:usage(f.departmentA)})).status,403);
  assert.equal((await call(f,context,'reporter')).data.access.report,true);
  const readerContext=(await call(f,context,'reader')).data;assert.equal(readerContext.access.report,true);assert.equal(readerContext.departments.length,2);
  assert.equal((await call(f,context,'manager')).data.access.manage,true);
  assert.equal((await call(f,collection,null)).status,401);
  assert.equal((await call(f,collection,'reporter',f.companyA,{method:'POST',body:{product,usage:usage(f.departmentA),createNew:true},originHeader:'https://evil.test'})).status,403);
});

test('one product shares separate department usages and keeps use/storage locations distinct',async t=>{
  const f=await fixture(t),created=await create(f);assert.equal(created.status,201);const id=created.data.productId;
  assert.equal((await call(f,usages,'reporter',f.companyA,{method:'POST',params:{id},body:usage(f.departmentA2)})).status,201);
  assert.equal((await call(f,usages,'reporter',f.companyA,{method:'POST',params:{id},body:usage(f.departmentB)})).status,403);
  const inactive=crypto.randomUUID(),now=new Date().toISOString();f.db.sqlite.prepare('INSERT INTO company_departments VALUES (?,?,?,?,?,?,?,?)').run(inactive,f.companyA,'비활성 부서','비활성 부서','inactive',f.users.admin.id,now,now);
  assert.equal((await call(f,usages,'reporter',f.companyA,{method:'POST',params:{id},body:usage(inactive)})).status,403);
  assert.equal((await call(f,usages,'admin',f.companyA,{method:'POST',params:{id},body:{...usage(f.departmentA),useLocation:'보일러실',storageLocation:'자재창고'}})).status,409);
  const detail=await call(f,item,'reader',f.companyA,{params:{id}});assert.equal(detail.data.usages.length,2);
  assert.equal(detail.data.product.currentVersionId,null);assert.equal(detail.data.versions.length,0);
  assert(detail.data.usages.some(u=>u.useLocation==='기계실'&&u.storageLocation==='시설 자재창고'));
  const otherUsage=detail.data.usages.find(u=>u.departmentId===f.departmentA2);
  assert.equal((await call(f,usageItem,'reporter',f.companyA,{method:'PATCH',params:{usageId:otherUsage.id},body:usage(f.departmentA2)})).status,403);
  assert.equal((await call(f,usageItem,'reporter',f.companyA,{method:'DELETE',params:{usageId:otherUsage.id}})).status,403);
  assert.equal((await call(f,usageItem,'reader',f.companyA,{method:'DELETE',params:{usageId:otherUsage.id}})).status,403);
  assert.equal((await call(f,usageItem,'other',f.companyB,{method:'DELETE',params:{usageId:otherUsage.id}})).status,404);
  const ownUsage=detail.data.usages.find(u=>u.departmentId===f.departmentA);
  assert.equal((await call(f,usageItem,'reporter',f.companyA,{method:'PATCH',params:{usageId:ownUsage.id},body:{...usage(f.departmentA),useLocation:'기계실 2층'}})).status,403);
  assert.equal((await call(f,usageItem,'reporter',f.companyA,{params:{usageId:ownUsage.id}})).data.usage.storageLocation,'시설 자재창고');
  assert.equal((await call(f,usageItem,'manager',f.companyA,{method:'PATCH',params:{usageId:otherUsage.id},body:{...usage(f.departmentA2),useLocation:'정비실'}})).status,200);
  assert.equal((await call(f,usageItem,'manager',f.companyA,{params:{usageId:otherUsage.id}})).data.usage.useLocation,'정비실');
  assert.equal((await call(f,usageItem,'admin',f.companyA,{method:'DELETE',params:{usageId:otherUsage.id}})).status,200);
  assert.equal((await call(f,item,'reader',f.companyA,{params:{id}})).data.usages.length,1);
  assert.equal((await call(f,usageItem,'reporter',f.companyA,{method:'DELETE',params:{usageId:ownUsage.id}})).status,403);
  assert.equal((await call(f,usageItem,'admin',f.companyA,{method:'DELETE',params:{usageId:ownUsage.id}})).status,200);
  assert.equal((await call(f,item,'reader',f.companyA,{params:{id}})).data.usages.length,0);
  assert.equal((await call(f,item,'manager',f.companyA,{method:'PATCH',params:{id},body:{...product,productStatus:'ARCHIVED'}})).status,200);
  assert.equal((await call(f,item,'reader',f.companyA,{params:{id}})).data.product.productStatus,'ARCHIVED');
});

test('company-only duplicate candidates, search, filters and dashboard use stored data',async t=>{
  const f=await fixture(t),a=await create(f);assert.equal(a.status,201);
  const companyB=await create(f,'other',f.companyB,f.departmentB,{product:{...product,productName:'B-ONLY'}});assert.equal(companyB.status,201);
  const lookup=await call(f,candidates,'reporter',f.companyA,{path:'/candidates',params:{},});
  assert.equal(lookup.status,400);
  const candidateRequest=new Request(`${origin}/api/chemicals/candidates?companyId=${f.companyA}&name=wd-40&manufacturer=wd-40`,{headers:{Cookie:f.users.reporter.cookie}});
  const found=await candidates({request:candidateRequest,env:{DB:f.db}});const data=await found.json();assert.equal(data.candidates.length,1);assert.equal(data.candidates[0].id,a.data.productId);
  const otherSearch=new Request(`${origin}/api/chemicals/candidates?companyId=${f.companyA}&name=B-ONLY`,{headers:{Cookie:f.users.reporter.cookie}});
  assert.equal((await (await candidates({request:otherSearch,env:{DB:f.db}})).json()).candidates.length,0);
  assert.equal((await create(f)).data.error,'DUPLICATE_CANDIDATE');
  const summary=(await call(f,dashboard)).data;assert.deepEqual(summary.summary,{products:1,withMsds:0,withoutMsds:1,registered:0,needsReview:0});
  assert.equal(summary.departments.find(d=>d.id===f.departmentA).products,1);assert.equal(summary.departments.find(d=>d.id===f.departmentA).withoutMsds,1);
  assert.equal((await call(f,collection,'admin',f.companyA,{path:'',})).data.products.length,1);
  const filtered=await collection({request:new Request(`${origin}/api/chemicals?companyId=${f.companyA}&status=without-msds&q=WD-40&departmentId=${f.departmentA}`,{headers:{Cookie:f.users.admin.cookie}}),env:{DB:f.db}});
  assert.equal((await filtered.json()).products.length,1);
  const absent=await collection({request:new Request(`${origin}/api/chemicals?companyId=${f.companyA}&status=with-msds`,{headers:{Cookie:f.users.admin.cookie}}),env:{DB:f.db}});
  assert.equal((await absent.json()).products.length,0);
});

test('current MSDS metadata is company-scoped and registered status follows actual ingredient review state',async t=>{
  const f=await fixture(t),created=await create(f),now=new Date().toISOString(),id=created.data.productId;
  f.db.sqlite.prepare(`INSERT INTO chemical_msds_versions (id,company_id,product_id,version_no,storage_key,original_filename,size_bytes,is_current,uploaded_by,uploaded_at,review_status) VALUES (?,?,?,?,?,?,?,1,?,?,'UNREVIEWED')`).run(crypto.randomUUID(),f.companyA,id,1,'test-only-object','msds.pdf',100,f.users.admin.id,now);
  const detail=(await call(f,item,'reader',f.companyA,{params:{id}})).data;
  assert.equal(detail.product.currentVersionId,detail.versions[0].id);assert.equal(detail.product.reviewStatus,'UNREVIEWED');
  const summary=(await call(f,dashboard)).data.summary;assert.equal(summary.withMsds,1);assert.equal(summary.withoutMsds,0);assert.equal(summary.registered,1);assert.equal(summary.needsReview,0);
  assert.equal((await call(f,item,'other',f.companyB,{params:{id}})).status,404);
  assert.equal((await call(f,versions,'manager',f.companyA,{method:'POST',params:{id}})).status,503);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM chemical_msds_versions').get().count,1);
});

class FakeBucket {
  constructor(){this.objects=new Map();this.deleted=[];this.putCalls=0;this.failPut=false;this.failDeleteAt=0;this.deleteCalls=0;}
  async put(key,value){this.putCalls+=1;if(this.failPut)throw new Error('put failed');this.objects.set(key,new Uint8Array(value));return {key};}
  async get(key){const body=this.objects.get(key);return body?{body}:null;}
  async delete(key){this.deleteCalls+=1;if(this.failDeleteAt===this.deleteCalls)throw new Error('delete failed');this.deleted.push(key);this.objects.delete(key);}
}
const pdf=(suffix='')=>new TextEncoder().encode('%PDF-1.7\n'+suffix);
async function upload(f,user,companyId,productId,{bucket,file=pdf(),filename='원문.pdf',type='application/pdf',issueDate='2026-08-10',revisionDate='2026-08-14',submissionNumber='AA123',composition}={}){
  const form=new FormData();form.append('file',new Blob([file],{type}),filename);form.append('issueDate',issueDate);form.append('revisionDate',revisionDate);form.append('submissionNumber',submissionNumber);
  if(composition!==undefined)form.append('composition',typeof composition==='string'?composition:JSON.stringify(composition));
  const request=new Request(`${origin}/api/chemicals/${productId}/versions?companyId=${companyId}`,{method:'POST',headers:{Origin:origin,Cookie:f.users[user].cookie},body:form});
  const response=await versions({request,env:{DB:f.db,...(bucket?{MSDS_BUCKET:bucket}:{})},params:{id:productId}});return {status:response.status,data:await response.json()};
}
const autoIngredient=(override={})=>({chemicalName:'Toluene',synonym:'Methylbenzene',casValue:'108-88-3',casStatus:'KNOWN',amountRaw:'10~20%',tradeSecret:false,parserConfidence:'high',reviewStatus:'REVIEWED',sourceType:'AUTO',...override});
const composition=(rows=[autoIngredient()],parserStatus='SUCCESS')=>({parserStatus,ingredients:rows});
async function getFile(f,user,companyId,productId,versionId,bucket,download=false){
  const request=new Request(`${origin}/api/chemicals/${productId}/versions/${versionId}/file?companyId=${companyId}${download?'&download=1':''}`,{headers:{Cookie:f.users[user].cookie}});
  return versionFile({request,env:{DB:f.db,...(bucket?{MSDS_BUCKET:bucket}:{})},params:{id:productId,versionId}});
}

test('Pages versions route forwards context.env MSDS_BUCKET to R2 put',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId;
  const requestFor=bucket=>{const form=new FormData();form.append('file',new Blob([pdf()],{type:'application/pdf'}),'route.pdf');return {request:new Request(`${origin}/api/chemicals/${id}/versions?companyId=${f.companyA}`,{method:'POST',headers:{Origin:origin,Cookie:f.users.admin.cookie},body:form}),env:{DB:f.db,...(bucket?{MSDS_BUCKET:bucket}:{})},params:{id}};};
  let response=await versionsRoute(requestFor(null));assert.equal(response.status,503);assert.equal((await response.json()).error,'MSDS_STORAGE_UNAVAILABLE');
  const bucket={putCalls:0,objects:new Map(),async put(key,value){this.putCalls+=1;this.objects.set(key,new Uint8Array(value));}};
  response=await versionsRoute(requestFor(bucket));assert.equal(response.status,201);assert.equal(bucket.putCalls,1);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_msds_versions').get().count,1);
  const failedBucket={putCalls:0,async put(){this.putCalls+=1;throw new Error('local R2 failure');}};
  response=await versionsRoute(requestFor(failedBucket));assert.equal(response.status,502);assert.equal((await response.json()).error,'MSDS_STORAGE_WRITE_FAILED');assert.equal(failedBucket.putCalls,1);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_msds_versions').get().count,1);
});

test('MSDS upload requires manage permission, company product ownership and storage binding',async t=>{
  const f=await fixture(t),created=await create(f),id=created.data.productId,bucket=new FakeBucket();
  assert.equal((await upload(f,'reporter',f.companyA,id,{bucket})).status,403);
  assert.equal((await upload(f,'admin',f.companyA,id)).data.error,'MSDS_STORAGE_UNAVAILABLE');
  assert.equal((await upload(f,'other',f.companyB,id,{bucket})).status,404);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_msds_versions').get().count,0);
  assert.equal(bucket.objects.size,0);
  assert.equal((await upload(f,'manager',f.companyA,id,{bucket})).status,201);
});

test('MSDS upload validates PDF extension, MIME, size, signature and metadata on the server',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket();
  assert.equal((await upload(f,'admin',f.companyA,id,{bucket,filename:'msds.txt'})).data.error,'INVALID_MSDS_FILE');
  assert.equal((await upload(f,'admin',f.companyA,id,{bucket,type:'text/plain'})).data.error,'INVALID_MSDS_FILE');
  assert.equal((await upload(f,'admin',f.companyA,id,{bucket,file:new TextEncoder().encode('not a pdf')})).data.error,'INVALID_MSDS_FILE');
  assert.equal((await upload(f,'admin',f.companyA,id,{bucket,file:new Uint8Array(MAX_MSDS_BYTES+1)})).status,413);
  assert.equal((await upload(f,'admin',f.companyA,id,{bucket,issueDate:'08/10/2026'})).data.error,'INVALID_MSDS_METADATA');
  assert.equal(bucket.objects.size,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_msds_versions').get().count,0);
});

test('R2 failure creates no row and DB failure cleans the uploaded object',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket();bucket.failPut=true;
  assert.equal((await upload(f,'admin',f.companyA,id,{bucket})).data.error,'MSDS_STORAGE_WRITE_FAILED');
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_msds_versions').get().count,0);
  bucket.failPut=false;f.db.sqlite.exec("CREATE TRIGGER fail_msds_insert BEFORE INSERT ON chemical_msds_versions BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.equal((await upload(f,'admin',f.companyA,id,{bucket})).status,500);
  assert.equal(bucket.objects.size,0);assert.equal(bucket.deleted.length,1);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_msds_versions').get().count,0);
});

test('new uploads advance current version while preserving rows and private R2 objects',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket();
  const first=await upload(f,'admin',f.companyA,id,{bucket,file:pdf('first'),filename:'first.pdf'});assert.equal(first.status,201);assert.equal(first.data.version.versionNo,1);
  const second=await upload(f,'manager',f.companyA,id,{bucket,file:pdf('second'),filename:'second.pdf',revisionDate:'2026-09-01'});assert.equal(second.status,201);assert.equal(second.data.version.versionNo,2);
  const rows=f.db.sqlite.prepare('SELECT * FROM chemical_msds_versions ORDER BY version_no').all();assert.equal(rows.length,2);assert.equal(rows[0].is_current,0);assert.equal(rows[1].is_current,1);
  assert.equal(bucket.objects.size,2);assert.equal(bucket.deleted.length,0);
  assert.match(rows[0].storage_key,new RegExp(`^companies/${f.companyA}/chemicals/${id}/msds/[a-f0-9-]+\\.pdf$`));
  assert.equal(rows[0].storage_key.includes('first.pdf'),false);assert.match(rows[0].checksum_sha256,/^[a-f0-9]{64}$/);
  const counts=(await call(f,dashboard)).data;assert.equal(counts.summary.withMsds,1);assert.equal(counts.summary.withoutMsds,0);assert.equal(counts.summary.registered,1);assert.equal(counts.summary.needsReview,0);
  assert.equal(counts.departments.find(d=>d.id===f.departmentA).withoutMsds,0);
});

test('authenticated company members view current and previous PDFs inline or as downloads',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket();
  const one=(await upload(f,'admin',f.companyA,id,{bucket,file:pdf('one'),filename:'한글 원문.pdf'})).data.version;
  const two=(await upload(f,'admin',f.companyA,id,{bucket,file:pdf('two'),filename:'new.pdf'})).data.version;
  for(const version of [one,two]){const response=await getFile(f,'reader',f.companyA,id,version.id,bucket);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.match(response.headers.get('content-disposition'),/^inline;/);assert.match(await response.text(),/^%PDF-/);}
  const download=await getFile(f,'reader',f.companyA,id,one.id,bucket,true);assert.match(download.headers.get('content-disposition'),/^attachment;/);assert.match(download.headers.get('content-disposition'),/filename\*=UTF-8''/);
  assert.equal((await getFile(f,'other',f.companyB,id,one.id,bucket)).status,404);
  assert.equal((await getFile(f,'reader',f.companyA,id,crypto.randomUUID(),bucket)).status,404);
  assert.equal((await getFile(f,'reader',f.companyA,id,one.id,null)).status,503);
});

test('version upload atomically stores ordered reviewed, absent, secret and manual ingredients',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket();
  const rows=[
    autoIngredient({amountRaw:'10 ~ 20%'}),
    autoIngredient({chemicalName:'Water',synonym:'',casValue:null,casStatus:'ABSENT',amountRaw:'잔량',parserConfidence:'medium'}),
    autoIngredient({chemicalName:'영업비밀',synonym:'Confidential component',casValue:null,casStatus:'TRADE_SECRET',amountRaw:'< 5%',tradeSecret:true,parserConfidence:null,reviewStatus:'MANUALLY_ADDED',sourceType:'MANUAL'}),
    autoIngredient({chemicalName:'Acetone',synonym:'',casValue:'67-64-1',amountRaw:'1%',reviewStatus:'AUTO_EXTRACTED'})
  ];
  const saved=await upload(f,'admin',f.companyA,id,{bucket,composition:composition(rows)});assert.equal(saved.status,201);assert.equal(saved.data.ingredientCount,4);
  const versionId=saved.data.version.id,stored=f.db.sqlite.prepare('SELECT * FROM chemical_msds_ingredients ORDER BY sort_order').all();
  assert.equal(stored.length,4);assert.deepEqual(stored.map(row=>row.sort_order),[0,1,2,3]);assert.equal(stored[0].amount_raw,'10 ~ 20%');
  assert.equal(stored[0].parser_confidence,'high');assert.equal(stored[0].review_status,'REVIEWED');assert.equal(stored[0].source_type,'AUTO');assert.equal(stored[0].reviewed_by_user_id,f.users.admin.id);
  assert.equal(stored[1].cas_status,'ABSENT');assert.equal(stored[1].cas_value,null);assert.equal(stored[2].cas_status,'TRADE_SECRET');assert.equal(stored[2].trade_secret,1);assert.equal(stored[2].review_status,'MANUALLY_ADDED');
  assert.equal(stored[3].review_status,'AUTO_EXTRACTED');assert.equal(stored[3].reviewed_by_user_id,null);assert.equal(stored[3].reviewed_at,null);
  const read=await call(f,ingredients,'reader',f.companyA,{path:`/${id}/versions/${versionId}/ingredients`,params:{id,versionId}});assert.equal(read.status,200);assert.deepEqual(read.data.ingredients.map(row=>row.chemicalName),['Toluene','Water','영업비밀','Acetone']);
  const detail=await call(f,item,'reader',f.companyA,{params:{id}});assert.deepEqual(detail.data.currentIngredients.map(row=>row.amountRaw),['10 ~ 20%','잔량','< 5%','1%']);assert.equal(detail.data.product.needsReview,1);
  const counts=(await call(f,dashboard)).data.summary;assert.equal(counts.registered,0);assert.equal(counts.needsReview,1);
  const filtered=await collection({request:new Request(`${origin}/api/chemicals?companyId=${f.companyA}&status=needs-review`,{headers:{Cookie:f.users.reader.cookie}}),env:{DB:f.db}});assert.equal((await filtered.json()).products.length,1);
});

test('ingredient GET is member-readable while replace requires msds_manage or company_admin',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket(),saved=await upload(f,'admin',f.companyA,id,{bucket,composition:composition()}),versionId=saved.data.version.id;
  const replacement=composition([autoIngredient({amountRaw:'5~10%'})]);
  assert.equal((await call(f,ingredients,'reader',f.companyA,{method:'PUT',params:{id,versionId},body:replacement})).status,403);
  assert.equal((await call(f,ingredients,'reporter',f.companyA,{method:'PUT',params:{id,versionId},body:replacement})).status,403);
  assert.equal((await call(f,ingredients,'manager',f.companyA,{method:'PUT',params:{id,versionId},body:replacement})).status,200);
  assert.equal(f.db.sqlite.prepare('SELECT amount_raw FROM chemical_msds_ingredients WHERE version_id=?').get(versionId).amount_raw,'5~10%');
  assert.equal((await call(f,ingredients,'admin',f.companyA,{method:'PUT',params:{id,versionId},body:composition([autoIngredient({amountRaw:'4~8%'})])})).status,200);
  const routeRequest=new Request(`${origin}/api/chemicals/${id}/versions/${versionId}/ingredients?companyId=${f.companyA}`,{headers:{Cookie:f.users.reader.cookie}});
  const routed=await ingredientsRoute({request:routeRequest,env:{DB:f.db},params:{id,versionId}});assert.equal(routed.status,200);assert.equal((await routed.json()).ingredients[0].amountRaw,'4~8%');
});

test('ingredient routes enforce company, product and version scope against IDOR',async t=>{
  const f=await fixture(t),first=(await create(f)).data.productId,bucket=new FakeBucket(),saved=await upload(f,'admin',f.companyA,first,{bucket,composition:composition()}),versionId=saved.data.version.id;
  const second=(await create(f,'admin',f.companyA,f.departmentA,{product:{...product,productName:'Second product'},createNew:true})).data.productId;
  for(const method of ['GET','PUT']){
    const body=method==='PUT'?composition():undefined;
    assert.equal((await call(f,ingredients,'other',f.companyB,{method,params:{id:first,versionId},body})).status,404);
    assert.equal((await call(f,ingredients,'admin',f.companyA,{method,params:{id:second,versionId},body})).status,404);
    assert.equal((await call(f,ingredients,'admin',f.companyA,{method,params:{id:first,versionId:crypto.randomUUID()},body})).status,404);
  }
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_msds_ingredients WHERE version_id=?').get(versionId).count,1);
});

test('atomic replace stores edited form state, omits deleted rows and never touches another version',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket();
  const v1=(await upload(f,'admin',f.companyA,id,{bucket,composition:composition([autoIngredient({amountRaw:'10~20%'}),autoIngredient({chemicalName:'Xylene',casValue:'1330-20-7',amountRaw:'5~10%'})])})).data.version;
  const v2=(await upload(f,'admin',f.companyA,id,{bucket,composition:composition([autoIngredient({amountRaw:'5~10%'})])})).data.version;
  const replace=await call(f,ingredients,'admin',f.companyA,{method:'PUT',params:{id,versionId:v2.id},body:composition([autoIngredient({amountRaw:'1~3%'})])});assert.equal(replace.status,200);
  assert.deepEqual(f.db.sqlite.prepare('SELECT amount_raw FROM chemical_msds_ingredients WHERE version_id=? ORDER BY sort_order').all(v1.id).map(row=>row.amount_raw),['10~20%','5~10%']);
  assert.deepEqual(f.db.sqlite.prepare('SELECT amount_raw FROM chemical_msds_ingredients WHERE version_id=? ORDER BY sort_order').all(v2.id).map(row=>row.amount_raw),['1~3%']);
  const current=(await call(f,item,'reader',f.companyA,{params:{id}})).data;assert.equal(current.product.currentVersionId,v2.id);assert.deepEqual(current.currentIngredients.map(row=>row.amountRaw),['1~3%']);
});

test('CAS checksum and status consistency are validated before R2 or atomic replacement',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket();
  for(const bad of [
    autoIngredient({casValue:'108-88-4'}),
    autoIngredient({casValue:null}),
    autoIngredient({casStatus:'ABSENT',casValue:'108-88-3'}),
    autoIngredient({sourceType:'MANUAL',reviewStatus:'REVIEWED',parserConfidence:null})
  ]){const response=await upload(f,'admin',f.companyA,id,{bucket,composition:composition([bad])});assert.equal(response.data.error,'INVALID_MSDS_INGREDIENTS');}
  assert.equal(bucket.putCalls,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_msds_versions').get().count,0);
  const valid=await upload(f,'admin',f.companyA,id,{bucket,composition:composition([autoIngredient({casStatus:'TRADE_SECRET',casValue:null,tradeSecret:true})])});assert.equal(valid.status,201);
  const before=f.db.sqlite.prepare('SELECT chemical_name FROM chemical_msds_ingredients WHERE version_id=?').get(valid.data.version.id).chemical_name;
  const invalidReplace=await call(f,ingredients,'admin',f.companyA,{method:'PUT',params:{id,versionId:valid.data.version.id},body:composition([autoIngredient({chemicalName:'bad',casValue:'108-88-4'})])});assert.equal(invalidReplace.status,400);
  assert.equal(f.db.sqlite.prepare('SELECT chemical_name FROM chemical_msds_ingredients WHERE version_id=?').get(valid.data.version.id).chemical_name,before);
});

test('UNRESOLVED and variant parser output cannot auto-save but explicit manual rows can',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket();
  const blocked=await upload(f,'admin',f.companyA,id,{bucket,composition:composition([autoIngredient()],'UNRESOLVED')});assert.equal(blocked.status,400);assert.equal(bucket.putCalls,0);
  const manual=autoIngredient({chemicalName:'원문 확인 성분',casValue:null,casStatus:'ABSENT',amountRaw:'Balance',parserConfidence:null,reviewStatus:'MANUALLY_ADDED',sourceType:'MANUAL'});
  const allowed=await upload(f,'admin',f.companyA,id,{bucket,composition:composition([manual],'VARIANT_TABLE')});assert.equal(allowed.status,201);assert.equal(allowed.data.ingredientCount,1);
});

test('ingredient insert failure rolls back version rows and cleans the new R2 object',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket();
  f.db.sqlite.exec("CREATE TRIGGER fail_ingredient_insert BEFORE INSERT ON chemical_msds_ingredients BEGIN SELECT RAISE(ABORT,'ingredient failure'); END");
  const failed=await upload(f,'admin',f.companyA,id,{bucket,composition:composition()});assert.equal(failed.status,500);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_msds_versions').get().count,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_msds_ingredients').get().count,0);
  assert.equal(bucket.objects.size,0);assert.equal(bucket.deleted.length,1);
});

async function deleteProduct(f,user,companyId,productId,bucket,db=f.db){
  const request=new Request(`${origin}/api/chemicals/${productId}?companyId=${companyId}`,{method:'DELETE',headers:{Origin:origin,'Content-Type':'application/json',Cookie:f.users[user].cookie},body:'{}'});
  const response=await item({request,env:{DB:db,...(bucket?{MSDS_BUCKET:bucket}:{})},params:{id:productId}});
  return {status:response.status,data:await response.json()};
}

test('company_admin deletes the complete product graph and every R2 version',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket();
  await upload(f,'admin',f.companyA,id,{bucket,composition:composition()});
  await upload(f,'admin',f.companyA,id,{bucket,composition:composition([autoIngredient({chemicalName:'Water',synonym:'',casValue:'7732-18-5',amountRaw:'80%'})])});
  const otherId=(await create(f,'reporter',f.companyA,f.departmentA2,{product:{...product,productName:'other product'},createNew:true})).data.productId;
  const result=await deleteProduct(f,'admin',f.companyA,id,bucket);
  assert.equal(result.status,200);assert.equal(result.data.deletedVersions,2);assert.equal(bucket.objects.size,0);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_products WHERE id=?').get(id).count,0);
  for(const table of ['chemical_usages','chemical_msds_versions','chemical_msds_ingredients'])assert.equal(f.db.sqlite.prepare(`SELECT COUNT(*) count FROM ${table} WHERE product_id=?`).get(id).count,0);
  assert.equal((await call(f,item,'admin',f.companyA,{params:{id}})).status,404);
  assert.equal((await call(f,item,'admin',f.companyA,{params:{id:otherId}})).status,200);
});

test('successful DB deletion without meta.changes still returns success instead of a false failure',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket();
  await upload(f,'admin',f.companyA,id,{bucket,composition:composition()});
  const dbWithoutChanges={...f.db,prepare(sql){
    const prepared=f.db.prepare(sql);if(!sql.startsWith('DELETE FROM chemical_products'))return prepared;
    return {bind(...args){const bound=prepared.bind(...args);return {async run(){await bound.run();return {success:true};}};}};
  }};
  const result=await deleteProduct(f,'admin',f.companyA,id,bucket,dbWithoutChanges);
  assert.equal(result.status,200);assert.equal(result.data.ok,true);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_products WHERE id=?').get(id).count,0);
  assert.equal(bucket.objects.size,0);
});

test('msds_manage can delete while member and other company are rejected',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket();
  assert.equal((await deleteProduct(f,'reporter',f.companyA,id,bucket)).status,403);
  assert.equal((await deleteProduct(f,'other',f.companyB,id,bucket)).status,404);
  assert.equal((await deleteProduct(f,'manager',f.companyA,id,bucket)).status,200);
});

test('R2 delete failure restores removed objects and preserves the whole DB graph',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket();
  await upload(f,'admin',f.companyA,id,{bucket,composition:composition()});
  await upload(f,'admin',f.companyA,id,{bucket,composition:composition()});
  bucket.failDeleteAt=2;
  const result=await deleteProduct(f,'admin',f.companyA,id,bucket);
  assert.equal(result.status,502);assert.equal(result.data.error,'MSDS_STORAGE_DELETE_FAILED');
  assert.equal(bucket.objects.size,2);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_products WHERE id=?').get(id).count,1);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_msds_versions WHERE product_id=?').get(id).count,2);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_msds_ingredients WHERE product_id=?').get(id).count,2);
});

test('DB delete failure restores all R2 objects and reports failure',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket();
  await upload(f,'admin',f.companyA,id,{bucket,composition:composition()});
  const failingDb={...f.db,prepare(sql){if(sql.startsWith('DELETE FROM chemical_products'))return {bind(){return {async run(){throw new Error('db delete failed');}}}};return f.db.prepare(sql);}};
  const result=await deleteProduct(f,'admin',f.companyA,id,bucket,failingDb);
  assert.equal(result.status,500);assert.equal(result.data.error,'PRODUCT_DELETE_DB_FAILED');
  assert.equal(bucket.objects.size,1);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_products WHERE id=?').get(id).count,1);
});

test('regulatory result is member-readable, company-scoped and follows only the current version',async t=>{
  const f=await fixture(t),id=(await create(f)).data.productId,bucket=new FakeBucket();
  const first=await upload(f,'admin',f.companyA,id,{bucket,composition:composition()});
  let detail=(await call(f,item,'reader',f.companyA,{params:{id}})).data;
  assert.equal(detail.regulatory.versionId,first.data.version.id);
  assert.equal(detail.regulatory.categories.MANAGED.state,'MATCH');
  const second=await upload(f,'admin',f.companyA,id,{bucket,composition:composition([autoIngredient({chemicalName:'Sodium chloride',synonym:'염화나트륨',casValue:'7647-14-5',amountRaw:'99'})])});
  detail=(await call(f,item,'reader',f.companyA,{params:{id}})).data;
  assert.equal(detail.regulatory.versionId,second.data.version.id);
  assert.equal(detail.regulatory.categories.MANAGED.state,'NO_MATCH');
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM chemical_msds_ingredients WHERE product_id=?').get(id).count,2,'past version ingredients remain');
  assert.equal((await call(f,item,'other',f.companyB,{params:{id}})).status,404);
});

const entryText=(entries,name)=>new TextDecoder().decode(entries.get(name).compressed);
async function exportXlsx(f,user='reader',companyId=f.companyA,query=''){
  const request=new Request(`${origin}/api/chemicals/export.xlsx?companyId=${companyId}${query?'&'+query:''}`,{headers:{...(user?{Cookie:f.users[user].cookie}:{})}});
  return exportWorkbook({request,env:{DB:f.db}});
}

test('MSDS workbook creates department index and one row per usage with current metadata and existing regulatory decisions',async t=>{
  const f=await fixture(t),bucket=new FakeBucket(),shared=(await create(f)).data.productId;
  await call(f,usages,'admin',f.companyA,{method:'POST',params:{id:shared},body:{...usage(f.departmentA2),purpose:'객실 설비 윤활',useLocation:'객실 기계실'}});
  await upload(f,'admin',f.companyA,shared,{bucket,revisionDate:'2026-09-20',submissionNumber:'SUB-2026',composition:composition([autoIngredient(),autoIngredient({chemicalName:'Xylene',synonym:'자일렌',casValue:'1330-20-7',amountRaw:'5~10%'})])});
  const missing=(await create(f,'admin',f.companyA,f.departmentA2,{product:{...product,productName:'=2+2',manufacturer:'검색제조사'},createNew:true})).data.productId;
  const pending=(await create(f,'admin',f.companyA,f.departmentA,{product:{...product,productName:'검토 제품'},createNew:true})).data.productId;
  await upload(f,'admin',f.companyA,pending,{bucket,composition:composition([autoIngredient({chemicalName:'Silica',synonym:'실리카',casValue:'68611-44-9',amountRaw:'5 - 9.9'}),autoIngredient({reviewStatus:'AUTO_EXTRACTED'})])});
  const noMatch=(await create(f,'admin',f.companyA,f.departmentA,{product:{...product,productName:'비해당 제품'},createNew:true})).data.productId;
  await upload(f,'admin',f.companyA,noMatch,{bucket,composition:composition([autoIngredient({chemicalName:'Sodium chloride',synonym:'염화나트륨',casValue:'7647-14-5',amountRaw:'99%'})])});
  await create(f,'other',f.companyB,f.departmentB,{product:{...product,productName:'타사 비밀제품'},createNew:true});

  const response=await exportXlsx(f);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/spreadsheetml/);assert.match(response.headers.get('content-disposition'),/\.xlsx/);
  const entries=readZip(await response.arrayBuffer()),workbook=entryText(entries,'xl/workbook.xml'),allXml=[...entries].filter(([name])=>name.startsWith('xl/worksheets/')).map(([name])=>entryText(entries,name)).join('\n');
  assert.match(workbook,/sheet name="부서 목록"/);assert.match(workbook,/sheet name="시설팀"/);assert.match(workbook,/sheet name="객실정비팀"/);
  const list=entryText(entries,'xl/worksheets/sheet1.xml');assert.match(list,/HSSO MSDS 부서 목록/);assert.match(list,/location="&apos;시설팀&apos;!A1"/);assert.match(list,/location="&apos;객실정비팀&apos;!A1"/);
  assert.equal((allXml.match(/>WD-40<\/t>/g)||[]).length,2,'one shared product appears once in each of its two usage departments');
  assert.match(allXml,/2026-09-20/);assert.match(allXml,/SUB-2026/);assert.match(allXml,/해당\n\(Toluene, Xylene\)/);assert.match(allXml,/대상 유해인자 포함\n\(Toluene, Xylene\)/);assert.match(allXml,/확인 필요\n\(Silica\)/);
  assert.match(allXml,/비해당/);assert.doesNotMatch(allXml,/\(Sodium chloride\)/);
  assert.match(allXml,/=2\+2/);assert.doesNotMatch(allXml,/<f(?:\s|>)/);assert.doesNotMatch(allXml,/타사 비밀제품/);
  assert(entries.has('[Content_Types].xml')&&entries.has('xl/styles.xml')&&entries.has('xl/worksheets/sheet3.xml'),'generated workbook reparses with all sheets');
  const firstDepartment=entryText(entries,'xl/worksheets/sheet2.xml');assert.equal((firstDepartment.match(/<c r="[A-S]4"/g)||[]).length,19,'regulatory detail stays inside the existing 19 columns');assert.match(firstDepartment,/ht="42"/);assert.match(entryText(entries,'xl/styles.xml'),/wrapText="1"/);
  const routed=await exportRoute({request:new Request(`${origin}/api/chemicals/export.xlsx?companyId=${f.companyA}`,{headers:{Cookie:f.users.reader.cookie}}),env:{DB:f.db}});assert.equal(routed.status,200);assert(readZip(await routed.arrayBuffer()).has('xl/workbook.xml'));

  const departmentOnly=readZip(await (await exportXlsx(f,'reader',f.companyA,new URLSearchParams({departmentId:f.departmentA}).toString())).arrayBuffer());
  const departmentWorkbook=entryText(departmentOnly,'xl/workbook.xml'),departmentXml=[...departmentOnly].filter(([name])=>name.startsWith('xl/worksheets/')).map(([name])=>entryText(departmentOnly,name)).join('\n');
  assert.match(departmentWorkbook,/시설팀/);assert.doesNotMatch(departmentWorkbook,/객실정비팀/);assert.doesNotMatch(departmentXml,/=2\+2/);
  const searched=entryText(readZip(await (await exportXlsx(f,'reader',f.companyA,'q='+encodeURIComponent('검색제조사'))).arrayBuffer()),'xl/workbook.xml');assert.match(searched,/객실정비팀/);assert.doesNotMatch(searched,/시설팀/);
  const without=readZip(await (await exportXlsx(f,'reader',f.companyA,'status=without-msds')).arrayBuffer()),withoutXml=[...without].filter(([name])=>name.startsWith('xl/worksheets/')).map(([name])=>entryText(without,name)).join('\n');assert.match(withoutXml,/=2\+2/);assert.doesNotMatch(withoutXml,/>WD-40<\/t>/);
  const needs=readZip(await (await exportXlsx(f,'reader',f.companyA,'status=needs-review')).arrayBuffer()),needsXml=[...needs].filter(([name])=>name.startsWith('xl/worksheets/')).map(([name])=>entryText(needs,name)).join('\n');assert.match(needsXml,/검토 제품/);assert.doesNotMatch(needsXml,/>WD-40<\/t>/);
  assert.equal((await exportXlsx(f,null)).status,401);assert.equal((await exportXlsx(f,'other',f.companyA)).status,404);
  assert(missing);
});

test('MSDS workbook export is not limited to the 100-row list page',async t=>{
  const f=await fixture(t);
  for(let index=0;index<105;index++)await create(f,'admin',f.companyA,f.departmentA,{product:{...product,productName:`대량 제품 ${String(index).padStart(3,'0')}`},createNew:true});
  const list=await collection({request:new Request(`${origin}/api/chemicals?companyId=${f.companyA}`,{headers:{Cookie:f.users.admin.cookie}}),env:{DB:f.db}}),listData=await list.json();assert.equal(listData.products.length,100);assert.equal(listData.hasMore,true);
  const entries=readZip(await (await exportXlsx(f,'admin')).arrayBuffer()),department=entryText(entries,'xl/worksheets/sheet2.xml');
  assert.equal((department.match(/<row r="(?:[5-9]|[1-9]\d+)"/g)||[]).length,105);assert.match(department,/대량 제품 104/);
});

test('department sheet names are safe, unique and formula-looking text remains an inline string',()=>{
  const departments=[{name:'동일/부서'},{name:'동일:부서'},{name:'부서 목록'},{name:"'"+'가'.repeat(50)+"'"}],names=departmentSheetNames(departments);
  assert.equal(new Set(names.map(name=>name.toLocaleLowerCase('ko-KR'))).size,names.length);for(const name of names){assert(name.length<=31);assert.doesNotMatch(name,/[\\/?*:[\]]/);assert(!name.startsWith("'")&&!name.endsWith("'"));}
  const blank={productCount:1,msdsCount:0,missingCount:1,reviewCount:1,rows:[{productName:'=HYPERLINK("https://evil")',manufacturer:'+SUM(1,1)',supplier:'@cmd',purpose:'-1+2',useLocation:'',storageLocation:'',stockQuantity:null,stockUnit:'',averageUsageQuantity:null,averageUsagePeriod:'',usageUnit:'',revisionDate:'',submissionNumber:'',managed:'확인 필요',specialManaged:'확인 필요',workEnvironment:'확인 필요',specialHealth:'확인 필요',reviewRequired:'예'}]};
  const entries=readZip(chemicalWorkbook({companyName:'테스트',outputDate:'2026-09-25',departments:departments.map(department=>({...department,...blank}))})),xml=[...entries].filter(([name])=>name.startsWith('xl/worksheets/')).map(([name])=>entryText(entries,name)).join('\n');
  assert.match(xml,/=HYPERLINK/);assert.match(xml,/\+SUM/);assert.doesNotMatch(xml,/<f(?:\s|>)/);
});
