import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMsdsMetadata } from '../assets/msds-metadata-parser.js';

const parse = lines => parseMsdsMetadata(lines.map(rawText => ({ rawText })));

test('same-line and next-line product labels avoid the next field label', () => {
  assert.equal(parse(['1. 화학제품과 회사에 관한 정보', '가. 제품명: 표면 세정제', '2. 유해성·위험성']).productName, '표면 세정제');
  assert.equal(parse(['1. 화학제품과 회사에 관한 정보', '제품명', '- 보일러 처리제', '2. 유해성·위험성']).productName, '보일러 처리제');
  assert.equal(parse(['1. 화학제품과 회사에 관한 정보', '제품명', '(관용명)', '2. 유해성·위험성']).productName, '');
});

test('manufacturer and supplier remain separate when their blocks are separate', () => {
  const result = parse([
    '1. 화학제품과 회사에 관한 정보', '- 제조자 정보', '○ 회사명 : Example Manufacturing',
    '- 공급자 정보', '○ 회사명 : 국내 공급 주식회사', '2. 유해성·위험성'
  ]);
  assert.equal(result.manufacturer, 'Example Manufacturing');
  assert.equal(result.supplier, '국내 공급 주식회사');
});

test('a combined company role applies only inside its explicit combined block', () => {
  const result = parse([
    '1. 화학제품과 회사에 관한 정보', '다. 제조자/공급자/유통업자 정보',
    '회사명 | 통합 화학 주식회사', '2. 유해성·위험성'
  ]);
  assert.equal(result.manufacturer, '통합 화학 주식회사');
  assert.equal(result.supplier, '통합 화학 주식회사');
});

test('company validation rejects headings, addresses and phone cells', () => {
  const result = parse([
    '1. 화학제품과 회사에 관한 정보', '공급자/유통업자 정보', '공급자 | 정보',
    '주소 | 서울시 중구', '전화번호 | 02-123-4567', '2. 유해성·위험성'
  ]);
  assert.equal(result.supplier, '');
});

test('product code does not accept document, SDS or MSDS numbers', () => {
  const result = parse([
    '1. 화학제품과 회사에 관한 정보', '제품명 | 시험 제품', '문서번호 : DOC-42',
    'SDS No. : SDS-12', 'MSDS No. : LEGACY-9', '제품 코드 | PROD-7', '2. 유해성·위험성'
  ]);
  assert.equal(result.productCode, 'PROD-7');
});

test('dates map first-written or enacted dates and the latest final revision date', () => {
  const result = parse([
    '최초 작성일자 :', '0.0 2008 년 10 월 28 일', '개정횟수 및 최종 개정일자 :',
    '1.0 20 19 년 03 월 22 일', '2.0 20 19 년 06 월 20 일'
  ]);
  assert.equal(result.issueDate, '2008-10-28');
  assert.equal(result.revisionDate, '2019-06-20');
});

test('a missing first-written date does not borrow the revision date', () => {
  const result = parse(['최초 작성일자 : 자료 없음.', '최종 개정일자 : 2026/01/21']);
  assert.equal(result.issueDate, '');
  assert.equal(result.revisionDate, '2026-01-21');
});

test('submission number accepts explicit Korean context and rejects generic document numbers', () => {
  assert.equal(parse(['MSDS 제출번호 : AA12345-0000000001']).submissionNumber, 'AA12345-0000000001');
  assert.equal(parse(['MSDS 번호 : AA12345-0000000001']).submissionNumber, 'AA12345-0000000001');
  assert.equal(parse(['MSDS No. : AA12345-0000000001']).submissionNumber, '');
  assert.equal(parse(['Document No. : AA12345-0000000001']).submissionNumber, '');
  assert.equal(parse(['MSDS 번호 : 산업안전보건법에 따른 작성 및 제출 제외 대상']).submissionNumber, '');
});

test('an adjacent official number needs an explicit MSDS-number instruction', () => {
  assert.equal(parse(['AA12345-0000000001', '※ MSDS 번호를 반영하여 사용하십시오.']).submissionNumber, 'AA12345-0000000001');
  assert.equal(parse(['AA12345-0000000001', '문서 개정 이력']).submissionNumber, '');
});

test('field metadata exposes confidence and source while low-confidence values stay empty', () => {
  const result = parse(['1. 화학제품과 회사에 관한 정보', '제품명 | 시험 제품', '2. 유해성·위험성']);
  assert.equal(result.fields.productName.confidence, 'high');
  assert.equal(result.fields.productName.matchedLabel, '제품명');
  assert.match(result.fields.productName.sourceText, /시험 제품/);
  assert.equal(result.fields.manufacturer.confidence, 'none');
});
