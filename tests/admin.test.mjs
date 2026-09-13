import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDB } from './helpers/d1-memory.mjs';
import { hashToken } from '../server/auth-session.js';
import { requireAdmin } from '../server/admin-auth.js';
import { onRequest as me } from '../functions/api/auth/me.js';
import { boardCollection, boardItem } from '../server/boards.js';
import { inquiryCollection, inquiryItem, adminInquiryCollection, adminInquiryItem, adminInquiryAnswer } from '../server/inquiries.js';

const origin='https://local.example';
function request(path, {cookie,method='GET',data,requestOrigin=origin}={}) {
  return new Request(origin+path,{method,headers:{Origin:requestOrigin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(['GET','HEAD'].includes(method)?{}:{body:JSON.stringify(data??{})})});
}
async function call(handler,db,options={}) {
  const response=await handler({request:request(options.path||'/api/admin/inquiries',options),env:{DB:db},params:{id:options.id}});
  assert.equal(response.headers.get('cache-control'),'no-store');
  return {status:response.status,data:await response.json()};
}
async function fixture(t) {
  const db=createTestDB();t.after(()=>db.close());
  for(const file of ['0004_boards','0005_inquiries','0007_inquiry_answers'])db.sqlite.exec(readFileSync(new URL(`../migrations/${file}.sql`,import.meta.url),'utf8'));
  const users=[];
  for(const name of ['admin','owner','other']) {
    const id=crypto.randomUUID(),token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
    db.sqlite.prepare('INSERT INTO users (id,email,password_hash,name,company_name,department_name,position) VALUES (?,?,?,?,?,?,?)').run(id,name+'@example.test','unused',name,'company','department','position');
    db.sqlite.prepare('INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').run(crypto.randomUUID(),id,await hashToken(token),new Date(Date.now()+3600000).toISOString());
    users.push({id,cookie:'hsso_session='+token});
  }
  const [admin,owner,other]=users,now=new Date().toISOString();
  db.sqlite.prepare('INSERT INTO user_roles VALUES (?,?,?,?)').run(admin.id,'admin',now,now);
  const inquiry=await call(inquiryCollection,db,{cookie:owner.cookie,method:'POST',data:{title:'private inquiry',content:'private content'}});
  assert.equal(inquiry.status,201);
  return {db,admin,owner,other,id:inquiry.data.inquiry.id};
}
const notice={boardType:'notice',title:'Notice',content:'Notice content'};
async function createNotice(db,admin) {
  const result=await call(boardCollection,db,{cookie:admin.cookie,method:'POST',data:notice});
  assert.equal(result.status,201);return result.data.post.id;
}

test('admin endpoints reject anonymous requests with 401',async t=>{
  const {db,id}=await fixture(t);
  for(const [handler,method] of [[adminInquiryCollection,'GET'],[adminInquiryItem,'GET'],[adminInquiryAnswer,'PUT']])assert.equal((await call(handler,db,{id,method})).status,401);
});
test('admin endpoints reject ordinary sessions with 403',async t=>{
  const {db,owner,id}=await fixture(t);
  for(const [handler,method] of [[adminInquiryCollection,'GET'],[adminInquiryItem,'GET'],[adminInquiryAnswer,'PUT']])assert.equal((await call(handler,db,{id,method,cookie:owner.cookie})).status,403);
});
test('admin helper uses the authenticated user ID and admits a stored admin',async t=>{
  const {db,admin}=await fixture(t);
  assert.deepEqual(await requireAdmin(request('/api/admin/inquiries',{cookie:admin.cookie}),{DB:db}),{userId:admin.id});
});
for(const spoof of ['isAdmin','user_id','role'])test(`untrusted body ${spoof} cannot grant admin access`,async t=>{
  const {db,owner,admin,id}=await fixture(t),data={content:'injected',isAdmin:true,user_id:admin.id,role:'admin'};
  assert.equal((await call(adminInquiryAnswer,db,{id,cookie:owner.cookie,method:'PUT',data:{content:data.content,[spoof]:data[spoof]}})).status,403);
  assert.equal((await call(boardCollection,db,{cookie:owner.cookie,method:'POST',data:{...notice,[spoof]:data[spoof]}})).status,403);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM inquiry_answers').get().n,0);
});
test('role lookup failure closes admin APIs and /me without leaking SQL',async t=>{
  const {db,admin,id}=await fixture(t),prepare=db.prepare.bind(db);
  db.prepare=sql=>{if(sql.includes('user_roles'))throw new Error('private role SQL');return prepare(sql);};
  for(const [handler,method] of [[adminInquiryCollection,'GET'],[adminInquiryAnswer,'PUT'],[me,'GET']]){
    const result=await call(handler,db,{id,method,cookie:admin.cookie,data:{content:'answer'}});
    assert.equal(result.status,500);assert.deepEqual(result.data,{ok:false,error:'INTERNAL_SERVER_ERROR'});
  }
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM inquiry_answers').get().n,0);
});
test('/me exposes server role while retaining the public user fields',async t=>{
  const {db,admin,owner}=await fixture(t);
  for(const [user,role] of [[admin,'admin'],[owner,'user']]){
    const result=await call(me,db,{cookie:user.cookie});assert.equal(result.status,200);assert.equal(result.data.role,role);
    assert.deepEqual(Object.keys(result.data.user).sort(),['id','email','name','companyName','departmentName','position'].sort());
  }
});
test('expired, revoked, malformed and forged sessions cannot use an admin role',async t=>{
  const {db,admin}=await fixture(t);
  assert.equal((await call(adminInquiryCollection,db,{cookie:'hsso_session='+'a'.repeat(64),path:'/api/admin/inquiries?role=admin&user_id='+admin.id})).status,401);
  db.sqlite.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').run(new Date(0).toISOString(),admin.id);
  assert.equal((await call(adminInquiryCollection,db,{cookie:admin.cookie})).status,401);
});
test('role revocation takes effect on the next request',async t=>{
  const {db,admin}=await fixture(t);
  assert.equal((await call(adminInquiryCollection,db,{cookie:admin.cookie})).status,200);
  db.sqlite.prepare('DELETE FROM user_roles WHERE user_id=?').run(admin.id);
  assert.equal((await call(adminInquiryCollection,db,{cookie:admin.cookie})).status,403);
});
test('ordinary user cannot create a notice',async t=>{
  const {db,owner}=await fixture(t);assert.equal((await call(boardCollection,db,{cookie:owner.cookie,method:'POST',data:notice})).status,403);
});
test('admin creates notice using only the session author',async t=>{
  const {db,admin,owner}=await fixture(t);
  const result=await call(boardCollection,db,{cookie:admin.cookie,method:'POST',data:{...notice,user_id:owner.id,authorUserId:owner.id}});
  assert.equal(result.status,201);assert.equal(result.data.post.boardType,'notice');
  assert.equal(db.sqlite.prepare('SELECT author_user_id FROM board_posts WHERE id=?').get(result.data.post.id).author_user_id,admin.id);
});
test('admin patches a notice and client cannot change board type',async t=>{
  const {db,admin}=await fixture(t),id=await createNotice(db,admin);
  const result=await call(boardItem,db,{id,cookie:admin.cookie,method:'PATCH',data:{title:'Updated',content:'New',boardType:'free'}});
  assert.equal(result.status,200);assert.equal(result.data.post.title,'Updated');assert.equal(result.data.post.boardType,'notice');assert.equal(result.data.post.canEdit,true);assert.equal(result.data.post.canDelete,true);
});
test('admin deletes only the targeted notice',async t=>{
  const {db,admin}=await fixture(t),id=await createNotice(db,admin),other=await createNotice(db,admin);
  assert.equal((await call(boardItem,db,{id,cookie:admin.cookie,method:'DELETE'})).status,200);
  assert.equal(db.sqlite.prepare('SELECT id FROM board_posts WHERE id=?').get(id),undefined);
  assert(db.sqlite.prepare('SELECT id FROM board_posts WHERE id=?').get(other));
});
test('ordinary notice PATCH and DELETE are 403; anonymous mutations are 401',async t=>{
  const {db,admin,owner}=await fixture(t),id=await createNotice(db,admin);
  for(const method of ['PATCH','DELETE']){
    assert.equal((await call(boardItem,db,{id,method,cookie:owner.cookie,data:notice})).status,403);
    assert.equal((await call(boardItem,db,{id,method,data:notice})).status,401);
  }
});
test('free board retains user creation, owner editing, and no admin override or deletion',async t=>{
  const {db,admin,owner}=await fixture(t);
  const created=await call(boardCollection,db,{cookie:owner.cookie,method:'POST',data:{...notice,boardType:'free'}});assert.equal(created.status,201);
  const id=created.data.post.id;
  assert.equal((await call(boardItem,db,{id,cookie:owner.cookie,method:'PATCH',data:notice})).status,200);
  assert.equal((await call(boardItem,db,{id,cookie:admin.cookie,method:'PATCH',data:notice})).status,404);
  assert.equal((await call(boardItem,db,{id,cookie:admin.cookie,method:'DELETE'})).status,403);
});
test('notice is publicly readable without exposing admin controls',async t=>{
  const {db,admin}=await fixture(t),id=await createNotice(db,admin);
  const result=await call(boardItem,db,{id});assert.equal(result.status,200);assert.equal(result.data.post.canEdit,false);assert.equal(result.data.post.canDelete,false);
});
test('ordinary inquiry API remains owner-only even for an admin',async t=>{
  const {db,owner,other,admin,id}=await fixture(t);
  assert.equal((await call(inquiryItem,db,{id,cookie:owner.cookie})).status,200);
  for(const user of [other,admin])assert.equal((await call(inquiryItem,db,{id,cookie:user.cookie})).status,404);
  assert.equal((await call(inquiryCollection,db,{cookie:other.cookie})).data.total,0);
});
test('admin reads inquiries across owners with status filtering and pagination',async t=>{
  const {db,admin,other,id}=await fixture(t);
  await call(inquiryCollection,db,{cookie:other.cookie,method:'POST',data:{title:'Second',content:'Other owner'}});
  const result=await call(adminInquiryCollection,db,{cookie:admin.cookie,path:'/api/admin/inquiries?limit=1&status=waiting'});
  assert.equal(result.status,200);assert.equal(result.data.total,2);assert.equal(result.data.hasMore,true);assert.equal(result.data.inquiries.length,1);
  const detail=await call(adminInquiryItem,db,{id,cookie:admin.cookie});assert.equal(detail.status,200);assert.equal(detail.data.inquiry.content,'private content');assert.equal(detail.data.inquiry.answer,null);
  assert.equal((await call(adminInquiryCollection,db,{cookie:admin.cookie,path:'/api/admin/inquiries?status=invalid'})).status,400);
});
test('admin answer is stored with trusted author and changes status to answered',async t=>{
  const {db,admin,owner,id}=await fixture(t);
  const result=await call(adminInquiryAnswer,db,{id,cookie:admin.cookie,method:'PUT',data:{content:'Answer',admin_user_id:owner.id,inquiry_id:crypto.randomUUID()}});
  assert.equal(result.status,200);assert.equal(result.data.answer.content,'Answer');
  const row=db.sqlite.prepare('SELECT * FROM inquiry_answers WHERE inquiry_id=?').get(id);assert.equal(row.admin_user_id,admin.id);
  assert.equal(db.sqlite.prepare('SELECT status FROM inquiry_posts WHERE id=?').get(id).status,'answered');
  assert.equal((await call(adminInquiryCollection,db,{cookie:admin.cookie,path:'/api/admin/inquiries?status=answered'})).data.total,1);
  const own=await call(inquiryItem,db,{id,cookie:owner.cookie});assert.equal(own.data.inquiry.answer.content,'Answer');
});
test('answer editing keeps one row and preserves creation identity',async t=>{
  const {db,admin,id}=await fixture(t);
  const options={id,cookie:admin.cookie,method:'PUT'},first=await call(adminInquiryAnswer,db,{...options,data:{content:'First'}}),second=await call(adminInquiryAnswer,db,{...options,data:{content:'Edited'}});
  assert.equal(second.status,200);assert.equal(second.data.answer.id,first.data.answer.id);assert.equal(second.data.answer.createdAt,first.data.answer.createdAt);assert.equal(second.data.answer.content,'Edited');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM inquiry_answers').get().n,1);
});
test('answer status failure rolls back insertion and editing atomically',async t=>{
  const {db,admin,id}=await fixture(t),options={id,cookie:admin.cookie,method:'PUT',data:{content:'New'}};
  const trigger="CREATE TRIGGER reject_answer_status BEFORE UPDATE ON inquiry_posts BEGIN SELECT RAISE(ABORT, 'simulated status failure'); END;";
  db.sqlite.exec(trigger);
  assert.equal((await call(adminInquiryAnswer,db,options)).status,500);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM inquiry_answers').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT status FROM inquiry_posts WHERE id=?').get(id).status,'waiting');
  db.sqlite.exec('DROP TRIGGER reject_answer_status');
  assert.equal((await call(adminInquiryAnswer,db,options)).status,200);
  db.sqlite.exec(trigger);
  assert.equal((await call(adminInquiryAnswer,db,{...options,data:{content:'Must rollback'}})).status,500);
  assert.equal(db.sqlite.prepare('SELECT content FROM inquiry_answers WHERE inquiry_id=?').get(id).content,'New');
});
test('admin mutations reject cross-origin requests and invalid answers',async t=>{
  const {db,admin,id}=await fixture(t),postId=await createNotice(db,admin);
  for(const method of ['PATCH','DELETE'])assert.equal((await call(boardItem,db,{id:postId,cookie:admin.cookie,method,data:notice,requestOrigin:'https://evil.example'})).status,403);
  assert.equal((await call(adminInquiryAnswer,db,{id,cookie:admin.cookie,method:'PUT',data:{content:'X'},requestOrigin:'https://evil.example'})).status,403);
  for(const content of ['', ' '.repeat(2),'x'.repeat(10001)])assert.equal((await call(adminInquiryAnswer,db,{id,cookie:admin.cookie,method:'PUT',data:{content}})).status,400);
  assert.equal((await call(adminInquiryAnswer,db,{id:crypto.randomUUID(),cookie:admin.cookie,method:'PUT',data:{content:'Missing'}})).status,404);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM inquiry_answers').get().n,0);
});
