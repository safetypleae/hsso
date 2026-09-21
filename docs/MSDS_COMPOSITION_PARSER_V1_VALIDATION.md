# MSDS Composition Parser v1 검증 기록

## 검증 범위와 원칙

- 검증일: 2026-09-21
- 기준 HEAD: `02b8397`
- 원본: `C:\Users\lenovo\Desktop\msds-parser-test` 내 PDF 10개
- PDF는 읽기만 했고 프로젝트로 복사하지 않았다.
- 파일명은 parser 규칙이나 성분 판단에 사용하지 않았다.
- 제3항 시작과 제4항 시작 사이의 텍스트·좌표만 사용했다.
- 성분–CAS–함유량 오연결 0을 최우선 기준으로 삼았다.

## PDF별 layout 분류·Ground Truth·재검증

### 1. 01_니크론-70T.pdf

- Layout: A(좌표상 표 행 보존) + 행 내 다중 물리 줄
- Ground Truth / parser: 3 / 3, `SUCCESS`
- 성분:
  - `차아염소산 칼슘` / `Calcium hypochlorite` / `7778-54-3` / `KNOWN` / `70% 이상 (유효염소로써)` / false
  - `수산화 칼슘` / `Calcium hydroxide` / `1305-62-0` / `KNOWN` / `1 - 5 %` / false
  - `순수` / null / `7732-18-5` / `KNOWN` / `9 - 16%` / false

### 2. 02_BOILER MATE IS-102K MSDS.pdf

- Layout: A + 긴 이명의 물리 줄바꿈 + 비공개승인 셀
- Ground Truth / parser: 3 / 3, `SUCCESS`
- 성분:
  - `수산화 포타슘` / `수산화 칼륨(K(OH)), 포타슘 하이드레이트` / `1310-58-3` / `KNOWN` / `1~4.5` / false
  - `Inorganic acid, alkali metal salt` / `비공개승인` / null / `TRADE_SECRET` / `40 ~ 60` / true
  - `에틸렌다이아민테트라아세트산 테트라소듐` / `N,N'-1,2-에탄다이일비스(N-(카복시메틸)글라이신) 테트라소듐 염` / `64-02-8` / `KNOWN` / `1~10` / false

### 3. 03_Zinc-COAT(N-30).pdf

- Layout: A(동일 물리 행)
- Ground Truth / parser: 7 / 7, `SUCCESS`
- 성분:
  - `Oxybismethane` / `Dimethyl ether` / `115-10-6` / `20 ~ 30`
  - `Propane` / `Dimethylmethane` / `74-98-6` / `5 ~ 10`
  - `Toluene` / `Methylbenzene` / `108-88-3` / `10 ~ 20`
  - `MIBK` / `Hexone` / `108-10-1` / `5 ~ 10`
  - `Modified Epoxy Resin` / null / `25068-38-6` / `10 ~ 20`
  - `Silica` / null / `68611-44-9` / `1 ~ 2`
  - `Zinc` / null / `7440-66-6` / `5 ~ 10`
- 모두 `KNOWN`, `trade_secret=false`.

### 4. 08_CSW-0026_MSDS_용접재료(연강용 고장력강용 티그 와이어)_(국문)v5_2025.08.22.pdf

- Layout: E(제품 variant별 복수 함유량 열, 2페이지 걸침)
- Ground Truth: variant 7개, 고유 성분 6개, 실제 함유 성분×variant 셀 30개
- Parser: 0개, `UNRESOLVED` / `VARIANT_TABLE`. 의도적 보류이며 평면화하지 않음.
- CAS identity:
  - `철` / `Iron` / `7439-89-6`
  - `망간` / `Manganese(Mn)` / `7439-96-5`
  - `실리콘` / `Silicon(Si)` / `7440-21-3`
  - `구리` / `Copper(Cu)` / `7440-50-8`
  - `니켈` / `Nickel(Ni)` / `7440-02-0`
  - `몰리브덴` / `Molybdenum` / `7439-98-7`
- Variant amount:
  - TGC-50S / TGC-50 / TGC-50B: Fe `Rem.(나머지)`, Mn `0.5~3.0`, Si `0.2~1.5`, Cu `0.05~0.5`, Ni `-`, Mo `-`
  - TGC-50C / TGC-50G: Fe `Rem.(나머지)`, Mn `0.5~3.0`, Si `0.2~1.5`, Cu `0.05~0.5`, Ni `-`, Mo `-`
  - TGC-80Ni1: Fe `Rem.(나머지)`, Mn `0.5~2.0`, Si `0.2~1.5`, Cu `-`, Ni `0.8~1.1`, Mo `-`
  - TGC-90G: Fe `Rem.(나머지)`, Mn `0.5~3.0`, Si `0.2~1.5`, Cu `0.05~0.5`, Ni `0.5~1.5`, Mo `≤ 0.5`

### 5. 13_LOV HS락카 흑색_GHS국문.pdf

- Layout: A + 성분명·함유량 줄바꿈
- Ground Truth / parser: 10 / 10, `SUCCESS`
- 성분:
  - `Nitrocellulose` / `나이트로셀룰로스` / `9004-70-0` / `11 이상 ~ 20 % 미만`
  - `Coconut oil polymer with benzoic acid, glycerol and phthalic anhydride` / null / `68038-05-1` / `11 이상 ~ 20 % 미만`
  - `Acetone` / `아세톤` / `67-64-1` / `1 이상 ~ 10 % 미만`
  - `1,4-Benzenedicarboxylic acid bis(2-ethylhexyl) ester` / `디옥틸 테레프탈산` / `6422-86-2` / `1 이상 ~ 10 % 미만`
  - `Dimethyl carbonate` / `탄산 다이메틸` / `616-38-6` / `1 이상 ~ 10 % 미만`
  - `Carbon black` / `카본 블랙` / `1333-86-4` / `1 이상 ~ 10 % 미만`
  - `Xylene` / `자일렌 ; 다이메틸벤젠` / `1330-20-7` / `1 이상 ~ 5 % 미만`
  - `Toluene` / `톨루엔` / `108-88-3` / `21 이상 ~ 24 % 미만`
  - `4-Methyl-2-pentanone` / `4-메틸-2-펜탄온 ; 2-메틸아이소뷰틸 케톤` / `108-10-1` / `11 이상 ~ 20 % 미만`
  - `Ethylbenzene` / `에틸벤젠` / `100-41-4` / `1 이상 ~ 10 % 미만`

### 6. 대한염업상사 정제소금.pdf

- Layout: A + CAS/함유량 하위 header
- Ground Truth / parser: 1 / 1, `SUCCESS`
- `Sodium chloride` / `Sodium chloride` / `7647-14-5` / `KNOWN` / `99` / false

### 7. 차아염소산나트륨12_MSDS25.07.01.pdf

- Layout: A + 성분명 물리 줄바꿈
- Ground Truth / parser: 3 / 3, `SUCCESS`
- 성분:
  - `차아염소산 나트륨 (SODIUM HYPOCHLORITE)` / `하이포아염소산나트륨` / `7681-52-9` / `12.6`
  - `물(H2O)` / `Water` / `7732-18-5` / `86.8`
  - `수산화나트륨 (SODIUM HYDROXIDE)` / `수산화나트륨` / `1310-73-2` / `0.5~0.8(0.6%)`

### 8. Cubitron II Flexible Grinding Wheel 제출번호 X.pdf

- Layout: A + CAS/KE 식별번호 복수 물리 줄
- Ground Truth / parser: 2 / 2, `SUCCESS`
- `무기 불소` / null / `60304-36-1` / `KNOWN` / `5 - 9.9` / false
- `이산화 티타늄` / `C.I. 77891` / `13463-67-7` / `KNOWN` / `0.1 - 1` / false

### 9. HiBPAHCS2020.pdf

- Layout: B(성분명과 CAS/함유량이 서로 다른 물리 줄)
- Ground Truth / parser: 2 / 2, `SUCCESS`
- `ALUMINUM CHLORIDE HYDROXIDE SULFATE` / null / `39290-78-3` / `KNOWN` / `29~31` / false
- `Water` / null / `7732-18-5` / `KNOWN` / `69~71` / false
- `Total / - / 100`은 성분이 아닌 요약행으로 제외했다.

### 10. WD-40.pdf

- Layout: A + C(여러 성분 연속) + 제3항의 2페이지 연속
- Ground Truth / parser: 7 / 7, `SUCCESS`
- 성분:
  - `수소처리된 경질 정제유 (Distillates (petroleum), hydrotreated light)` / `경질 정제 연료유 (Distillate fuel oils, light)` / `64742-47-8` / `KNOWN` / `36 ~ 42`
  - `기유 (Base Oils)` / null / `64742-54-7` / `KNOWN` / `9 ~ 15`
  - `프로판 (Propane)` / `다이메틸메테인` / `74-98-6` / `KNOWN` / `8 ~ 12`
  - `노르말부탄 (n-Butane, 부타디엔 함량 0%)` / `부탄` / `106-97-8` / `KNOWN` / `28 ~ 32`
  - `Alkane(C=1~5)oic acid Substituted Alkyl(C=2~4)Alkyl(C=6~10) ester Alkali metal salt` / null / null / `TRADE_SECRET` / `1~3`
  - `Fatty acids, (C=15~20)-unsatd., dimers` / null / null / `TRADE_SECRET` / `1~3`
  - `Alkyl(C=1~3) alkyl(C=1~5) Carbomonocyclic alcohol` / null / null / `TRADE_SECRET` / `0.01~1`
- 마지막 3개 행의 `trade_secret=true`.

## 재검증 집계

- 단일 성분 목록으로 안전하게 표현 가능한 Ground Truth: 38행
- Parser 출력: 38행
- 정확 연결: 38행(고신뢰 14, 중간신뢰 24)
- 미추출: 일반 평면 문서 0행
- 오연결: 0행
- 보류: variant 문서 1개, 실제 함유 셀 30개(고유 CAS identity 6개)

Variant 문서의 30개 셀을 평면 ingredient로 편입하지 않았다. 향후 `productVariant` 구조가 결정되기 전에는 이 문서의 자동입력을 허용하지 않는 것이 안전하다.

## 기존 PDF text extraction에서 확인한 문제

- 표의 한 logical row가 여러 y좌표로 나뉘고 성분명·이명·함유량의 줄바꿈 위치도 서로 다르다.
- `7778 - 54 - 3`, `7440 – 21 - 3`처럼 CAS 대시와 공백이 불규칙하다.
- 긴 영문 성분명은 `anh` / `ydride`, `Silic` / `on(Si)`처럼 단어 중간에서 나뉜다. Parser는 원문 source를 남기고 이런 행을 `medium`으로 표시한다.
- 제3항이 다음 페이지로 연속될 때 페이지 header가 제4항 heading보다 먼저 추출될 수 있다. MSDS/CAS 반복 header는 성분 행에서 제외했다.
- CAS 열에 CAS No.와 KE No.가 같이 있거나, 함유량에 `범위`/`단일` 하위 열이 있는 표가 있다. CAS Registry Number와 유효한 함유량 표현만 선택했다.
- 용접재료 표는 text extraction 실패가 아니라 본질적으로 variant 차원을 가지므로 평면 ingredient 배열이 정확한 데이터 모델이 아니다.

## Parser 구조와 안전 규칙

- 반환: `ingredients`, `status`, `warnings`, parser-level `source`
- ingredient: `chemicalName`, `synonym`, `casValue`, `casStatus`, `amountRaw`, `tradeSecret`, `confidence`, `source`
- section 탐색: 한·영 제3항 heading에서 시작하고 한·영 제4항 heading 직전에서 종료
- 연결 우선순위: 동일 좌표 행 → CAS anchor 기반 좌표 행 band → 인접한 완전 label/value group
- 좌표 행 band의 경계는 성분 CAS anchor 사이의 가장 큰 수직 간격으로 계산
- CAS 체크섬 무효 시 원문 번호는 보존하되 `low` + `PARTIAL` + warning으로 격하
- CAS 없음과 영업비밀을 각각 `ABSENT`, `TRADE_SECRET`로 구분
- 함유량은 숫자로 변환하지 않고 범위·비교연산자·나머지 표현을 `amountRaw`에 보존
- variant 복수 열, 열 순서 붕괴, 필수 field 미확정은 row를 추측 생성하지 않고 `UNRESOLVED`

## UI와 저장 경계

- 화학제품 등록 화면과 기존 제품의 MSDS 신규 version 등록 화면에 검토 편집기를 표시한다.
- 성분명·이명·CAS 상태·CAS 값·함유량·영업비밀 여부를 수정할 수 있고 row 추가·삭제를 지원한다.
- `low`는 `확인 필요`, `medium`은 `확인 권장`로 표시한다.
- 성분 편집값은 이번 v1에서 DB/R2에 저장하지 않는다. migration·ingredient table은 생성하지 않았다.

## 향후 DB / Regulatory Rule Engine 제안

1. `msds_ingredient_review` 개념에 parser 출력과 사용자 확정값을 분리하고 version에 귀속시킨다.
2. variant 문서는 `product_variant` → `variant_ingredient` 관계로 보존하고 평면 ingredient와 혼합하지 않는다.
3. `amount_raw`를 항상 보존하고, 검증된 parser로만 `amount_min`, `amount_max`, `amount_operator`, `amount_unit`을 별도 생성한다.
4. 확정된 ingredient의 normalized CAS를 `regulatory_substance_master`와 연결하되 CAS 일치만으로 법정 판정하지 않는다.
5. Rule은 화합물군, 금속/화합물 형태, 수용성·불용성, 산화수(예: 6가), 함유량 threshold, 예외조건, 근거 법령 version을 표현해야 한다.
6. 권장 flow: `reviewed ingredient` → `normalized CAS + form/group facts` → `regulatory master` → `versioned rule/threshold` → `decision` → `legal evidence`.
