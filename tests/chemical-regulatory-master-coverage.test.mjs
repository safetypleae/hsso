import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateRegulatory,
  REGULATORY_COVERAGE_V1,
  REGULATORY_MASTER_V1,
  REGULATORY_OFFICIAL_ITEMS_V1,
} from '../server/regulatory-master-v1.js';

const categoryKeys = ['MANAGED','SPECIAL_MANAGED','WORK_ENVIRONMENT','SPECIAL_HEALTH'];
const row = (chemicalName, casValue, amountRaw, synonym = null, casStatus = 'KNOWN') => ({
  id:`${casValue || chemicalName}-${amountRaw}`,
  chemicalName,
  synonym,
  casValue,
  casStatus,
  amountRaw,
  tradeSecret:casStatus === 'TRADE_SECRET' ? 1 : 0,
  reviewStatus:'REVIEWED',
});

test('all official chemical items are classified with no catalog MASTER_GAP',()=>{
  assert.deepEqual(Object.fromEntries(categoryKeys.map(key => [key, REGULATORY_OFFICIAL_ITEMS_V1[key].length])), {
    MANAGED:173,
    SPECIAL_MANAGED:37,
    WORK_ENVIRONMENT:183,
    SPECIAL_HEALTH:164,
  });
  for (const category of categoryKeys) {
    const coverage = REGULATORY_COVERAGE_V1[category];
    assert.equal(coverage.MASTER_GAP,0,category);
    assert.equal(coverage.classifiedCoverage,1,category);
    assert.equal(coverage.EXACT_AUTOMATABLE + coverage.CONDITIONAL_AUTOMATABLE + coverage.LEGITIMATE_REVIEW_REQUIRED, coverage.officialItemCount, category);
    assert(REGULATORY_OFFICIAL_ITEMS_V1[category].every(item => item.classification && item.conditionText),category);
    assert(REGULATORY_OFFICIAL_ITEMS_V1[category].filter(item => item.classification === 'LEGITIMATE_REVIEW_REQUIRED').every(item => item.reasonCode && item.reasonCode !== 'MASTER_GAP'),category);
  }
});

test('every conditionally automatable official item has a category rule and valid CAS',()=>{
  const byId = new Map(REGULATORY_MASTER_V1.entries.map(entry => [entry.id,entry]));
  for (const category of categoryKeys) {
    for (const item of REGULATORY_OFFICIAL_ITEMS_V1[category].filter(value => value.classification === 'CONDITIONAL_AUTOMATABLE')) {
      assert.match(item.cas,/^\d{2,7}-\d{2}-\d$/,`${category}:${item.id}`);
      assert(byId.get(item.identityId)?.categories[category],`${category}:${item.id}`);
    }
  }
});

test('exact identity catalog has unique CAS identifiers and category-specific conditions',()=>{
  const identifiers = REGULATORY_MASTER_V1.entries.flatMap(entry => entry.identifiers.map(identifier => identifier.value));
  assert.equal(new Set(identifiers).size,identifiers.length);
  assert(REGULATORY_MASTER_V1.entries.length >= 200);
  for (const entry of REGULATORY_MASTER_V1.entries) {
    assert(entry.identifiers.every(identifier => /^\d{2,7}-\d{2}-\d$/.test(identifier.value)),entry.id);
    assert(Object.values(entry.categories).every(condition => condition.minimumPercent > 0),entry.id);
  }
});

test('every exact CAS identity matches each configured category at its own threshold',()=>{
  for (const entry of REGULATORY_MASTER_V1.entries) {
    for (const identifier of entry.identifiers) {
      for (const [category,condition] of Object.entries(entry.categories)) {
        const result=evaluateRegulatory([row('Catalog identity',identifier.value,String(condition.minimumPercent))]).categories;
        assert.equal(result[category].state,'MATCH',`${entry.id}:${identifier.value}:${category}`);
        assert(result[category].matches.some(match => match.casValue === identifier.value),`${entry.id}:${identifier.value}:${category}`);
      }
    }
  }
});

test('official English name and safe alias match exactly, not by substring',()=>{
  const official=evaluateRegulatory([row('Glutaraldehyde',null,'2',null,'ABSENT')]).categories;
  assert.equal(official.MANAGED.state,'MATCH');
  assert.equal(official.MANAGED.matches[0].matchBasis,'법령상 물질명/동의어');

  const alias=evaluateRegulatory([row('Methylbenzene',null,'2',null,'ABSENT')]).categories;
  assert.equal(alias.MANAGED.state,'MATCH');

  const substring=evaluateRegulatory([row('Unlisted benzene derivative',null,'100',null,'ABSENT')]).categories;
  assert.equal(substring.MANAGED.matches.length,0);
  assert.equal(substring.SPECIAL_MANAGED.matches.length,0);

  const unleaded=evaluateRegulatory([row('Unleaded gasoline additive',null,'100',null,'ABSENT')]).categories;
  assert(!unleaded.MANAGED.reviewDetails.some(detail => detail.code === 'GROUP_RULE'));
});

test('group names never become exact MATCH without a safely identified member',()=>{
  const result=evaluateRegulatory([row('니켈 화합물',null,'10',null,'ABSENT')]).categories;
  assert(categoryKeys.every(key => result[key].matches.length === 0));
  assert.equal(result.SPECIAL_MANAGED.state,'REVIEW_REQUIRED');
  assert(result.SPECIAL_MANAGED.reviewDetails.some(detail => detail.code === 'FORM_OR_SPECIES_REQUIRED'));
});

test('category membership is independent rather than copied between lists',()=>{
  const sodium=evaluateRegulatory([row('Sodium hydroxide','1310-73-2','5')]).categories;
  assert.deepEqual(categoryKeys.map(key => sodium[key].state),['MATCH','NO_MATCH','MATCH','NO_MATCH']);

  const gasoline=evaluateRegulatory([row('Gasoline','8006-61-9','5')]).categories;
  assert.deepEqual(categoryKeys.map(key => gasoline[key].state),['NO_MATCH','NO_MATCH','NO_MATCH','MATCH']);

  const dehp=evaluateRegulatory([row('Di(2-ethylhexyl) phthalate','117-81-7','5')]).categories;
  assert.deepEqual(categoryKeys.map(key => dehp[key].state),['MATCH','NO_MATCH','NO_MATCH','NO_MATCH']);

  const pcp=evaluateRegulatory([row('Pentachlorophenol','87-86-5','5')]).categories;
  assert.deepEqual(categoryKeys.map(key => pcp[key].state),['NO_MATCH','NO_MATCH','MATCH','MATCH']);

  const ammonia=evaluateRegulatory([row('Ammonia','7664-41-7','5')]).categories;
  assert.deepEqual(categoryKeys.map(key => ammonia[key].state),['MATCH','NO_MATCH','MATCH','NO_MATCH']);
});

test('ordinary, special 0.1, special 0.3, lead 0.3 and permit 0.5 thresholds are separate',()=>{
  const tolueneBelow=evaluateRegulatory([row('Toluene','108-88-3','0.99')]).categories;
  assert.equal(tolueneBelow.MANAGED.state,'NO_MATCH');
  const tolueneAt=evaluateRegulatory([row('Toluene','108-88-3','1')]).categories;
  assert.equal(tolueneAt.MANAGED.state,'MATCH');

  const benzeneBelow=evaluateRegulatory([row('Benzene','71-43-2','0.09')]).categories;
  assert.equal(benzeneBelow.MANAGED.state,'NO_MATCH');
  assert.equal(benzeneBelow.SPECIAL_MANAGED.state,'NO_MATCH');
  const benzeneAt=evaluateRegulatory([row('Benzene','71-43-2','0.1')]).categories;
  assert.equal(benzeneAt.MANAGED.state,'MATCH');
  assert.equal(benzeneAt.SPECIAL_MANAGED.state,'MATCH');

  const dmfBoundary=evaluateRegulatory([row('Dimethylformamide','68-12-2','0.2~0.4')]).categories;
  assert.equal(dmfBoundary.MANAGED.state,'REVIEW_REQUIRED');
  assert.equal(dmfBoundary.SPECIAL_MANAGED.state,'REVIEW_REQUIRED');
  assert(dmfBoundary.SPECIAL_MANAGED.reviewDetails.some(detail => detail.code === 'AMOUNT_AMBIGUOUS'));

  const leadBelow=evaluateRegulatory([row('Lead','7439-92-1','0.29')]).categories;
  assert.equal(leadBelow.MANAGED.state,'NO_MATCH');
  assert.equal(leadBelow.SPECIAL_MANAGED.state,'NO_MATCH');
  const leadAt=evaluateRegulatory([row('Lead','7439-92-1','0.3')]).categories;
  assert.equal(leadAt.MANAGED.state,'MATCH');
  assert.equal(leadAt.SPECIAL_MANAGED.state,'MATCH');

  const permitBelow=evaluateRegulatory([row('Benzotrichloride','98-07-7','0.49')]).categories;
  assert.equal(permitBelow.WORK_ENVIRONMENT.state,'NO_MATCH');
  const permitAt=evaluateRegulatory([row('Benzotrichloride','98-07-7','0.5')]).categories;
  assert.equal(permitAt.WORK_ENVIRONMENT.state,'MATCH');
  assert.equal(permitAt.SPECIAL_HEALTH.state,'MATCH');

  const zincChromate=evaluateRegulatory([row('Zinc chromate','13530-65-9','0.1')]).categories;
  assert.equal(zincChromate.MANAGED.state,'MATCH');
  assert.equal(zincChromate.SPECIAL_MANAGED.state,'MATCH');
});

test('special-managed form conditions remain review instead of unsafe exact matches',()=>{
  const sulfuricConditional=evaluateRegulatory([row('Sulfuric acid','7664-93-9','0.5')]).categories;
  assert.equal(sulfuricConditional.MANAGED.state,'REVIEW_REQUIRED');
  assert.equal(sulfuricConditional.SPECIAL_MANAGED.state,'REVIEW_REQUIRED');

  const sulfuric=evaluateRegulatory([row('Sulfuric acid','7664-93-9','5')]).categories;
  assert.equal(sulfuric.MANAGED.state,'MATCH');
  assert.equal(sulfuric.SPECIAL_MANAGED.state,'REVIEW_REQUIRED');
  assert(sulfuric.SPECIAL_MANAGED.reviewDetails.some(detail => detail.code === 'FORM_OR_SPECIES_REQUIRED'));

  const chromium=evaluateRegulatory([row('Chromium','7440-47-3','10')]).categories;
  assert.equal(chromium.MANAGED.state,'MATCH');
  assert.equal(chromium.SPECIAL_MANAGED.state,'NO_MATCH');
  assert.equal(chromium.SPECIAL_MANAGED.matches.length,0);
});

test('official form-dependent CAS is recognized as review even with an unhelpful name',()=>{
  const zincOxide=evaluateRegulatory([row('Confidentially named solid','1314-13-2','10')]).categories;
  assert.equal(zincOxide.WORK_ENVIRONMENT.state,'REVIEW_REQUIRED');
  assert(zincOxide.WORK_ENVIRONMENT.reviewDetails.some(detail => detail.code === 'FORM_OR_SPECIES_REQUIRED'));
  assert(!zincOxide.WORK_ENVIRONMENT.reviewDetails.some(detail => detail.code === 'MASTER_GAP'));
});
