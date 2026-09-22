import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRegulatory } from '../server/regulatory-master-v1.js';

const row=(chemicalName,synonym,casValue,amountRaw)=>({chemicalName,synonym,casValue,amountRaw,casStatus:'KNOWN',tradeSecret:0,reviewStatus:'REVIEWED'});
const selected=[
  {name:'08_Cubitron II Flexible Grinding Wheel 제출번호 X.pdf',ingredients:[row('무기 불소',null,'60304-36-1','5 - 9.9'),row('이산화 티타늄','C.I. 77891','13463-67-7','0.1 - 1')],expected:['REVIEW_REQUIRED','NO_MATCH','REVIEW_REQUIRED','NO_MATCH']},
  {name:'06_대한염업상사 정제소금.pdf',ingredients:[row('Sodium chloride','Sodium chloride','7647-14-5','99')],expected:['NO_MATCH','NO_MATCH','NO_MATCH','NO_MATCH']},
  {name:'04_CSW-0026_MSDS_용접재료.pdf',ingredients:[],expected:['REVIEW_REQUIRED','REVIEW_REQUIRED','REVIEW_REQUIRED','REVIEW_REQUIRED']},
  {name:'01_니크론-70T.pdf',ingredients:[row('차아염소산 칼슘','Calcium hypochlorite','7778-54-3','70% 이상 (유효염소로써)'),row('수산화 칼슘','Calcium hydroxide','1305-62-0','1 - 5 %'),row('순수',null,'7732-18-5','9 - 16%')],expected:['NO_MATCH','NO_MATCH','NO_MATCH','NO_MATCH']},
  {name:'05_13_LOV HS락카 흑색_GHS국문.pdf',ingredients:[row('Nitrocellulose','나이트로셀룰로스','9004-70-0','11 이상 ~ 20 % 미만'),row('Coconut oil polymer with benzoic acid, glycerol and phthalic anhydride',null,'68038-05-1','11 이상 ~ 20 % 미만'),row('Acetone','아세톤','67-64-1','1 이상 ~ 10 % 미만'),row('1,4-Benzenedicarboxylic acid bis(2-ethylhexyl) ester','디옥틸 테레프탈산','6422-86-2','1 이상 ~ 10 % 미만'),row('Dimethyl carbonate','탄산 다이메틸','616-38-6','1 이상 ~ 10 % 미만'),row('Carbon black','카본 블랙','1333-86-4','1 이상 ~ 10 % 미만'),row('Xylene','자일렌 ; 다이메틸벤젠','1330-20-7','1 이상 ~ 5 % 미만'),row('Toluene','톨루엔','108-88-3','21 이상 ~ 24 % 미만'),row('4-Methyl-2-pentanone','4-메틸-2-펜탄온','108-10-1','11 이상 ~ 20 % 미만'),row('Ethylbenzene','에틸벤젠','100-41-4','1 이상 ~ 10 % 미만')],expected:['MATCH','NO_MATCH','MATCH','MATCH']}
];

test('seed 20260922 random five: stored reviewed ingredients match the recorded ground truth',()=>{
  const keys=['MANAGED','SPECIAL_MANAGED','WORK_ENVIRONMENT','SPECIAL_HEALTH'];
  for(const document of selected){
    const actual=evaluateRegulatory(document.ingredients).categories;
    assert.deepEqual(keys.map(key=>actual[key].state),document.expected,document.name);
    for(const ingredient of document.ingredients){
      const evidence=keys.flatMap(key=>[...actual[key].matches,...actual[key].reviews]).find(item=>item.casValue===ingredient.casValue);
      if(evidence)assert.equal(evidence.amountRaw,ingredient.amountRaw,`${document.name}: ${ingredient.casValue}`);
    }
  }
});
