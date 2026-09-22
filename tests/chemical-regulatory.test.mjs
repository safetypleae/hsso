import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRegulatory, REGULATORY_MASTER_VERSION } from '../server/regulatory-master-v1.js';

const ingredient=(override={})=>({id:'i1',chemicalName:'Toluene',synonym:'Methylbenzene',casValue:'108-88-3',casStatus:'KNOWN',amountRaw:'10~20%',tradeSecret:0,reviewStatus:'REVIEWED',...override});

test('exact CAS match preserves amountRaw and legal evidence',()=>{
  const result=evaluateRegulatory([ingredient()],{versionId:'v1'});
  assert.equal(result.masterVersion,REGULATORY_MASTER_VERSION);
  assert.equal(result.versionId,'v1');
  for(const category of ['MANAGED','WORK_ENVIRONMENT','SPECIAL_HEALTH'])assert.equal(result.categories[category].state,'MATCH');
  assert.equal(result.categories.MANAGED.matches[0].amountRaw,'10~20%');
  assert.match(result.categories.MANAGED.matches[0].legalBasis,/별표 12/);
  assert.equal(result.categories.SPECIAL_MANAGED.state,'NO_MATCH');
});

test('legal name and alias match when CAS is unavailable, but identity remains reviewable',()=>{
  const result=evaluateRegulatory([ingredient({chemicalName:'메틸벤젠',synonym:'',casValue:null,casStatus:'ABSENT'})]);
  assert.equal(result.categories.MANAGED.state,'MATCH');
  assert.equal(result.categories.MANAGED.matches[0].matchBasis,'법령상 물질명/동의어');
  assert(result.categories.MANAGED.reviewReasons.some(reason=>reason.includes('CAS')));
});

test('known non-regulated identity is NO_MATCH',()=>{
  const result=evaluateRegulatory([ingredient({chemicalName:'Sodium chloride',synonym:'염화나트륨',casValue:'7647-14-5',amountRaw:'99'})]);
  for(const value of Object.values(result.categories))assert.equal(value.state,'NO_MATCH');
});

test('uncovered known CAS is explicitly classified as MASTER_GAP',()=>{
  const result=evaluateRegulatory([ingredient({chemicalName:'법정 전체 audit 미등록 물질',synonym:'',casValue:'99999-99-9',amountRaw:'10'})]);
  for(const value of Object.values(result.categories)){
    assert.equal(value.state,'REVIEW_REQUIRED');
    assert(value.reviewDetails.some(detail=>detail.code==='MASTER_GAP'));
  }
});

test('group clauses, trade secrets, absent CAS and ambiguous amounts prefer REVIEW_REQUIRED',()=>{
  const group=evaluateRegulatory([ingredient({chemicalName:'Silica',synonym:'실리카',casValue:'68611-44-9',amountRaw:'5 - 9.9'})]);
  assert.equal(group.categories.WORK_ENVIRONMENT.state,'REVIEW_REQUIRED');
  assert.equal(group.categories.WORK_ENVIRONMENT.reviews[0].reasonCode,'FORM_OR_SPECIES_REQUIRED');
  const secret=evaluateRegulatory([ingredient({chemicalName:'영업비밀 성분',synonym:'',casValue:null,casStatus:'TRADE_SECRET',tradeSecret:1,amountRaw:'1~3'})]);
  for(const value of Object.values(secret.categories))assert.equal(value.state,'REVIEW_REQUIRED');
  const amount=evaluateRegulatory([ingredient({amountRaw:'0.1~1% 미만'})]);
  assert.equal(amount.categories.MANAGED.state,'NO_MATCH');
});

test('unreviewed or empty compositions cannot become NO_MATCH and version is traceable',()=>{
  const pending=evaluateRegulatory([ingredient({reviewStatus:'AUTO_EXTRACTED'})],{versionId:'current-v2'});
  assert.equal(pending.versionId,'current-v2');
  for(const value of Object.values(pending.categories))assert.equal(value.state,'REVIEW_REQUIRED');
  const empty=evaluateRegulatory([]);
  for(const value of Object.values(empty.categories))assert.equal(value.state,'REVIEW_REQUIRED');
});

test('special-management substance-specific concentration threshold is retained',()=>{
  const below=evaluateRegulatory([ingredient({chemicalName:'DMF',synonym:'N,N-Dimethylformamide',casValue:'68-12-2',amountRaw:'0.1~0.2%'})]);
  assert.equal(below.categories.SPECIAL_MANAGED.state,'NO_MATCH');
  const atThreshold=evaluateRegulatory([ingredient({chemicalName:'DMF',synonym:'N,N-Dimethylformamide',casValue:'68-12-2',amountRaw:'0.3%'})]);
  assert.equal(atThreshold.categories.SPECIAL_MANAGED.state,'MATCH');
  assert.equal(atThreshold.categories.SPECIAL_MANAGED.matches[0].conditionText,'혼합물 중 0.3% 이상');

  const defaultBelow=evaluateRegulatory([ingredient({chemicalName:'Formaldehyde',synonym:'포름알데히드',casValue:'50-00-0',amountRaw:'0.09%'})]);
  assert.equal(defaultBelow.categories.SPECIAL_MANAGED.state,'NO_MATCH');
  const defaultAtThreshold=evaluateRegulatory([ingredient({chemicalName:'Formaldehyde',synonym:'포름알데히드',casValue:'50-00-0',amountRaw:'0.1%'})]);
  assert.equal(defaultAtThreshold.categories.SPECIAL_MANAGED.state,'MATCH');
  assert.equal(defaultAtThreshold.categories.SPECIAL_MANAGED.matches[0].conditionText,'혼합물 중 0.1% 이상');
});
