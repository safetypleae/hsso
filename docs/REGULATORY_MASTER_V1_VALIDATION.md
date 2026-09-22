# Regulatory Master v1 Coverage Audit

## 1. 기준과 방법

- Master version: `KR-OSH-2026-09-22-v1`
- Audit date / fixed random seed: `2026-09-22` / `20260922`
- [산업안전보건기준에 관한 규칙 제420조 및 별표 12](https://www.law.go.kr/법령별표서식/(산업안전보건기준에관한규칙,20260302,별표12)): 시행 2026-03-02
- [산업안전보건법 시행규칙 제186조 및 별표 21](https://www.law.go.kr/법령별표서식/(산업안전보건법시행규칙,20260801,별표21)): 시행 2026-08-01
- [산업안전보건법 시행규칙 제201조 및 별표 22](https://www.law.go.kr/법령별표서식/(산업안전보건법시행규칙,20260801,별표22)): 시행 2026-08-01
- Ground Truth는 위 국가법령정보센터 현행 원문만으로 먼저 작성한 뒤 엔진 결과와 비교했다. MSDS 제15항이나 업체 자료는 정답으로 사용하지 않았다.
- 입력은 실제 PDF 제3항을 읽어 확정한 reviewed ingredient 상당 데이터다. Composition Parser 정확도는 평가·수정하지 않았다.
- 상태 벡터는 순서대로 `관리대상 / 특별관리 / 작업환경측정 / 특수건강진단`이며 `M`, `N`, `R`은 각각 `MATCH`, `NO_MATCH`, `REVIEW_REQUIRED`이다.

## 2. 신규 폴더에서 인식한 PDF 20개와 표본

인식한 순서의 전체 목록은 다음과 같다.

1. `01_니크론-70T.pdf` (기존 Regulatory 검증 중복)
2. `02_BOILER MATE IS-102K MSDS.pdf`
3. `03_Zinc-COAT(N-30).pdf`
4. `04_SEALANT-OS-T(KOR).pdf`
5. `08_CSW-0026_MSDS_용접재료(연강용 고장력강용 티그 와이어)_(국문)v5_2025.08.22.pdf` (기존 중복)
6. `13_LOV HS락카 흑색_GHS국문.pdf` (기존 중복)
7. `18_유니온 백시멘트 2.pdf`
8. `20_한일 포틀랜드시멘트 1종 msds.pdf`
9. `BREAK FLUID 브레이크액 DOT-3 (B301)(MSDS 2.2)(Kor).pdf`
10. `Cubitron II Flexible Grinding Wheel 제출번호 X.pdf` (기존 중복)
11. `D-200 건식 저점도 주입제 경화제.pdf`
12. `ECO-CLEAN (2023.06).pdf`
13. `HiBPAHCS2020.pdf`
14. `SUS-COAT L-316.pdf`
15. `T-308_msds 고려용접봉.pdf`
16. `WD-40.pdf`
17. `고염기도 폴리염화알루미늄 (APACⅡ 1270).pdf`
18. `대한염업상사 정제소금.pdf` (기존 중복)
19. `보통휘발유(Regular Unleaded Gasoline)  msds.pdf`
20. `차아염소산나트륨12_MSDS25.07.01.pdf`

기존 검증과 중복된 5개는 신규 실전 표본에 넣지 않았다. 나머지 15개를 파일명 순으로 고정한 뒤 PowerShell `Get-Random -SetSeed 20260922 -Count 10`을 한 번 적용했다. 선택된 10개는 `02`, `03`, `18`, `20`, `D-200`, `ECO-CLEAN`, `HiBPA`, `SUS-COAT`, `T-308`, `고염기도 폴리염화알루미늄`이다. 결과가 잘 나오는 문서를 수동 선택하지 않았다.

## 3. 신규 10개 Ground Truth

CAS 상태는 별도 표시가 없는 37개가 `KNOWN`이고, Boiler의 비공개 성분 1개만 `TRADE_SECRET`이다. 총 38개 성분, 152개 성분-범주 판정을 검사했다.

| PDF | 제3항 성분 / 이명 | CAS | amountRaw | 공식 Ground Truth |
|---|---|---|---|---|
| Boiler | 수산화 포타슘 / 수산화 칼륨, 포타슘 하이드레이트 | 1310-58-3 | `1~4.5` | M/N/M/N |
| Boiler | Inorganic acid, alkali metal salt / 비공개승인 | 비공개 | `40 ~ 60` | R/R/R/R (`TRADE_SECRET_OR_IDENTITY_UNKNOWN`) |
| Boiler | 에틸렌다이아민테트라아세트산 테트라소듐 | 64-02-8 | `1~10` | N/N/N/N |
| Zinc Coat | Oxybismethane / Dimethyl ether | 115-10-6 | `20~30` | N/N/N/N |
| Zinc Coat | Propane / Dimethylmethane | 74-98-6 | `5~10` | N/N/N/N |
| Zinc Coat | Toluene / Methylbenzene | 108-88-3 | `10~20` | M/N/M/M |
| Zinc Coat | MIBK / Hexone | 108-10-1 | `5~10` | M/N/M/M |
| Zinc Coat | Modified Epoxy Resin | 25068-38-6 | `10~20` | N/N/N/N |
| Zinc Coat | Silica | 68611-44-9 | `1~2` | N/N/R/R (`FORM_OR_SPECIES_REQUIRED`) |
| Zinc Coat | Zinc | 7440-66-6 | `5~10` | M/N/R/R (`FORM_OR_SPECIES_REQUIRED`) |
| Union white cement | Limestone | 1317-65-3 | `10~20` | N/N/R/R (`EXPOSURE_OR_WORK_CONDITION`) |
| Union white cement | Dolomite / Dolocron | 16389-88-1 | `40~50` | N/N/R/R (`EXPOSURE_OR_WORK_CONDITION`) |
| Union white cement | Portland cement | 65997-15-1 | `50~60` | N/N/R/R (`EXPOSURE_OR_WORK_CONDITION`) |
| Hanil cement | Portland cement | 65997-15-1 | `100%` | N/N/R/R (`EXPOSURE_OR_WORK_CONDITION`) |
| D-200 | Fatty acids, tall oil reaction products with tetraethylenepentamine | 68953-36-6 | `60~70` | N/N/N/N |
| D-200 | Tetraethylenepentamine | 112-57-2 | `7~12` | N/N/N/N |
| D-200 | 2,4,6-Tris[(dimethylamino)methyl]phenol | 90-72-2 | `8~13` | N/N/N/N |
| D-200 | Hydrogenated hydrocarbons (C=6-20) polymers | 69430-35-9 | `15~25` | N/N/N/N |
| ECO-CLEAN | Triton BG-10 | 68515-73-1 | `10` | N/N/N/N |
| ECO-CLEAN | Water | 7732-18-5 | `80` | N/N/N/N |
| ECO-CLEAN | Polyoxyethylene (20) sorbitan monolaurate | 9005-64-5 | `10` | N/N/N/N |
| HiBPA | ALUMINUM CHLORIDE HYDROXIDE SULFATE | 39290-78-3 | `29~31` | M/N/M/M |
| HiBPA | Water | 7732-18-5 | `69~71` | N/N/N/N |
| SUS Coat | Iron | 7439-89-6 | `1~5` | M/N/R/R (`FORM_OR_SPECIES_REQUIRED`) |
| SUS Coat | Molybdenum | 7439-98-7 | `0.01~0.1` | N/N/N/N |
| SUS Coat | Nickel | 7440-02-0 | `0.1~0.5` | N/N/N/N |
| SUS Coat | Aluminum | 7429-90-5 | `1~10` | M/N/M/M |
| SUS Coat | Toluene | 108-88-3 | `20~30` | M/N/M/M |
| SUS Coat | Xylene | 1330-20-7 | `1 ~ 10` | M/N/M/M |
| SUS Coat | Modified epoxy resin | 25068-38-6 | `5~15` | N/N/N/N |
| SUS Coat | Silica | 68611-44-9 | `0.1~1` | N/N/R/R (`FORM_OR_SPECIES_REQUIRED`) |
| SUS Coat | Dimethyl ether | 115-10-6 | `35~45` | N/N/N/N |
| T-308 | Iron | 7439-89-6 | `60-70` | M/N/R/R (`FORM_OR_SPECIES_REQUIRED`) |
| T-308 | Chromium | 7440-47-3 | `19.5-22` | M/N/M/M |
| T-308 | Nickel | 7440-02-0 | `9-11` | M/N/M/M |
| T-308 | Manganese | 7439-96-5 | `1-2.5` | M/N/M/M |
| PAC | Polyaluminum chloride / Aluminum chlorohydrate | 1327-41-9 | `25~40` | M/N/M/M |
| PAC | Water | 7732-18-5 | `60~75` | N/N/N/N |

제품 단위 Ground Truth는 Boiler `M/R/M/R`, Zinc Coat `M/N/M/M`, 두 시멘트 각각 `N/N/R/R`, D-200 `N/N/N/N`, ECO-CLEAN `N/N/N/N`, HiBPA `M/N/M/M`, SUS Coat `M/N/M/M`, T-308 `M/N/M/M`, PAC `M/N/M/M`이다.

## 4. 최초 결과, MASTER_GAP 및 보강

Audit 시작 시 제품 결과는 Boiler `M/M/M/M`, Zinc Coat `M/R/M/M`, Union cement `R/R/R/R`, Hanil cement `R/R/R/R`, D-200 `R/R/R/R`, ECO-CLEAN `R/R/R/R`, HiBPA `R/R/R/R`, SUS Coat `M/R/M/M`, T-308 `R/R/R/R`, PAC `R/R/R/R`이었다. 미등록 CAS가 범주와 무관하게 전역 `REVIEW_REQUIRED`를 만들었고, KOH의 특별관리·특수건강 및 propane 등 잘못된 exact rule도 있었다.

신규 10개에서 공식적으로 식별 가능하지만 rule이 없었던 `MASTER_GAP`은 아연, 철, 니켈, 알루미늄, 크롬, 망간 및 두 알루미늄 화합물 CAS였다. 전체 별표/기존 회귀 대조에서 이산화티타늄의 관리대상 누락도 추가 확인했다.

공식 원문으로 안전하게 확정 가능한 다음 exact mapping만 보강했다.

- Zinc `7440-66-6`: 관리대상만 exact. 작업환경/특수건강은 산화아연 분진·흄 형태 확인.
- Iron `7439-89-6`: 관리대상만 exact. 작업환경/특수건강은 산화철 분진·흄 형태 확인.
- Nickel `7440-02-0`, manganese `7439-96-5`, aluminum `7429-90-5`, chromium `7440-47-3`: 해당 일반 목록과 1% 조건.
- Aluminum chloride hydroxide sulfate `39290-78-3`, polyaluminum chloride `1327-41-9`: CAS로 확인되는 알루미늄 화합물과 1% 조건.
- Titanium dioxide `13463-67-7`: 관리대상과 작업환경측정만 exact.

동시에 잘못된 exact rule을 제거하거나 범주를 축소했다: calcium hydroxide, propane, n-butane, carbon black의 측정/특검 rule 제거, NaOH/KOH의 특별관리·특검 제거, TiO2 특검 제거. 공식 목록에 없는 molybdenum은 포괄 금속명만으로 검토 대상으로 만들지 않는다. 명칭 부분일치나 대표 CAS로 화합물군 전체를 `MATCH`시키지 않았다.

## 5. 전체 법정 Coverage Audit

항목 수는 별표 번호를 직접 집계했다. 별표 12는 유기 117 + 금속 24 + 산ㆍ알칼리 17 + 가스 15 = 173개다. 별표 21 화학 항목은 114 + 24 + 17 + 15 + 허가 12 + 금속가공유 1 = 183개다. 별표 22 화학 항목은 109 + 20 + 8 + 14 + 허가 12 + 금속가공유 1 = 164개다.

기존 Audit의 특별관리 38개 표기는 공식 원문 재계수 결과 37개로 정정했다. 별표 12에서 실제 특별관리 표시가 있는 번호 항목은 유기 29개(스토다드 솔벤트 포함), 금속 조건 6개, 황산 1개, 산화에틸렌 1개다. 근거 없이 38번째 항목을 만들지 않았다.

모든 화학 category에는 혼합물 함유량 기준이 있으므로, 항목 전체 분류에서 `EXACT_AUTOMATABLE`은 0으로 두었다. CAS identity가 명확하더라도 함유량 계산이 필요한 항목은 `CONDITIONAL_AUTOMATABLE`이다. 물질군 일부의 대표 CAS는 안전한 exact sub-rule로 동작하지만, 번호 항목 전체가 화합물군이면 `LEGITIMATE_REVIEW_REQUIRED`로 집계한다.

| Category | 공식 항목 | EXACT | CONDITIONAL | LEGITIMATE REVIEW | MASTER_GAP | Exact/Conditional Coverage | Classified Coverage |
|---|---:|---:|---:|---:|---:|---:|---:|
| 관리대상 | 173 | 0 | 137 | 36 | 0 | 79.19% | 100% |
| 특별관리 | 37 | 0 | 24 | 13 | 0 | 64.86% | 100% |
| 작업환경측정 | 183 | 0 | 138 | 45 | 0 | 75.41% | 100% |
| 특수건강진단 | 164 | 0 | 123 | 41 | 0 | 75.00% | 100% |

Master는 중복 제거한 203개 exact CAS identity를 갖는다. 동일 물질은 하나의 record에서 category별 threshold를 독립적으로 보존한다. `MASTER_GAP=0`은 공식 번호 항목이 모두 자동화 또는 정당한 review로 분류됐다는 뜻이며, 모든 화합물 CAS를 자동 매칭한다는 뜻은 아니다.

### LEGITIMATE_REVIEW_REQUIRED 분류

- 관리대상 `GROUP_RULE` 35개: 법령의 `등` 이성질체 항목 14개와 구리ㆍ납ㆍ니켈ㆍ망간ㆍ백금ㆍ셀레늄ㆍ수은ㆍ아연ㆍ안티몬ㆍ알루미늄ㆍ요오드ㆍ은ㆍ인듐ㆍ주석ㆍ지르코늄ㆍ철ㆍ카드뮴ㆍ코발트ㆍ크롬ㆍ텅스텐 화합물군 및 암모니아. `FORM_OR_SPECIES_REQUIRED` 1개: 바륨 가용성 화합물.
- 특별관리 `GROUP_RULE` 11개: 디니트로톨루엔, glycidol, propylene oxide, epichlorohydrin의 `등` 범위, hydrazine hydrate, 납ㆍ수은ㆍ카드뮴 화합물군, 불용성 니켈, 삼산화안티몬, 6가 크롬. `FORM_OR_SPECIES_REQUIRED` 2개: pH 2.0 이하 황산, 벤젠 0.1% 이상 함유 스토다드 솔벤트.
- 작업환경측정 `GROUP_RULE` 35개: 유기 이성질체/동족체 12개, 금속ㆍ가용성 염ㆍ요오드화물군 15개, 암모니아 `등` 범위 1개, 허가대상 염ㆍ화합물군 7개. `FORM_OR_SPECIES_REQUIRED` 7개: 구리 분진ㆍ미스트ㆍ흄, 바륨 가용성 화합물, 백금 가용성 염, 산화아연 분진ㆍ흄, 산화철 분진ㆍ흄, 오산화바나듐 분진ㆍ흄, 은 가용성 화합물. `EXPOSURE_OR_WORK_CONDITION` 3개: 콜타르피치 휘발물, 크롬광 가공, 금속가공유.
- 특수건강진단 `GROUP_RULE` 33개: 유기 이성질체/동족체ㆍ염 12개, 금속ㆍ화합물군 14개, 허가대상 염ㆍ화합물군 7개. `FORM_OR_SPECIES_REQUIRED` 5개: 구리ㆍ산화아연ㆍ산화철ㆍ오산화바나듐ㆍ코발트의 분진/미스트/흄. `EXPOSURE_OR_WORK_CONDITION` 3개: 콜타르피치 휘발물의 코크스 업무, 크롬광 열 소성, 금속가공유 중 미네랄 오일 미스트.

각 개별 항목의 `classification`, `reasonCode`, `conditionText`, 법령상 명칭과 CAS는 `regulatory-master-v1-data.js`에 보존한다. 공식 대표 CAS가 있는 물질군은 그 CAS에 한해서만 exact sub-rule을 제공하며 나머지 군 전체를 대표 CAS로 `MATCH`시키지 않는다.

### 특별관리 threshold 검증

- 0.3%: DMAc, DMF, 2-methoxyethanol, 2-methoxyethyl acetate, 1-/2-bromopropane, 2-ethoxyethanol, 2-ethoxyethyl acetate, phenol, lead/inorganic compounds, mercury/compounds.
- 0.1%: 그 밖의 특별관리 항목. 불용성 nickel, antimony trioxide, Cr(VI), sulfuric-acid pH, Stoddard-solvent benzene 함량처럼 identity 외 조건이 필요한 항목은 review다.
- 특별관리 threshold는 `SPECIAL_MANAGED`뿐 아니라 별표 12의 관리대상 혼합물 기준에도 동일하게 적용했다. 0.1%, 0.3%, 일반 1%, 허가대상 benzotrichloride 0.5% 경계를 각각 테스트한다.

## 6. 보강 후 신규 10개 결과

제품 10개 × 4범주의 최종 결과는 `MATCH 17`, `NO_MATCH 17`, 정상 `REVIEW_REQUIRED 6`으로 Ground Truth와 전부 일치했다. 성분 38개 × 4범주 152건은 `MATCH 35`, `NO_MATCH 95`, 정상 `REVIEW_REQUIRED 22`다.

- False Positive: 0
- False Negative: 0
- 신규 10개 MASTER_GAP: 0
- 기타 미판정: 0
- 정상 REVIEW_REQUIRED 22건: `TRADE_SECRET_OR_IDENTITY_UNKNOWN` 4, `FORM_OR_SPECIES_REQUIRED` 10, `EXPOSURE_OR_WORK_CONDITION` 8

제품 상태는 확정 match가 있으면 `MATCH`가 우선하므로, 성분 단위 review 22건은 제품 단위 review 6건과 수가 다르다. 작업환경측정·특수건강진단 유해인자 포함 결과도 실제 실시 의무를 뜻하지 않으며, 노출·작업조건·예외를 별도 확인해야 한다.

## 7. 기존 Ground Truth 회귀

기존 고정 표본 5개는 PDF를 재분석하지 않고 저장된 Ground Truth 회귀로 사용했다. 최종 결과는 Cubitron `R/N/R/N`, 정제소금 `N/N/N/N`, 구성성분 미확정 CSW `R/R/R/R`, 니크론-70T `N/N/N/N`, LOV 락카 `M/N/M/M`이고 모두 통과했다.

기존 기록 자체의 법령 오류도 공식 원문에 맞게 바로잡았다. TiO2 `0.1-1%`는 관리대상·측정 1% 경계 때문에 review이고 특검 목록에는 없으며, calcium hydroxide는 네 목록의 exact 항목이 아니다. 이 변경은 회귀를 임의 완화한 것이 아니라 잘못된 기존 Ground Truth를 공식 별표와 일치시킨 것이다.

## 8. 남은 한계와 종료 판단

- 공식 화학 항목은 전부 분류되어 catalog `MASTER_GAP=0`, Classified Coverage 100%다. 자동화 Coverage가 64.86~79.19%인 이유는 데이터 누락이 아니라 항목 전체가 물질군 또는 형태ㆍ작업조건을 포함하기 때문이다.
- “및 그 화합물”, 산화수ㆍ용해성ㆍ결정형, 분진ㆍ흄ㆍ미스트, 영업비밀, 함유량 경계는 reviewed ingredient만으로 확정할 수 없으면 계속 review다.
- 현재 엔진은 목록 포함 여부를 보수적으로 보조한다. 측정·특검의 실제 실시 의무는 노출업무, 작업조건과 예외조건 확인이 필요하다.
- 현행 별표의 법정 목록 구축이라는 v1 범위는 종료 가능하다. 다만 법령 개정 시 Master version 갱신과 독립 법률 검수는 계속 필요하며, `REVIEW_REQUIRED` 항목을 실제 의무 비해당으로 해석해서는 안 된다.
