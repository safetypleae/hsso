import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDB } from './helpers/d1-memory.mjs';
import { hashToken } from '../server/auth-session.js';
import { context,dashboard,candidates,collection,item,usages,usageItem,versions } from '../server/chemicals.js';

const origin='https://local.example';
const product={productName:'WD-40',manufacturer:'WD-40 Company',supplier:'공급사',productCode:'WD40',generalUse:'윤활'};
const usage=departmentId=>({departmentId,purpose:'설비 윤활',useLocation:'기계실',storageLocation:'시설 자재창고',stockQuantity:5,stockUnit:'EA',averageUsageQuantity:3,averageUsagePeriod:'월',usageUnit:'EA'});
async function fixture(t){
  const db=createTestDB();t.after(()=>db.close());
  for(const name of ['0010_company_workspaces.sql','0011_company_invitations_permissions.sql','0014_chemical_management.sql'])db.sqlite.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
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
  assert.equal((await create(f,'reader')).status,403);
  assert.equal((await call(f,item,'reporter',f.companyA,{method:'PATCH',params:{id},body:{...product,productStatus:'ARCHIVED'}})).status,403);
  assert.equal((await call(f,versions,'reporter',f.companyA,{method:'POST',params:{id}})).status,403);
  assert.equal((await call(f,versions,'manager',f.companyA,{method:'POST',params:{id}})).data.error,'PERSISTENT_STORAGE_REQUIRED');
  assert.equal((await call(f,versions,'other',f.companyB,{method:'POST',params:{id}})).status,404);
  assert.equal((await call(f,collection,'reporter',f.companyA,{method:'POST',body:{product,usage:usage(f.departmentA2),createNew:true}})).status,403);
  assert.equal((await call(f,usageItem,'reporter',f.companyA,{method:'PATCH',params:{usageId},body:usage(f.departmentA2)})).status,400);
  assert.equal((await call(f,context,'reporter')).data.access.report,true);
  assert.equal((await call(f,context,'reader')).data.access.report,false);
  assert.equal((await call(f,context,'manager')).data.access.manage,true);
  assert.equal((await call(f,collection,null)).status,401);
  assert.equal((await call(f,collection,'reporter',f.companyA,{method:'POST',body:{product,usage:usage(f.departmentA),createNew:true},originHeader:'https://evil.test'})).status,403);
});

test('one product shares separate department usages and keeps use/storage locations distinct',async t=>{
  const f=await fixture(t),created=await create(f);assert.equal(created.status,201);const id=created.data.productId;
  assert.equal((await call(f,usages,'manager',f.companyA,{method:'POST',params:{id},body:usage(f.departmentA2)})).status,201);
  assert.equal((await call(f,usages,'admin',f.companyA,{method:'POST',params:{id},body:{...usage(f.departmentA),useLocation:'보일러실',storageLocation:'자재창고'}})).status,201);
  const detail=await call(f,item,'reader',f.companyA,{params:{id}});assert.equal(detail.data.usages.length,3);
  assert.equal(detail.data.product.currentVersionId,null);assert.equal(detail.data.versions.length,0);
  assert(detail.data.usages.some(u=>u.useLocation==='기계실'&&u.storageLocation==='시설 자재창고'));
  assert(detail.data.usages.some(u=>u.useLocation==='보일러실'&&u.storageLocation==='자재창고'));
  const otherUsage=detail.data.usages.find(u=>u.departmentId===f.departmentA2);
  assert.equal((await call(f,usageItem,'reporter',f.companyA,{method:'PATCH',params:{usageId:otherUsage.id},body:usage(f.departmentA2)})).status,403);
  const ownUsage=detail.data.usages.find(u=>u.departmentId===f.departmentA);
  assert.equal((await call(f,usageItem,'reporter',f.companyA,{method:'PATCH',params:{usageId:ownUsage.id},body:{...usage(f.departmentA),useLocation:'기계실 2층'}})).status,200);
  assert.equal((await call(f,usageItem,'reporter',f.companyA,{params:{usageId:ownUsage.id}})).data.usage.storageLocation,'시설 자재창고');
  assert.equal((await call(f,usageItem,'manager',f.companyA,{method:'PATCH',params:{usageId:otherUsage.id},body:{...usage(f.departmentA2),useLocation:'정비실'}})).status,200);
  assert.equal((await call(f,usageItem,'manager',f.companyA,{params:{usageId:otherUsage.id}})).data.usage.useLocation,'정비실');
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
  const summary=(await call(f,dashboard)).data;assert.deepEqual(summary.summary,{products:1,withMsds:0,withoutMsds:1,unreviewed:0});
  assert.equal(summary.departments.find(d=>d.id===f.departmentA).products,1);assert.equal(summary.departments.find(d=>d.id===f.departmentA).withoutMsds,1);
  assert.equal((await call(f,collection,'admin',f.companyA,{path:'',})).data.products.length,1);
  const filtered=await collection({request:new Request(`${origin}/api/chemicals?companyId=${f.companyA}&status=without-msds&q=WD-40&departmentId=${f.departmentA}`,{headers:{Cookie:f.users.admin.cookie}}),env:{DB:f.db}});
  assert.equal((await filtered.json()).products.length,1);
  const absent=await collection({request:new Request(`${origin}/api/chemicals?companyId=${f.companyA}&status=with-msds`,{headers:{Cookie:f.users.admin.cookie}}),env:{DB:f.db}});
  assert.equal((await absent.json()).products.length,0);
});

test('current MSDS metadata is company-scoped, independently reviewed, and counted',async t=>{
  const f=await fixture(t),created=await create(f),now=new Date().toISOString(),id=created.data.productId;
  f.db.sqlite.prepare(`INSERT INTO chemical_msds_versions (id,company_id,product_id,version_no,storage_key,original_filename,size_bytes,is_current,uploaded_by,uploaded_at,review_status) VALUES (?,?,?,?,?,?,?,1,?,?,'UNREVIEWED')`).run(crypto.randomUUID(),f.companyA,id,1,'test-only-object','msds.pdf',100,f.users.admin.id,now);
  const detail=(await call(f,item,'reader',f.companyA,{params:{id}})).data;
  assert.equal(detail.product.currentVersionId,detail.versions[0].id);assert.equal(detail.product.reviewStatus,'UNREVIEWED');
  const summary=(await call(f,dashboard)).data.summary;assert.equal(summary.withMsds,1);assert.equal(summary.withoutMsds,0);assert.equal(summary.unreviewed,1);
  assert.equal((await call(f,item,'other',f.companyB,{params:{id}})).status,404);
  assert.equal((await call(f,versions,'manager',f.companyA,{method:'POST',params:{id}})).status,503);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM chemical_msds_versions').get().count,1);
});
