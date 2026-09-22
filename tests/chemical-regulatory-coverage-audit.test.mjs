import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRegulatory } from '../server/regulatory-master-v1.js';

const row = (chemicalName, casValue, amountRaw, synonym = null, casStatus = 'KNOWN') => ({
  id: `${casValue || chemicalName}-${amountRaw}`,
  chemicalName, synonym, casValue, casStatus, amountRaw,
  tradeSecret: casStatus === 'TRADE_SECRET' ? 1 : 0,
  reviewStatus: 'REVIEWED',
});

export const auditDocuments = [
  { name:'02_BOILER MATE IS-102K MSDS.pdf', ingredients:[
    row('수산화 포타슘','1310-58-3','1~4.5','수산화 칼륨(K(OH)), 포타슘 하이드레이트'),
    row('Inorganic acid, alkali metal salt',null,'40 ~ 60','비공개승인','TRADE_SECRET'),
    row('에틸렌다이아민테트라아세트산 테트라소듐','64-02-8','1~10',"N,N'-1,2-에탄다이일비스(N-(카복시메틸)글라이신) 테트라소듐 염"),
  ], expected:['MATCH','REVIEW_REQUIRED','MATCH','REVIEW_REQUIRED'] },
  { name:'03_Zinc-COAT(N-30).pdf', ingredients:[
    row('Oxybismethane','115-10-6','20~30','Dimethyl ether'), row('Propane','74-98-6','5~10','Dimethylmethane'),
    row('Toluene','108-88-3','10~20','Methylbenzene'), row('MIBK','108-10-1','5~10','Hexone'),
    row('Modified Epoxy Resin','25068-38-6','10~20'), row('Silica','68611-44-9','1~2'), row('Zinc','7440-66-6','5~10'),
  ], expected:['MATCH','NO_MATCH','MATCH','MATCH'] },
  { name:'18_유니온 백시멘트 2.pdf', ingredients:[
    row('Limestone','1317-65-3','10~20'), row('돌로마이트(DOLOMITE)','16389-88-1','40~50','돌로크론(DOLOCRON)'),
    row('포틀랜드 시멘트','65997-15-1','50~60'),
  ], expected:['NO_MATCH','NO_MATCH','REVIEW_REQUIRED','REVIEW_REQUIRED'] },
  { name:'20_한일 포틀랜드시멘트 1종 msds.pdf', ingredients:[row('포틀랜드 시멘트','65997-15-1','100%')], expected:['NO_MATCH','NO_MATCH','REVIEW_REQUIRED','REVIEW_REQUIRED'] },
  { name:'D-200 건식 저점도 주입제 경화제.pdf', ingredients:[
    row('Fatty acids, tall oil reaction products with tetraethylenepentamine','68953-36-6','60~70'),
    row('Tetraethylenepentamine','112-57-2','7~12','테트라에틸렌펜타민'),
    row('2,4,6-Tris[(dimethylamino)methyl]phenol','90-72-2','8~13','2,4,6-트리스(다이메틸아미노메틸)페놀'),
    row('Hydrogenated hydrocarbons (C=6-20) polymers','69430-35-9','15~25','탄화수소, C6-20, 중합물, 수소처리된'),
  ], expected:['NO_MATCH','NO_MATCH','NO_MATCH','NO_MATCH'] },
  { name:'ECO-CLEAN (2023.06).pdf', ingredients:[
    row('트리톤 BG-10(TRITON BG-10)','68515-73-1','10','OHS24514'), row('물','7732-18-5','80','디수소 산화물'),
    row('폴리옥시에틸렌 (20) 소르비탄 모노라우르산염','9005-64-5','10','Oxyethylated sorbitan monolaurate'),
  ], expected:['NO_MATCH','NO_MATCH','NO_MATCH','NO_MATCH'] },
  { name:'HiBPAHCS2020.pdf', ingredients:[
    row('ALUMINUM CHLORIDE HYDROXIDE SULFATE','39290-78-3','29~31'), row('Water','7732-18-5','69~71'),
  ], expected:['MATCH','NO_MATCH','MATCH','MATCH'] },
  { name:'SUS-COAT L-316.pdf', ingredients:[
    row('철 (iron)','7439-89-6','1~5'), row('몰리브덴 (Molybdenum)','7439-98-7','0.01~0.1','MOLYBDATE'),
    row('니켈 (Nickel)','7440-02-0','0.1~0.5'), row('알루미늄 (Aluminium)','7429-90-5','1~10'),
    row('톨루엔 (Toluene)','108-88-3','20~30','메틸벤젠'), row('크실렌 (Xylene)','1330-20-7','1 ~ 10','디메틸벤젠'),
    row('변성에폭시수지 (Modified epoxy resin)','25068-38-6','5~15'), row('실리카 (Silica)','68611-44-9','0.1~1'),
    row('디메틸에테르 (Dimethyl ether)','115-10-6','35~45','메틸 에테르'),
  ], expected:['MATCH','NO_MATCH','MATCH','MATCH'] },
  { name:'T-308_msds 고려용접봉.pdf', ingredients:[
    row('철 (Iron)','7439-89-6','60-70','환원철'), row('크롬 (Chromium)','7440-47-3','19.5-22','Chromium metal'),
    row('니켈 (Nickel)','7440-02-0','9-11','Nickel metal'), row('망간 (Manganese)','7439-96-5','1-2.5','Manganese metal'),
  ], expected:['MATCH','NO_MATCH','MATCH','MATCH'] },
  { name:'고염기도 폴리염화알루미늄 (APACⅡ 1270).pdf', ingredients:[
    row('폴리염화알루미늄','1327-41-9','25~40','알루미늄 클로로수화물'), row('물','7732-18-5','60~75'),
  ], expected:['MATCH','NO_MATCH','MATCH','MATCH'] },
];

const categoryKeys=['MANAGED','SPECIAL_MANAGED','WORK_ENVIRONMENT','SPECIAL_HEALTH'];

test('seed 20260922 audit sample has exactly 10 products and 38 reviewed ingredients',()=>{
  assert.equal(auditDocuments.length,10);
  assert.equal(auditDocuments.reduce((sum,document)=>sum+document.ingredients.length,0),38);
});

test('new ten official ground-truth product states match after coverage reinforcement',()=>{
  for(const document of auditDocuments){
    const actual=evaluateRegulatory(document.ingredients).categories;
    assert.deepEqual(categoryKeys.map(key=>actual[key].state),document.expected,document.name);
    for(const ingredient of document.ingredients){
      const evidence=categoryKeys.flatMap(key=>[...actual[key].matches,...actual[key].reviews]).find(item=>item.ingredientId===ingredient.id);
      if(evidence)assert.equal(evidence.amountRaw,ingredient.amountRaw,`${document.name}: ${ingredient.casValue}`);
    }
  }
});

test('new ten leave no MASTER_GAP and classify every review reason',()=>{
  const allowed=new Set(['MASTER_GAP','GROUP_RULE','FORM_OR_SPECIES_REQUIRED','AMOUNT_AMBIGUOUS','TRADE_SECRET_OR_IDENTITY_UNKNOWN','EXPOSURE_OR_WORK_CONDITION','IDENTITY_NOT_REVIEWED']);
  for(const document of auditDocuments){
    const categories=evaluateRegulatory(document.ingredients).categories;
    const details=categoryKeys.flatMap(key=>categories[key].reviewDetails);
    assert(details.every(detail=>allowed.has(detail.code)),document.name);
    assert.equal(details.filter(detail=>detail.code==='MASTER_GAP').length,0,document.name);
  }
});

test('exact elemental-metal rules do not promote form-dependent categories',()=>{
  const zinc=evaluateRegulatory([row('Zinc','7440-66-6','5~10')]).categories;
  assert.equal(zinc.MANAGED.state,'MATCH');
  assert.equal(zinc.WORK_ENVIRONMENT.state,'REVIEW_REQUIRED');
  assert.equal(zinc.WORK_ENVIRONMENT.reviewDetails[0].code,'FORM_OR_SPECIES_REQUIRED');
  const iron=evaluateRegulatory([row('Iron','7439-89-6','60~70')]).categories;
  assert.equal(iron.MANAGED.state,'MATCH');
  assert.equal(iron.SPECIAL_MANAGED.state,'NO_MATCH');
  assert.equal(iron.SPECIAL_HEALTH.state,'REVIEW_REQUIRED');
});

test('unlisted exact substances stay NO_MATCH and mineral dust remains work-condition review',()=>{
  for(const cas of ['1305-62-0','74-98-6','115-10-6','112-57-2']){
    const result=evaluateRegulatory([row('audited exact identity',cas,'10')]).categories;
    assert(categoryKeys.every(key=>result[key].state==='NO_MATCH'),cas);
  }
  const cement=evaluateRegulatory([row('포틀랜드 시멘트','65997-15-1','100%')]).categories;
  assert.equal(cement.MANAGED.state,'NO_MATCH');
  assert.equal(cement.WORK_ENVIRONMENT.reviewDetails[0].code,'EXPOSURE_OR_WORK_CONDITION');
});

test('identified aluminum compounds match the legal group without name substring guessing',()=>{
  for(const [name,cas,amount] of [['ALUMINUM CHLORIDE HYDROXIDE SULFATE','39290-78-3','29~31'],['폴리염화알루미늄','1327-41-9','25~40']]){
    const categories=evaluateRegulatory([row(name,cas,amount)]).categories;
    assert.deepEqual(categoryKeys.map(key=>categories[key].state),['MATCH','NO_MATCH','MATCH','MATCH'],cas);
    assert.equal(categories.MANAGED.matches[0].matchBasis,'CAS');
  }
  const generic=evaluateRegulatory([row('알루미늄 및 그 화합물',null,'10',null,'ABSENT')]).categories;
  assert.equal(generic.MANAGED.state,'REVIEW_REQUIRED');
  assert.equal(generic.MANAGED.matches.length,0);
  assert(generic.MANAGED.reviewDetails.some(detail=>detail.code==='GROUP_RULE'));
});
