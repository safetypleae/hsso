import { readFileSync } from 'node:fs';
import { fixture, surveyPayload } from './risk-fixture.mjs';
import { DEFAULT_QUESTIONS } from '../../assets/risk/schema.js';
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1sAAAAASUVORK5CYII=', 'base64');
export function fakeR2() {
  const objects = new Map();
  return { objects, failPut: false, failDelete: false,
    async put(key, bytes, options) { if(this.failPut)throw new Error('R2 put unavailable');objects.set(key,{bytes:new Uint8Array(bytes),options});return {key}; },
    async get(key) { const value=objects.get(key);return value?{body:value.bytes}:null; },
    async delete(key) { if(this.failDelete)throw new Error('R2 delete unavailable');objects.delete(key); }
  };
}
export function applyRiskExtension(db) { db.sqlite.exec(readFileSync(new URL('../../migrations/0009_risk_survey_extensions.sql',import.meta.url),'utf8')); }
export async function extendedFixture(t) { const context=await fixture(t);applyRiskExtension(context.db);return {...context,env:{DB:context.db,RISK_PHOTOS:fakeR2()}}; }
export function extendedPayload() {return {...surveyPayload(),schemaVersion:2,companyName:'HSSO 회사',departments:['BM오션','BM환경'],questions:structuredClone(DEFAULT_QUESTIONS)};}
export function definedResponse(revision=1) {return {schemaVersion:2,revision,respondentName:'근로자',department:'BM오션',employeeId:'E1',isAnonymous:false,answers:{q1:'예',q2:['추락'],q3:'위험상황',q4:'현장',q5:{likelihood:5,severity:4},q6:'개선 의견',q7:{likelihood:2,severity:2}}};}
export async function invoke(handler,context,{method='GET',cookie=context.a?.cookie,id,token,responseId,photoId,data,query='',files,origin='https://local.example'}={}) {
  const headers={Origin:origin};if(cookie)headers.Cookie=cookie;
  let body;if(files){const form=new FormData();form.append('payload',JSON.stringify(data));for(const file of files)form.append('photos',file);body=form;}else if(data!==undefined){headers['Content-Type']='application/json';body=JSON.stringify(data);}
  const request=new Request('https://local.example/api/risk-surveys/'+(id||'')+query,{method,headers,body});
  const response=await handler({request,env:context.env||{DB:context.db},params:{id,token,responseId,photoId}});
  const type=response.headers.get('Content-Type')||'';return {response,status:response.status,data:type.includes('json')?await response.clone().json():null};
}
