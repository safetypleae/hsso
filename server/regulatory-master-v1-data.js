// Official chemical-item catalog transcribed from the current Korean statutes.
// Keep this file data-only: matching and amount decisions live in regulatory-master-v1.js.

export const CLASSIFICATION = Object.freeze({
  EXACT: 'EXACT_AUTOMATABLE',
  CONDITIONAL: 'CONDITIONAL_AUTOMATABLE',
  REVIEW: 'LEGITIMATE_REVIEW_REQUIRED',
});

const lines = text => text.trim().split('\n').map(line => {
  const [id, legalName, englishName, cas, flags = ''] = line.split('|');
  return { id, legalName, englishName, cas, flags: new Set(flags.split(',').filter(Boolean)) };
});

const managedOrganics = lines(`
glutaraldehyde|글루타르알데히드|Glutaraldehyde|111-30-8
nitroglycerin|니트로글리세린|Nitroglycerin|55-63-0
nitromethane|니트로메탄|Nitromethane|75-52-5
nitrobenzene|니트로벤젠|Nitrobenzene|98-95-3
p-nitroaniline|p-니트로아닐린|p-Nitroaniline|100-01-6
p-nitrochlorobenzene|p-니트로클로로벤젠|p-Nitrochlorobenzene|100-00-5
dehp|디(2-에틸헥실)프탈레이트|Di(2-ethylhexyl) phthalate|117-81-7
dinitrotoluene|디니트로톨루엔|Dinitrotoluene|25321-14-6|isomer_group
n-n-dimethylaniline|N,N-디메틸아닐린|N,N-Dimethylaniline|121-69-7
dimethylamine|디메틸아민|Dimethylamine|124-40-3
dimethylacetamide|N,N-디메틸아세트아미드|N,N-Dimethylacetamide|127-19-5
dimethylformamide|디메틸포름아미드|Dimethylformamide|68-12-2
diethanolamine|디에탄올아민|Diethanolamine|111-42-2
diethyl-ether|디에틸 에테르|Diethyl ether|60-29-7
diethylenetriamine|디에틸렌트리아민|Diethylenetriamine|111-40-0
diethylaminoethanol|2-디에틸아미노에탄올|2-Diethylaminoethanol|100-37-8
diethylamine|디에틸아민|Diethylamine|109-89-7
dioxane|1,4-디옥산|1,4-Dioxane|123-91-1
diisobutylketone|디이소부틸케톤|Diisobutylketone|108-83-8
dichloro-fluoroethane|1,1-디클로로-1-플루오로에탄|1,1-Dichloro-1-fluoroethane|1717-00-6
dichloromethane|디클로로메탄|Dichloromethane|75-09-2
o-dichlorobenzene|o-디클로로벤젠|o-Dichlorobenzene|95-50-1
dichloroethane|1,2-디클로로에탄|1,2-Dichloroethane|107-06-2
dichloroethylene|1,2-디클로로에틸렌|1,2-Dichloroethylene|540-59-0|isomer_group
dichloropropane|1,2-디클로로프로판|1,2-Dichloropropane|78-87-5
dichlorofluoromethane|디클로로플루오로메탄|Dichlorofluoromethane|75-43-4
hydroquinone|p-디히드록시벤젠|p-Dihydroxybenzene|123-31-9
methanol|메탄올|Methanol|67-56-1
methoxyethanol|2-메톡시에탄올|2-Methoxyethanol|109-86-4
methoxyethyl-acetate|2-메톡시에틸 아세테이트|2-Methoxyethyl acetate|110-49-6
methyl-n-butyl-ketone|메틸 n-부틸 케톤|Methyl n-butyl ketone|591-78-6
methyl-n-amyl-ketone|메틸 n-아밀 케톤|Methyl n-amyl ketone|110-43-0
methylamine|메틸 아민|Methyl amine|74-89-5
methyl-acetate|메틸 아세테이트|Methyl acetate|79-20-9
methyl-ethyl-ketone|메틸 에틸 케톤|Methyl ethyl ketone|78-93-3
mibk|메틸 이소부틸 케톤|Methyl isobutyl ketone|108-10-1
methyl-chloride|메틸 클로라이드|Methyl chloride|74-87-3
methyl-chloroform|메틸 클로로포름|Methyl chloroform|71-55-6
mdi|메틸렌 비스(페닐 이소시아네이트)|Methylene bis(phenyl isocyanate)|101-68-8|isomer_group
o-methylcyclohexanone|o-메틸시클로헥사논|o-Methylcyclohexanone|583-60-8
methylcyclohexanol|메틸시클로헥사놀|Methylcyclohexanol|25639-42-3|isomer_group
maleic-anhydride|무수 말레산|Maleic anhydride|108-31-6
phthalic-anhydride|무수 프탈산|Phthalic anhydride|85-44-9
benzene|벤젠|Benzene|71-43-2
butadiene|1,3-부타디엔|1,3-Butadiene|106-99-0
n-butanol|n-부탄올|n-Butanol|71-36-3
sec-butanol|2-부탄올|2-Butanol|78-92-2
butoxyethanol|2-부톡시에탄올|2-Butoxyethanol|111-76-2
butoxyethyl-acetate|2-부톡시에틸 아세테이트|2-Butoxyethyl acetate|112-07-2
n-butyl-acetate|n-부틸 아세테이트|n-Butyl acetate|123-86-4
bromopropane-1|1-브로모프로판|1-Bromopropane|106-94-5
bromopropane-2|2-브로모프로판|2-Bromopropane|75-26-3
methyl-bromide|브롬화 메틸|Methyl bromide|74-83-9
vmp-naphtha|브이엠 및 피 나프타|VM&P Naphtha|8032-32-4
vinyl-acetate|비닐 아세테이트|Vinyl acetate|108-05-4
carbon-tetrachloride|사염화탄소|Carbon tetrachloride|56-23-5
stoddard-solvent|스토다드 솔벤트|Stoddard solvent|8052-41-3|stoddard
styrene|스티렌|Styrene|100-42-5
cyclohexanone|시클로헥사논|Cyclohexanone|108-94-1
cyclohexanol|시클로헥사놀|Cyclohexanol|108-93-0
cyclohexane|시클로헥산|Cyclohexane|110-82-7
cyclohexene|시클로헥센|Cyclohexene|110-83-8
aniline|아닐린 및 그 동족체|Aniline and its homologues|62-53-3|compound_group
acetonitrile|아세토니트릴|Acetonitrile|75-05-8
acetone|아세톤|Acetone|67-64-1
acetaldehyde|아세트알데히드|Acetaldehyde|75-07-0
acrylonitrile|아크릴로니트릴|Acrylonitrile|107-13-1
acrylamide|아크릴아미드|Acrylamide|79-06-1
allyl-glycidyl-ether|알릴 글리시딜 에테르|Allyl glycidyl ether|106-92-3
ethanolamine|에탄올아민|Ethanolamine|141-43-5
ethoxyethanol|2-에톡시에탄올|2-Ethoxyethanol|110-80-5
ethoxyethyl-acetate|2-에톡시에틸 아세테이트|2-Ethoxyethyl acetate|111-15-9
ethylbenzene|에틸 벤젠|Ethyl benzene|100-41-4
ethyl-acetate|에틸 아세테이트|Ethyl acetate|141-78-6
ethyl-acrylate|에틸 아크릴레이트|Ethyl acrylate|140-88-5
ethylene-glycol|에틸렌 글리콜|Ethylene glycol|107-21-1
ethylene-glycol-dinitrate|에틸렌 글리콜 디니트레이트|Ethylene glycol dinitrate|628-96-6
ethylene-chlorohydrin|에틸렌 클로로히드린|Ethylene chlorohydrin|107-07-3
ethyleneimine|에틸렌이민|Ethyleneimine|151-56-4
ethylamine|에틸아민|Ethylamine|75-04-7
glycidol|2,3-에폭시-1-프로판올|2,3-Epoxy-1-propanol|556-52-5|isomer_group
propylene-oxide|1,2-에폭시프로판|1,2-Epoxypropane|75-56-9|isomer_group
epichlorohydrin|에피클로로히드린|Epichlorohydrin|106-89-8|isomer_group
methyl-iodide|요오드화 메틸|Methyl iodide|74-88-4
isobutyl-acetate|이소부틸 아세테이트|Isobutyl acetate|110-19-0
isobutyl-alcohol|이소부틸 알코올|Isobutyl alcohol|78-83-1
isoamyl-acetate|이소아밀 아세테이트|Isoamyl acetate|123-92-2
isoamyl-alcohol|이소아밀 알코올|Isoamyl alcohol|123-51-3
isopropyl-acetate|이소프로필 아세테이트|Isopropyl acetate|108-21-4
isopropyl-alcohol|이소프로필 알코올|Isopropyl alcohol|67-63-0
carbon-disulfide|이황화탄소|Carbon disulfide|75-15-0
cresol|크레졸|Cresol|1319-77-3|isomer_group
xylene|크실렌|Xylene|1330-20-7|isomer_group
chloroprene|2-클로로-1,3-부타디엔|2-Chloro-1,3-butadiene|126-99-8
chlorobenzene|클로로벤젠|Chlorobenzene|108-90-7
tetrachloroethane|1,1,2,2-테트라클로로에탄|1,1,2,2-Tetrachloroethane|79-34-5
tetrahydrofuran|테트라히드로푸란|Tetrahydrofuran|109-99-9
toluene|톨루엔|Toluene|108-88-3
tdi-24|톨루엔-2,4-디이소시아네이트|Toluene-2,4-diisocyanate|584-84-9|isomer_group
tdi-26|톨루엔-2,6-디이소시아네이트|Toluene-2,6-diisocyanate|91-08-7|isomer_group
triethylamine|트리에틸아민|Triethylamine|121-44-8
chloroform|트리클로로메탄|Trichloromethane|67-66-3
trichloroethane|1,1,2-트리클로로에탄|1,1,2-Trichloroethane|79-00-5
trichloroethylene|트리클로로에틸렌|Trichloroethylene|79-01-6
trichloropropane|1,2,3-트리클로로프로판|1,2,3-Trichloropropane|96-18-4
perchloroethylene|퍼클로로에틸렌|Perchloroethylene|127-18-4
phenol|페놀|Phenol|108-95-2
phenyl-glycidyl-ether|페닐 글리시딜 에테르|Phenyl glycidyl ether|122-60-1|isomer_group
formaldehyde|포름알데히드|Formaldehyde|50-00-0
propyleneimine|프로필렌이민|Propyleneimine|75-55-8
n-propyl-acetate|n-프로필 아세테이트|n-Propyl acetate|109-60-4
pyridine|피리딘|Pyridine|110-86-1
hexamethylene-diisocyanate|헥사메틸렌 디이소시아네이트|Hexamethylene diisocyanate|822-06-0
n-hexane|n-헥산|n-Hexane|110-54-3
n-heptane|n-헵탄|n-Heptane|142-82-5
dimethyl-sulfate|황산 디메틸|Dimethyl sulfate|77-78-1
hydrazine|히드라진 및 그 수화물|Hydrazine and its hydrates|302-01-2|compound_group
`);

const organicExtras = lines(`
pentachlorophenol|펜타클로로페놀|Pentachlorophenol|87-86-5
gasoline|가솔린|Gasoline|8006-61-9
beta-naphthylamine|β-나프틸아민|β-Naphthylamine|91-59-8
p-dimethylaminoazobenzene|p-디메틸아미노아조벤젠|p-Dimethylaminoazobenzene|60-11-7
magenta|마젠타|Magenta|569-61-9
moca|4,4'-메틸렌 비스(2-클로로아닐린)|4,4'-Methylene bis(2-chloroaniline)|101-14-4
benzidine|벤지딘 및 그 염|Benzidine and its salts|92-87-5|compound_group
bis-chloromethyl-ether|비스(클로로메틸) 에테르|bis(Chloromethyl) ether|542-88-1
auramine|아우라민|Auramine|492-80-8
polychlorobiphenyls|염소화비페닐|Polychlorobiphenyls|53469-21-9|additional_cas:11097-69-1
coal-tar|콜타르|Coal tar|8007-45-2
chloromethyl-methyl-ether|클로로메틸 메틸 에테르|Chloromethyl methyl ether|107-30-2
turpentine-oil|테레빈유|Turpentine oil|8006-64-2
beta-propiolactone|β-프로피오락톤|β-Propiolactone|57-57-8
o-phthalodinitrile|o-프탈로디니트릴|o-Phthalodinitrile|91-15-6
`);

const healthOrganicCas = new Set(`8006-61-9 111-30-8 91-59-8 55-63-0 75-52-5 98-95-3 100-01-6 100-00-5 25321-14-6 121-69-7 60-11-7 127-19-5 68-12-2 60-29-7 111-40-0 123-91-1 108-83-8 75-09-2 95-50-1 107-06-2 540-59-0 78-87-5 75-43-4 123-31-9 569-61-9 67-56-1 109-86-4 110-49-6 591-78-6 110-43-0 78-93-3 108-10-1 74-87-3 71-55-6 101-68-8 101-14-4 583-60-8 25639-42-3 108-31-6 85-44-9 71-43-2 92-87-5 106-99-0 71-36-3 78-92-2 111-76-2 112-07-2 106-94-5 75-26-3 74-83-9 542-88-1 56-23-5 8052-41-3 100-42-5 108-94-1 108-93-0 110-82-7 110-83-8 62-53-3 75-05-8 67-64-1 75-07-0 492-80-8 107-13-1 79-06-1 110-80-5 111-15-9 100-41-4 140-88-5 107-21-1 628-96-6 107-07-3 151-56-4 556-52-5 106-89-8 53469-21-9 74-88-4 78-83-1 123-92-2 123-51-3 67-63-0 75-15-0 8007-45-2 1319-77-3 1330-20-7 107-30-2 108-90-7 8006-64-2 79-34-5 109-99-9 108-88-3 584-84-9 91-08-7 67-66-3 79-00-5 79-01-6 96-18-4 127-18-4 108-95-2 87-86-5 50-00-0 57-57-8 91-15-6 110-86-1 822-06-0 110-54-3 142-82-5 77-78-1 302-01-2`.split(' '));

const workOrganicExcluded = new Set(['117-81-7','8032-32-4','126-99-8','122-60-1']);

const managedMetals = lines(`
copper|구리 및 그 화합물|Copper and its compounds|7440-50-8|compound_group
lead|납 및 그 무기화합물|Lead and its inorganic compounds|7439-92-1|compound_group
nickel|니켈 및 그 무기화합물, 니켈 카르보닐|Nickel and its inorganic compounds, Nickel carbonyl|7440-02-0|compound_group
manganese|망간 및 그 무기화합물|Manganese and its inorganic compounds|7439-96-5|compound_group
barium|바륨 및 그 가용성 화합물|Barium and its soluble compounds|7440-39-3|species_required
platinum|백금 및 그 화합물|Platinum and its compounds|7440-06-4|compound_group
magnesium-oxide|산화마그네슘|Magnesium oxide|1309-48-4
selenium|셀레늄 및 그 화합물|Selenium and its compounds|7782-49-2|compound_group
mercury|수은 및 그 화합물|Mercury and its compounds|7439-97-6|compound_group
zinc|아연 및 그 화합물|Zinc and its compounds|7440-66-6|compound_group
antimony|안티몬 및 그 화합물|Antimony and its compounds|7440-36-0|compound_group
aluminum|알루미늄 및 그 화합물|Aluminum and its compounds|7429-90-5|compound_group
vanadium-pentoxide|오산화바나듐|Vanadium pentoxide|1314-62-1
iodine|요오드 및 요오드화물|Iodine and iodides|7553-56-2|compound_group
silver|은 및 그 화합물|Silver and its compounds|7440-22-4|compound_group
titanium-dioxide|이산화티타늄|Titanium dioxide|13463-67-7
indium|인듐 및 그 화합물|Indium and its compounds|7440-74-6|compound_group
tin|주석 및 그 화합물|Tin and its compounds|7440-31-5|compound_group
zirconium|지르코늄 및 그 화합물|Zirconium and its compounds|7440-67-7|compound_group
iron|철 및 그 화합물|Iron and its compounds|7439-89-6|compound_group
cadmium|카드뮴 및 그 화합물|Cadmium and its compounds|7440-43-9|compound_group
cobalt|코발트 및 그 무기화합물|Cobalt and its inorganic compounds|7440-48-4|compound_group
chromium|크롬 및 그 화합물|Chromium and its compounds|7440-47-3|compound_group
tungsten|텅스텐 및 그 화합물|Tungsten and its compounds|7440-33-7|compound_group
`);

const acids = lines(`
formic-acid|개미산|Formic acid|64-18-6
hydrogen-peroxide|과산화수소|Hydrogen peroxide|7722-84-1
acetic-anhydride|무수 초산|Acetic anhydride|108-24-7
hydrogen-fluoride|불화수소|Hydrogen fluoride|7664-39-3
hydrogen-bromide|브롬화수소|Hydrogen bromide|10035-10-6
sodium-hydroxide|수산화나트륨|Sodium hydroxide|1310-73-2
potassium-hydroxide|수산화칼륨|Potassium hydroxide|1310-58-3
sodium-cyanide|시안화나트륨|Sodium cyanide|143-33-9
potassium-cyanide|시안화칼륨|Potassium cyanide|151-50-8
calcium-cyanide|시안화칼슘|Calcium cyanide|592-01-8
acrylic-acid|아크릴산|Acrylic acid|79-10-7
hydrogen-chloride|염화수소|Hydrogen chloride|7647-01-0
phosphoric-acid|인산|Phosphoric acid|7664-38-2
nitric-acid|질산|Nitric acid|7697-37-2
acetic-acid|초산|Acetic acid|64-19-7
trichloroacetic-acid|트리클로로아세트산|Trichloroacetic acid|76-03-9
sulfuric-acid|황산|Sulfuric acid|7664-93-9|ph_required
`);

const gases = lines(`
fluorine|불소|Fluorine|7782-41-4
bromine|브롬|Bromine|7726-95-6
ethylene-oxide|산화에틸렌|Ethylene oxide|75-21-8
arsine|삼수소화비소|Arsine|7784-42-1
hydrogen-cyanide|시안화수소|Hydrogen cyanide|74-90-8
ammonia|암모니아|Ammonia|7664-41-7|isomer_group
chlorine|염소|Chlorine|7782-50-5
ozone|오존|Ozone|10028-15-6
nitrogen-dioxide|이산화질소|Nitrogen dioxide|10102-44-0
sulfur-dioxide|이산화황|Sulfur dioxide|7446-09-5
nitric-oxide|일산화질소|Nitric oxide|10102-43-9
carbon-monoxide|일산화탄소|Carbon monoxide|630-08-0
phosgene|포스겐|Phosgene|75-44-5
phosphine|포스핀|Phosphine|7803-51-2
hydrogen-sulfide|황화수소|Hydrogen sulfide|7783-06-4
`);

const permit = lines(`
alpha-naphthylamine|α-나프틸아민 및 그 염|α-Naphthylamine and its salts|134-32-7|compound_group
dianisidine|디아니시딘 및 그 염|Dianisidine and its salts|119-90-4|compound_group
dichlorobenzidine|디클로로벤지딘 및 그 염|Dichlorobenzidine and its salts|91-94-1|compound_group
beryllium|베릴륨 및 그 화합물|Beryllium and its compounds|7440-41-7|compound_group
benzotrichloride|벤조트리클로라이드|Benzotrichloride|98-07-7
arsenic|비소 및 그 무기화합물|Arsenic and its inorganic compounds|7440-38-2|compound_group
vinyl-chloride|염화비닐|Vinyl chloride|75-01-4
coal-tar-pitch-volatiles|콜타르피치 휘발물|Coal tar pitch volatiles|65996-93-2|exposure_required
chromite-ore-processing|크롬광 가공|Chromite ore processing||exposure_required
zinc-chromates|크롬산 아연|Zinc chromates|13530-65-9|isomer_group
o-tolidine|o-톨리딘 및 그 염|o-Tolidine and its salts|119-93-7|compound_group
nickel-sulfides|황화니켈류|Nickel sulfides|12035-72-2|additional_cas:16812-54-7
`);

const entries = new Map();
const officialItems = { MANAGED: [], SPECIAL_MANAGED: [], WORK_ENVIRONMENT: [], SPECIAL_HEALTH: [] };

const safeAliases = Object.freeze({
  toluene:['Methylbenzene','메틸벤젠'],
  xylene:['자일렌','Dimethylbenzene','다이메틸벤젠'],
  mibk:['MIBK','4-Methyl-2-pentanone','4-메틸-2-펜탄온','Hexone','2-메틸아이소뷰틸케톤'],
  acetone:['Propanone','프로판온'],
  methanol:['Methyl alcohol','메틸 알코올'],
  'isopropyl-alcohol':['2-Propanol','아이소프로필알코올'],
  'sodium-hydroxide':['가성소다','Caustic soda'],
  'potassium-hydroxide':['수산화 포타슘','포타슘 하이드레이트'],
  formaldehyde:['Methanal','메탄알'],
  dimethylformamide:['DMF','N,N-Dimethylformamide'],
  dimethylacetamide:['DMAc','N,N-Dimethylacetamide'],
  'titanium-dioxide':['이산화 티타늄','C.I. 77891'],
  nickel:['Nickel metal','Nickel, elemental','Nickel, metallic','C.I. 77775'],
  manganese:['Manganese metal','Manganese, elemental'],
  aluminum:['Aluminium'],
  chromium:['Chromium metal','Chromium, elemental','Chrome'],
  iron:['환원철'],
  'aluminum-chloride-hydroxide-sulfate':['Aluminum chloride hydroxide sulfate','알루미늄 클로라이드 하이드록사이드 설페이트'],
  'polyaluminum-chloride':['Polyaluminum chloride','폴리염화알루미늄','알루미늄 클로로수화물','Aluminum chlorohydrate'],
});

const aliasesFor = row => {
  const individualKo = row.legalName.split(' 및 ')[0].split(',')[0].trim();
  const individualEn = row.englishName.split(' and ')[0].split(',')[0].trim();
  return [...new Set([individualKo, individualEn, ...(safeAliases[row.id] || [])])];
};

const ensureEntry = row => {
  if (!row.cas) return null;
  let value = entries.get(row.id);
  if (!value) {
    const additional = [...row.flags].filter(flag => flag.startsWith('additional_cas:')).map(flag => flag.slice(15));
    value = {
      id: row.id,
      legalName: row.legalName,
      cas: row.cas,
      identifiers: [row.cas, ...additional].map(cas => ({ type: 'CAS', value: cas })),
      aliases: aliasesFor(row),
      substanceKind: row.flags.has('compound_group') || row.flags.has('species_required') ? 'GROUP_WITH_EXACT_IDENTITY' : 'SUBSTANCE',
      categories: {},
      specialManaged: false,
      autoDecidable: true,
      reviewRequired: false,
      matchLegalName: !row.flags.has('compound_group') && !row.flags.has('species_required'),
      basisExplanation: '공식 별표의 개별 CAS identity와 reviewed ingredient를 대조하고 category별 혼합물 함유량 조건을 적용한다.',
    };
    entries.set(row.id, value);
  }
  return value;
};

const reasonFor = row => row.flags.has('exposure_required') ? 'EXPOSURE_OR_WORK_CONDITION'
  : row.flags.has('form_required') ? 'FORM_OR_SPECIES_REQUIRED'
  : row.flags.has('ph_required') ? 'FORM_OR_SPECIES_REQUIRED'
  : row.flags.has('stoddard') ? 'FORM_OR_SPECIES_REQUIRED'
  : row.flags.has('species_required') ? 'FORM_OR_SPECIES_REQUIRED'
  : row.flags.has('compound_group') || row.flags.has('isomer_group') ? 'GROUP_RULE'
  : null;

function addOfficial(row, category, { minimumPercent = 1, automate = true, classification = null, conditionText = null } = {}) {
  const reasonCode = reasonFor(row);
  const resolvedClassification = classification || (reasonCode ? CLASSIFICATION.REVIEW : CLASSIFICATION.CONDITIONAL);
  officialItems[category].push({
    id: `${category}:${row.id}`,
    identityId: row.id,
    legalName: row.legalName,
    cas: row.cas || null,
    classification: resolvedClassification,
    reasonCode: resolvedClassification === CLASSIFICATION.REVIEW ? (reasonCode || 'GROUP_RULE') : null,
    conditionText: conditionText || `혼합물 중 ${minimumPercent}% 이상`,
  });
  if (!automate || !row.cas) return;
  const target = ensureEntry(row);
  target.categories[category] = { minimumPercent, conditionText: conditionText || `혼합물 중 ${minimumPercent}% 이상` };
}

const special03 = new Set(['127-19-5','68-12-2','109-86-4','110-49-6','106-94-5','75-26-3','110-80-5','111-15-9','108-95-2']);
const special01 = new Set(['25321-14-6','107-06-2','78-87-5','71-43-2','106-99-0','56-23-5','107-13-1','79-06-1','151-56-4','556-52-5','75-56-9','106-89-8','79-01-6','96-18-4','127-18-4','50-00-0','75-55-8','77-78-1','302-01-2','75-21-8']);

for (const row of managedOrganics) {
  const specialThreshold = special03.has(row.cas) ? .3 : special01.has(row.cas) ? .1 : null;
  addOfficial(row, 'MANAGED', { minimumPercent: specialThreshold ?? 1, classification:row.id === 'stoddard-solvent' ? CLASSIFICATION.CONDITIONAL : null });
  if (specialThreshold != null) {
    addOfficial(row, 'SPECIAL_MANAGED', { minimumPercent: specialThreshold });
    ensureEntry(row).specialManaged = true;
  }
}
for (const source of managedOrganics.filter(row => !workOrganicExcluded.has(row.cas))) {
  const row=source.id === 'hydrazine' ? { ...source, legalName:'히드라진', englishName:'Hydrazine', flags:new Set() } : source;
  addOfficial(row, 'WORK_ENVIRONMENT', { classification:row.id === 'stoddard-solvent' ? CLASSIFICATION.CONDITIONAL : null });
}
addOfficial(organicExtras.find(row => row.id === 'pentachlorophenol'), 'WORK_ENVIRONMENT');

const allOrganics = [...managedOrganics, ...organicExtras];
for (const cas of healthOrganicCas) {
  const source = allOrganics.find(candidate => candidate.cas === cas);
  if (!source) throw new Error(`Missing special-health organic identity ${cas}`);
  const row=source.id === 'hydrazine' ? { ...source, legalName:'히드라진', englishName:'Hydrazine', flags:new Set() } : source;
  addOfficial(row, 'SPECIAL_HEALTH', { classification:row.id === 'stoddard-solvent' ? CLASSIFICATION.CONDITIONAL : null });
}

for (const row of managedMetals) addOfficial(row, 'MANAGED');

const metalById = id => managedMetals.find(row => row.id === id);
const workMetals = lines(`
copper|구리(분진, 미스트, 흄)|Copper (dust, mist, fume)|7440-50-8|form_required
lead|납 및 그 무기화합물|Lead and its inorganic compounds|7439-92-1|compound_group
nickel|니켈 및 그 무기화합물, 니켈 카르보닐|Nickel and its inorganic compounds, Nickel carbonyl|7440-02-0|compound_group
manganese|망간 및 그 무기화합물|Manganese and its inorganic compounds|7439-96-5|compound_group
barium|바륨 및 그 가용성 화합물|Barium and its soluble compounds|7440-39-3|species_required
platinum|백금 및 그 가용성 염|Platinum and its soluble salts|7440-06-4|species_required
magnesium-oxide|산화마그네슘|Magnesium oxide|1309-48-4
zinc-oxide|산화아연(분진, 흄)|Zinc oxide (dust, fume)|1314-13-2|form_required
iron-oxide|산화철(분진, 흄)|Iron oxide (dust, fume)|1309-37-1|form_required,isomer_group
selenium|셀레늄 및 그 화합물|Selenium and its compounds|7782-49-2|compound_group
mercury|수은 및 그 화합물|Mercury and its compounds|7439-97-6|compound_group
antimony|안티몬 및 그 화합물|Antimony and its compounds|7440-36-0|compound_group
aluminum|알루미늄 및 그 화합물|Aluminum and its compounds|7429-90-5|compound_group
vanadium-pentoxide|오산화바나듐(분진, 흄)|Vanadium pentoxide (dust, fume)|1314-62-1|form_required
iodine|요오드 및 요오드화물|Iodine and iodides|7553-56-2|compound_group
indium|인듐 및 그 화합물|Indium and its compounds|7440-74-6|compound_group
silver|은 및 그 가용성 화합물|Silver and its soluble compounds|7440-22-4|species_required
titanium-dioxide|이산화티타늄|Titanium dioxide|13463-67-7
tin|주석 및 그 화합물(수소화주석 제외)|Tin and its compounds except stannane|7440-31-5|compound_group
zirconium|지르코늄 및 그 화합물|Zirconium and its compounds|7440-67-7|compound_group
cadmium|카드뮴 및 그 화합물|Cadmium and its compounds|7440-43-9|compound_group
cobalt|코발트 및 그 무기화합물|Cobalt and its inorganic compounds|7440-48-4|compound_group
chromium|크롬 및 그 무기화합물|Chromium and its inorganic compounds|7440-47-3|compound_group
tungsten|텅스텐 및 그 화합물|Tungsten and its compounds|7440-33-7|compound_group
`);
for (const row of workMetals) addOfficial(row, 'WORK_ENVIRONMENT', { automate: !row.flags.has('form_required'), classification: row.flags.has('form_required') ? CLASSIFICATION.REVIEW : null });

const healthMetals = lines(`
copper|구리(분진, 미스트, 흄)|Copper (dust, mist, fume)|7440-50-8|form_required
lead|납 및 그 무기화합물|Lead and its inorganic compounds|7439-92-1|compound_group
nickel|니켈 및 그 무기화합물, 니켈 카르보닐|Nickel and its inorganic compounds, Nickel carbonyl|7440-02-0|compound_group
manganese|망간 및 그 무기화합물|Manganese and its inorganic compounds|7439-96-5|compound_group
tetraalkyl-lead|사알킬납|Tetraalkyl lead|78-00-2|isomer_group
zinc-oxide|산화아연(분진, 흄)|Zinc oxide (dust, fume)|1314-13-2|form_required
iron-oxide|산화철(분진, 흄)|Iron oxide (dust, fume)|1309-37-1|form_required,isomer_group
arsenic-trioxide|삼산화비소|Arsenic trioxide|1327-53-3
mercury|수은 및 그 화합물|Mercury and its compounds|7439-97-6|compound_group
antimony|안티몬 및 그 화합물|Antimony and its compounds|7440-36-0|compound_group
aluminum|알루미늄 및 그 화합물|Aluminum and its compounds|7429-90-5|compound_group
vanadium-pentoxide|오산화바나듐(분진, 흄)|Vanadium pentoxide (dust, fume)|1314-62-1|form_required
iodine|요오드 및 요오드화물|Iodine and iodides|7553-56-2|compound_group
indium|인듐 및 그 화합물|Indium and its compounds|7440-74-6|compound_group
tin|주석 및 그 화합물|Tin and its compounds|7440-31-5|compound_group
zirconium|지르코늄 및 그 화합물|Zirconium and its compounds|7440-67-7|compound_group
cadmium|카드뮴 및 그 화합물|Cadmium and its compounds|7440-43-9|compound_group
cobalt|코발트(분진, 흄)|Cobalt (dust, fume)|7440-48-4|form_required
chromium|크롬 및 그 화합물|Chromium and its compounds|7440-47-3|compound_group
tungsten|텅스텐 및 그 화합물|Tungsten and its compounds|7440-33-7|compound_group
`);
for (const row of healthMetals) addOfficial(row, 'SPECIAL_HEALTH', { automate: !row.flags.has('form_required'), classification: row.flags.has('form_required') ? CLASSIFICATION.REVIEW : null });

// Nickel carbonyl is explicitly identified inside the nickel group in all three lists.
const nickelCarbonyl = lines(`nickel-carbonyl|니켈 카르보닐|Nickel carbonyl|13463-39-3`)[0];
for (const category of ['MANAGED','WORK_ENVIRONMENT','SPECIAL_HEALTH']) ensureEntry(nickelCarbonyl).categories[category] = { minimumPercent:1, conditionText:'혼합물 중 1% 이상' };

// Safe exact identities found in the audited MSDS and covered by the aluminum-compound group.
const aluminumCompounds = lines(`
aluminum-chloride-hydroxide-sulfate|알루미늄 및 그 화합물|Aluminum chloride hydroxide sulfate|39290-78-3|compound_group
polyaluminum-chloride|알루미늄 및 그 화합물|Polyaluminum chloride|1327-41-9|compound_group
`);
for (const row of aluminumCompounds) for (const category of ['MANAGED','WORK_ENVIRONMENT','SPECIAL_HEALTH']) {
  const target = ensureEntry(row);
  target.categories[category] = { minimumPercent: 1, conditionText: '혼합물 중 1% 이상' };
}

// Special-managed metal branches. Group-only portions remain review rules below.
for (const [id, threshold] of [['lead',.3],['mercury',.3],['cadmium',.1]]) {
  const row = metalById(id);
  ensureEntry(row).categories.MANAGED = { minimumPercent: threshold, conditionText: `혼합물 중 ${threshold}% 이상` };
  addOfficial(row, 'SPECIAL_MANAGED', { minimumPercent: threshold });
  ensureEntry(row).specialManaged = true;
}
for (const id of ['nickel','antimony','chromium']) {
  const row = metalById(id);
  addOfficial(row, 'SPECIAL_MANAGED', { minimumPercent: .1, automate: false, classification: CLASSIFICATION.REVIEW, conditionText: id === 'nickel' ? '불용성 니켈 화합물 0.1% 이상' : id === 'antimony' ? '삼산화안티몬 0.1% 이상' : '6가 크롬 화합물 0.1% 이상' });
}

for (const row of acids) {
  addOfficial(row, 'MANAGED', { minimumPercent:1, classification:CLASSIFICATION.CONDITIONAL });
  addOfficial(row, 'WORK_ENVIRONMENT', { classification:CLASSIFICATION.CONDITIONAL });
}
for (const cas of ['108-24-7','7664-39-3','143-33-9','151-50-8','7647-01-0','7697-37-2','76-03-9','7664-93-9']) addOfficial(acids.find(row => row.cas === cas), 'SPECIAL_HEALTH', { classification:CLASSIFICATION.CONDITIONAL });
const sulfuric = acids.find(row => row.id === 'sulfuric-acid');
addOfficial(sulfuric, 'SPECIAL_MANAGED', { minimumPercent: .1, automate: false, classification: CLASSIFICATION.REVIEW, conditionText: 'pH 2.0 이하인 강산이며 혼합물 중 0.1% 이상' });

for (const row of gases) {
  const managedThreshold = row.id === 'ethylene-oxide' ? .1 : 1;
  addOfficial(row, 'MANAGED', { minimumPercent: managedThreshold });
  addOfficial(row, 'WORK_ENVIRONMENT');
  if (row.id !== 'ammonia') addOfficial(row, 'SPECIAL_HEALTH');
}
const ethyleneOxide = gases.find(row => row.id === 'ethylene-oxide');
addOfficial(ethyleneOxide, 'SPECIAL_MANAGED', { minimumPercent: .1 });
ensureEntry(ethyleneOxide).specialManaged = true;

// Stoddard solvent is special-managed only when it itself contains benzene >= 0.1%.
const stoddard = managedOrganics.find(row => row.id === 'stoddard-solvent');
addOfficial(stoddard, 'SPECIAL_MANAGED', { automate: false, classification: CLASSIFICATION.REVIEW, conditionText: '스토다드 솔벤트가 벤젠을 0.1% 이상 함유하는지 확인' });

for (const row of permit) {
  const threshold = row.id === 'benzotrichloride' ? .5 : 1;
  const automate = !row.flags.has('exposure_required');
  for (const category of ['WORK_ENVIRONMENT','SPECIAL_HEALTH']) addOfficial(row, category, { minimumPercent: threshold, automate, classification: automate ? null : CLASSIFICATION.REVIEW });
}

// Zinc chromate is explicitly named with CAS in the permit lists and is unambiguously a Cr(VI) compound.
const zincChromates=permit.find(row => row.id === 'zinc-chromates');
for (const category of ['MANAGED','SPECIAL_MANAGED']) ensureEntry(zincChromates).categories[category] = { minimumPercent:.1, conditionText:'6가 크롬 화합물로서 혼합물 중 0.1% 이상' };
ensureEntry(zincChromates).specialManaged=true;

const metalworking = { id:'metalworking-fluids', legalName:'금속가공유', englishName:'Metal working fluids', cas:'', flags:new Set(['exposure_required']) };
addOfficial(metalworking, 'WORK_ENVIRONMENT', { automate:false, classification:CLASSIFICATION.REVIEW, conditionText:'금속가공유 해당 여부와 작업 중 노출 확인' });
addOfficial(metalworking, 'SPECIAL_HEALTH', { automate:false, classification:CLASSIFICATION.REVIEW, conditionText:'금속가공유 중 미네랄 오일 미스트 노출 확인' });

// Official group/form clauses that can identify a candidate but cannot safely create MATCH.
export const REGULATORY_GROUP_RULES_V1 = Object.freeze([
  { id:'organic-isomer-groups', legalName:'이성질체 등 동일 속성 물질군', aliases:['dinitrotoluene','디니트로톨루엔','dichloroethylene','디클로로에틸렌','methylcyclohexanol','메틸시클로헥사놀','cresol','크레졸','xylene','크실렌','toluenediisocyanate','톨루엔디이소시아네이트'], categories:['MANAGED','WORK_ENVIRONMENT','SPECIAL_HEALTH'], minimumPercent:1, reasonCode:'GROUP_RULE', conditionText:'공식 CAS 외 이성질체의 정확한 identity 확인', basisExplanation:'별표의 “등” 범위는 대표 CAS 하나로 전체를 확정할 수 없다.' },
  { id:'special-organic-groups', legalName:'특별관리 유기화합물의 이성질체ㆍ수화물군', aliases:['dinitrotoluene','디니트로톨루엔','glycidol','에폭시프로판올','propylene oxide','에폭시프로판','epichlorohydrin','에피클로로히드린','hydrazine','히드라진'], categories:['MANAGED','SPECIAL_MANAGED'], minimumPercent:.1, allowAfterExactNoMatch:true, reasonCode:'GROUP_RULE', conditionText:'정확한 이성질체ㆍ수화물 identity와 0.1% 기준 확인', basisExplanation:'대표 CAS 하나로 특별관리 물질군 전체를 확정할 수 없다.' },
  { id:'managed-metal-compounds', legalName:'관리대상 금속 및 그 화합물군', aliases:['copper','구리','lead','납','nickel','니켈','manganese','망간','barium','바륨','platinum','백금','selenium','셀레늄','mercury','수은','zinc','아연','antimony','안티몬','aluminum','aluminium','알루미늄','iodine','요오드','indium','인듐','silver','은','tin','주석','zirconium','지르코늄','iron','철','cadmium','카드뮴','cobalt','코발트','chromium','크롬','tungsten','텅스텐'], categories:['MANAGED'], minimumPercent:1, reasonCode:'GROUP_RULE', conditionText:'화합물 identity, 산화수 또는 용해성 범위 확인', basisExplanation:'원소 CAS 하나로 “및 그 화합물” 전체를 확정하지 않는다.' },
  { id:'work-metal-compounds', legalName:'측정대상 금속 및 그 화합물군', aliases:['lead','납','nickel','니켈','manganese','망간','barium','바륨','platinum','백금','selenium','셀레늄','mercury','수은','antimony','안티몬','aluminum','aluminium','알루미늄','iodine','요오드','indium','인듐','silver','은','tin','주석','zirconium','지르코늄','cadmium','카드뮴','cobalt','코발트','chromium','크롬','tungsten','텅스텐'], categories:['WORK_ENVIRONMENT'], minimumPercent:1, reasonCode:'GROUP_RULE', conditionText:'화합물 identity, 산화수 또는 용해성 범위 확인', basisExplanation:'별표 21의 화합물군은 원소 CAS 하나로 전체를 확정할 수 없다.' },
  { id:'health-metal-compounds', legalName:'특검대상 금속 및 그 화합물군', aliases:['lead','납','nickel','니켈','manganese','망간','mercury','수은','antimony','안티몬','aluminum','aluminium','알루미늄','iodine','요오드','indium','인듐','tin','주석','zirconium','지르코늄','cadmium','카드뮴','chromium','크롬','tungsten','텅스텐'], categories:['SPECIAL_HEALTH'], minimumPercent:1, reasonCode:'GROUP_RULE', conditionText:'화합물 identity, 산화수 또는 용해성 범위 확인', basisExplanation:'별표 22의 화합물군은 원소 CAS 하나로 전체를 확정할 수 없다.' },
  { id:'special-metal-species', legalName:'특별관리 금속 화합물 형태', aliases:['nickel compound','니켈 화합물','antimony oxide','삼산화안티몬','chromium compound','크롬 화합물'], categories:['MANAGED','SPECIAL_MANAGED'], minimumPercent:.1, allowAfterExactNoMatch:true, reasonCode:'FORM_OR_SPECIES_REQUIRED', conditionText:'불용성 니켈, 삼산화안티몬 또는 6가 크롬과 0.1% 기준 확인', basisExplanation:'특별관리 범위는 금속 종류만으로 확정할 수 없다.' },
  { id:'special-mercury-species', legalName:'특별관리 수은 화합물 범위', aliases:['mercury compound','수은 화합물'], categories:['MANAGED','SPECIAL_MANAGED'], minimumPercent:.3, allowAfterExactNoMatch:true, reasonCode:'FORM_OR_SPECIES_REQUIRED', conditionText:'아릴ㆍ알킬 화합물 제외 여부와 0.3% 기준 확인', basisExplanation:'수은 화합물의 특별관리 예외를 명칭만으로 확정할 수 없다.' },
  { id:'zinc-iron-forms', legalName:'산화아연 또는 산화철 분진ㆍ흄', identifiers:['7440-66-6','7439-89-6','1314-13-2','1309-37-1'], aliases:['zinc','아연','iron','철','환원철','zinc oxide','산화아연','iron oxide','산화철'], categories:['WORK_ENVIRONMENT','SPECIAL_HEALTH'], minimumPercent:1, reasonCode:'FORM_OR_SPECIES_REQUIRED', conditionText:'산화물 identity와 분진ㆍ흄 형태 확인', basisExplanation:'원소의 존재만으로 법령상 산화물 분진ㆍ흄을 확정하지 않는다.' },
  { id:'copper-cobalt-vanadium-forms', legalName:'금속 분진ㆍ미스트ㆍ흄 형태', identifiers:['7440-50-8','7440-48-4','1314-62-1'], aliases:['copper','구리','cobalt','코발트','vanadium pentoxide','오산화바나듐'], categories:['WORK_ENVIRONMENT','SPECIAL_HEALTH'], minimumPercent:1, reasonCode:'FORM_OR_SPECIES_REQUIRED', conditionText:'분진ㆍ미스트ㆍ흄 형태 확인', basisExplanation:'MSDS 제3항 identity만으로 작업 중 발생 형태를 확정할 수 없다.' },
  { id:'silica-forms', legalName:'규산ㆍ규산염ㆍ광물성 분진', identifiers:['14808-60-7','14464-46-1','15468-32-3','68611-44-9'], aliases:['silica','실리카','silicon dioxide','이산화규소','quartz','석영','cristobalite','크리스토발라이트','tridymite','트리디마이트'], categories:['WORK_ENVIRONMENT','SPECIAL_HEALTH'], reasonCode:'FORM_OR_SPECIES_REQUIRED', conditionText:'결정형ㆍ비결정형 및 분진 노출 형태 확인', basisExplanation:'CAS 또는 일반명만으로 결정형 규산과 작업 중 분진 형태를 확정할 수 없다.' },
  { id:'mineral-dust', legalName:'광물성 분진', identifiers:['1317-65-3','16389-88-1','65997-15-1','14807-96-6','12001-26-2','7782-42-5'], aliases:['limestone','석회석','dolomite','돌로마이트','portland cement','포틀랜드 시멘트','포틀랜드시멘트','soapstone','mica','운모','talc','활석','graphite','흑연'], categories:['WORK_ENVIRONMENT','SPECIAL_HEALTH'], reasonCode:'EXPOSURE_OR_WORK_CONDITION', conditionText:'분진 발생 및 근로자 노출업무 여부 확인', basisExplanation:'구성성분만으로 작업 중 광물성 분진 발생과 노출을 확정할 수 없다.' },
  { id:'permit-salts-and-compounds', legalName:'허가대상 물질의 염ㆍ화합물군', aliases:['naphthylamine','나프틸아민','dianisidine','디아니시딘','dichlorobenzidine','디클로로벤지딘','beryllium','베릴륨','arsenic','비소','tolidine','톨리딘','nickel sulfide','황화니켈'], categories:['WORK_ENVIRONMENT','SPECIAL_HEALTH'], minimumPercent:1, reasonCode:'GROUP_RULE', conditionText:'염 또는 화합물의 정확한 identity 확인', basisExplanation:'대표 CAS 하나로 법령상 염ㆍ화합물군 전체를 확정하지 않는다.' },
  { id:'coal-tar-chromite-work', legalName:'콜타르피치 휘발물ㆍ크롬광 가공', identifiers:['65996-93-2'], aliases:['coal tar pitch','콜타르피치','chromite ore','크롬광'], categories:['WORK_ENVIRONMENT','SPECIAL_HEALTH'], minimumPercent:1, reasonCode:'EXPOSURE_OR_WORK_CONDITION', conditionText:'에어로졸ㆍ코크스 업무 또는 열 소성 공정 확인', basisExplanation:'법령상 작업 또는 발생형태 조건은 제3항만으로 확정할 수 없다.' },
  { id:'metalworking-oil-mist', legalName:'금속가공유ㆍ미네랄 오일 미스트', aliases:['metalworking fluid','metal working fluid','금속가공유','mineral oil','광물성 오일','기유','base oil'], categories:['WORK_ENVIRONMENT','SPECIAL_HEALTH'], reasonCode:'EXPOSURE_OR_WORK_CONDITION', conditionText:'금속가공유 사용 및 미네랄 오일 미스트 노출 확인', basisExplanation:'제품 내 오일 존재만으로 작업 중 미스트 노출을 확정할 수 없다.' },
  { id:'stoddard-benzene', legalName:'벤젠 함유 스토다드 솔벤트', identifiers:['8052-41-3'], aliases:['stoddard solvent','스토다드 솔벤트'], categories:['MANAGED','SPECIAL_MANAGED'], minimumPercent:.1, allowAfterExactNoMatch:true, reasonCode:'FORM_OR_SPECIES_REQUIRED', conditionText:'스토다드 솔벤트 자체의 벤젠 함량 0.1% 이상 여부 확인', basisExplanation:'제품 성분표의 별도 벤젠 행만으로 스토다드 솔벤트 내부 조성을 확정할 수 없다.' },
  { id:'sulfuric-acid-ph', legalName:'pH 2.0 이하 황산 강산', identifiers:['7664-93-9'], aliases:['sulfuric acid','황산'], categories:['MANAGED','SPECIAL_MANAGED'], minimumPercent:.1, allowAfterExactNoMatch:true, reasonCode:'FORM_OR_SPECIES_REQUIRED', conditionText:'pH 2.0 이하 및 혼합물 중 0.1% 이상 확인', basisExplanation:'amountRaw만으로 법령상 pH 조건을 확정할 수 없다.' },
]);

for (const rule of REGULATORY_GROUP_RULES_V1) {
  rule.autoDecidable = false;
  rule.reviewRequired = true;
}

export const REGULATORY_EXACT_ENTRIES_V1 = Object.freeze([...entries.values()].map(entry => Object.freeze(entry)));
export const REGULATORY_OFFICIAL_ITEMS_V1 = Object.freeze(Object.fromEntries(Object.entries(officialItems).map(([category, items]) => [category, Object.freeze(items)])));

export const REGULATORY_COVERAGE_V1 = Object.freeze(Object.fromEntries(Object.entries(REGULATORY_OFFICIAL_ITEMS_V1).map(([category, items]) => {
  const classifications = { EXACT_AUTOMATABLE:0, CONDITIONAL_AUTOMATABLE:0, LEGITIMATE_REVIEW_REQUIRED:0, MASTER_GAP:0 };
  for (const item of items) classifications[item.classification]++;
  const automated = classifications.EXACT_AUTOMATABLE + classifications.CONDITIONAL_AUTOMATABLE;
  return [category, Object.freeze({ officialItemCount:items.length, ...classifications, automationCoverage:automated/items.length, classifiedCoverage:1 })];
})));
