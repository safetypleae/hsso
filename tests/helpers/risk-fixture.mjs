import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDB } from './d1-memory.mjs';
import { onRequest as signup } from '../../functions/api/auth/signup.js';
import { onRequest as login } from '../../functions/api/auth/login.js';
import { surveyCollection, surveyItem, publicSurvey, publicResponses, adminResponses, adminResponseItem, responseCsv } from '../../server/risk-surveys.js';

export const origin='https://local.example';
export const surveyPayload=()=>({title:'2026년 위험성평가',target:'시설팀',startDate:'2020-01-01',endDate:'2099-12-31',guidance:'안전 의견을 작성해주세요.',settings:{collectName:true,collectDepartment:true,collectEmployeeId:true,allowAnonymous:true,allowDuplicates:false,allowEdit:false,allowPhoto:true},questions:[{id:'q1',type:'yes_no',text:'위험요인이 있습니까?',options:['예','아니오']}],isActive:true});
export const responsePayload=()=>({respondentName:'홍길동',department:'시설팀',employeeId:'A-1',isAnonymous:false,hasHazard:true,hazardTypes:['추락'],hazardDescription:'사다리 위험',location:'창고',preLikelihood:5,preSeverity:4,improvementSuggestion:'난간 설치',postLikelihood:2,postSeverity:2,safeReason:''});

export async function fixture(t){const db=createTestDB();t.after(()=>db.close());for(const migration of ['0002_saved_documents.sql','0003_risk_assessment.sql'])db.sqlite.exec(readFileSync(new URL('../../migrations/'+migration,import.meta.url),'utf8'));const accounts=[];for(const email of ['risk-one@example.com','risk-two@example.com']){const input={email,password:'fixture password',name:'테스터',companyName:'회사',departmentName:'부서',position:'직급'};const request=()=>new Request(origin+'/api/auth/test',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal((await signup({request:request(),env:{DB:db}})).status,201);const response=await login({request:request(),env:{DB:db}});const user=(await response.json()).user;accounts.push({id:user.id,cookie:response.headers.get('set-cookie').split(';')[0]});}return{db,a:accounts[0],b:accounts[1]};}

export async function call(handler,db,{cookie,method='GET',path='/api/risk-surveys',params={},data,raw,requestOrigin=origin,contentType='application/json'}={}){const headers={};if(cookie)headers.Cookie=cookie;if(requestOrigin!==null)headers.Origin=requestOrigin;if(contentType)headers['Content-Type']=contentType;const init={method,headers};if(['POST','PATCH'].includes(method))init.body=raw??JSON.stringify(data);const response=await handler({request:new Request(origin+path,init),env:{DB:db},params});const copy=response.clone(),type=response.headers.get('content-type')||'';return{response,status:response.status,data:type.includes('json')?await copy.json():await copy.text()};}
export async function createSurvey(db,account,input=surveyPayload()){const result=await call(surveyCollection,db,{cookie:account.cookie,method:'POST',data:input});assert.equal(result.status,201);return result.data.survey;}
export { surveyCollection,surveyItem,publicSurvey,publicResponses,adminResponses,adminResponseItem,responseCsv };
