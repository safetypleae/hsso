import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.mjs';

// PDF.js 본체와 워커는 반드시 같은 버전을 사용한다.
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.mjs';

const dropZone = document.querySelector('#drop-zone');
const fileInput = document.querySelector('#file-input');
const fileInfo = document.querySelector('#file-info');
const fileName = document.querySelector('#file-name');
const fileSize = document.querySelector('#file-size');
const fileError = document.querySelector('#file-error');
const removeFileButton = document.querySelector('#remove-file');
const sizeInputs = document.querySelectorAll('input[name="label-size"]');
const customSize = document.querySelector('#custom-size');
const customWidth = document.querySelector('#custom-width');
const customHeight = document.querySelector('#custom-height');
const analyzeButton = document.querySelector('#analyze-button');
const analysisProgress = document.querySelector('#analysis-progress');
const progressTitle = document.querySelector('#progress-title');
const progressDetail = document.querySelector('#progress-detail');
const analysisError = document.querySelector('#analysis-error');
const analysisErrorDetail = document.querySelector('#analysis-error-detail');
const analysisErrorDebug = document.querySelector('#analysis-error-debug');
const analysisWarning = document.querySelector('#analysis-warning');
const results = document.querySelector('#results');
const selectedSizeText = document.querySelector('#selected-size-text');
const rawTextToggle = document.querySelector('#raw-text-toggle');
const rawTextPanel = document.querySelector('#raw-text-panel');
const rawTextContent = document.querySelector('#raw-text-content');
const rawTextSummary = document.querySelector('#raw-text-summary');
const diagnosticsPageCount = document.querySelector('#diagnostics-page-count');
const diagnosticsTotalLength = document.querySelector('#diagnostics-total-length');
const diagnosticsSectionTwo = document.querySelector('#diagnostics-section-two');
const diagnosticsPageLengths = document.querySelector('#diagnostics-page-lengths');
const diagnosticsScanStatus = document.querySelector('#diagnostics-scan-status');
const pictogramOptions = document.querySelector('#pictogram-options');
const pictogramResults = document.querySelector('#pictogram-results');
const previewPictograms = document.querySelector('#preview-pictograms');
const statusPictograms = document.querySelector('#status-pictograms');

const GHS_PICTOGRAMS = [
  { code: 'GHS01', name: '폭발', asset: 'assets/ghs/ghs01.svg', aliases: ['폭발', '폭발성', 'exploding bomb'] },
  { code: 'GHS02', name: '불꽃', asset: 'assets/ghs/ghs02.svg', aliases: ['불꽃', '인화성', 'flame'] },
  { code: 'GHS03', name: '산화성', asset: 'assets/ghs/ghs03.svg', aliases: ['산화성', '원 위의 불꽃', 'flame over circle'] },
  { code: 'GHS04', name: '가스용기', asset: 'assets/ghs/ghs04.svg', aliases: ['가스용기', '고압가스', 'gas cylinder'] },
  { code: 'GHS05', name: '부식성', asset: 'assets/ghs/ghs05.svg', aliases: ['부식성', '부식', 'corrosion'] },
  { code: 'GHS06', name: '해골과 뼈', asset: 'assets/ghs/ghs06.svg', aliases: ['해골과 뼈', '해골', 'skull and crossbones'] },
  { code: 'GHS07', name: '느낌표', asset: 'assets/ghs/ghs07.svg', aliases: ['느낌표', 'exclamation mark'] },
  { code: 'GHS08', name: '건강유해성', asset: 'assets/ghs/ghs08.svg', aliases: ['건강유해성', '건강 유해성', 'health hazard'] },
  { code: 'GHS09', name: '환경유해성', asset: 'assets/ghs/ghs09.svg', aliases: ['환경유해성', '환경 유해성', 'environment'] }
];

const pictogramSources = new Map();

let selectedFile = null;
let isAnalyzing = false;

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdf(file) {
  return file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
}

function showFileError(message) {
  fileError.textContent = message;
  fileError.hidden = false;
}

function clearAnalysisMessages() {
  analysisError.hidden = true;
  analysisErrorDetail.hidden = true;
  analysisErrorDetail.open = false;
  analysisWarning.hidden = true;
}

// PDF만 화면 상태에 반영하며 선택 단계에서는 파일 내용을 읽지 않는다.
function selectFile(file) {
  fileError.hidden = true;
  clearAnalysisMessages();
  if (!isPdf(file)) {
    showFileError('PDF 파일만 선택할 수 있습니다.');
    return;
  }
  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  fileInfo.hidden = false;
  dropZone.hidden = true;
  results.hidden = true;
  updateAnalyzeButton();
}

function removeFile() {
  selectedFile = null;
  fileInput.value = '';
  fileInfo.hidden = true;
  dropZone.hidden = false;
  fileError.hidden = true;
  results.hidden = true;
  rawTextPanel.hidden = true;
  rawTextToggle.setAttribute('aria-expanded', 'false');
  clearAnalysisMessages();
  updateAnalyzeButton();
}

function hasValidSize() {
  const selectedSize = document.querySelector('input[name="label-size"]:checked');
  if (!selectedSize) return false;
  if (selectedSize.value !== 'custom') return true;
  return Number(customWidth.value) > 0 && Number(customHeight.value) > 0;
}

function updateAnalyzeButton() {
  analyzeButton.disabled = isAnalyzing || !(selectedFile && hasValidSize());
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => selectFile(fileInput.files[0]));
removeFileButton.addEventListener('click', removeFile);

['dragenter', 'dragover'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
});
['dragleave', 'drop'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  });
});
dropZone.addEventListener('drop', (event) => selectFile(event.dataTransfer.files[0]));

sizeInputs.forEach((input) => {
  input.addEventListener('change', () => {
    customSize.hidden = input.value !== 'custom';
    updateAnalyzeButton();
  });
});
[customWidth, customHeight].forEach((input) => input.addEventListener('input', updateAnalyzeButton));

// PDF 텍스트 항목의 좌표를 이용해 사람이 읽는 줄에 가깝게 재구성한다.
function buildPageText(items) {
  const textItems = items
    .filter((item) => typeof item.str === 'string' && item.str.trim())
    .map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }))
    .sort((a, b) => Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x);
  const lines = [];
  textItems.forEach((item) => {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 3);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  });
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => line.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' '))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

async function extractPdfText(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const pages = [];
  const pageObjects = [];
  progressTitle.textContent = `총 ${pageCount}페이지를 확인했습니다.`;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    progressDetail.textContent = `${pageNumber} / ${pageCount} 페이지의 텍스트를 추출하는 중입니다.`;
    try {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent({ includeMarkedContent: false });
      pages.push(buildPageText(textContent.items));
      const operatorList = await page.getOperatorList();
      const imageOperators = new Set([
        pdfjsLib.OPS.paintImageXObject,
        pdfjsLib.OPS.paintInlineImageXObject,
        pdfjsLib.OPS.paintImageMaskXObject,
        pdfjsLib.OPS.paintSolidColorImageMask
      ]);
      pageObjects.push({
        pageNumber,
        imageCount: operatorList.fnArray.filter((operation) => imageOperators.has(operation)).length,
        vectorCount: operatorList.fnArray.filter((operation) => operation === pdfjsLib.OPS.constructPath).length
      });
      page.cleanup();
    } catch (error) {
      error.pageNumber = pageNumber;
      throw error;
    }
  }
  await pdf.destroy();
  return { pageCount, pages, pageObjects };
}

function cleanLine(line) {
  return line.replace(/^[\s:：·•\-–—]+|[\s]+$/g, '').trim();
}

function normalized(line) {
  return line.replace(/\s+/g, '').replace(/[ㆍ·・]/g, '·').toLowerCase();
}

function isSectionHeading(line, number) {
  const value = normalized(line);
  const titles = {
    1: ['화학제품과회사에관한정보', '화학제품과회사정보', '화학제품및회사에관한정보'],
    2: ['유해성·위험성', '유해성위험성', '유해위험성'],
    3: ['구성성분의명칭및함유량', '구성성분의명칭과함유량']
  };
  return new RegExp(`^(제)?${number}(장|항|\\.|\\)|\\s)`).test(line.trim()) ||
    (titles[number] || []).some((title) => value.includes(title));
}

function findSection(lines, startNumber, endNumber) {
  const start = lines.findIndex((line) => isSectionHeading(line, startNumber));
  if (start < 0) return [];
  const relativeEnd = lines.slice(start + 1).findIndex((line) => isSectionHeading(line, endNumber));
  const end = relativeEnd < 0 ? Math.min(lines.length, start + 80) : start + 1 + relativeEnd;
  return lines.slice(start + 1, end);
}

function isKnownLabel(line) {
  return /^(제품명|상품명|물질명|공급자|제조자|회사명|주소|긴급전화|담당부서|신호어|그림문자|유해.*위험문구|유해위험문구|예방조치문구)/.test(normalized(line));
}

function extractAfterLabel(lines, labelPatterns, options = {}) {
  const { maxLines = 1, stopAtLabel = true } = options;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const pattern = labelPatterns.find((candidate) => candidate.test(line));
    if (!pattern) continue;
    const inline = cleanLine(line.replace(pattern, ''));
    const values = inline ? [inline] : [];
    for (let offset = 1; offset <= maxLines && index + offset < lines.length; offset += 1) {
      const next = cleanLine(lines[index + offset]);
      if (!next || (stopAtLabel && isKnownLabel(next)) || isSectionHeading(next, 2) || isSectionHeading(next, 3)) break;
      values.push(next);
    }
    const result = values.join('\n').trim();
    if (result) return result;
  }
  return '';
}

function extractCodedStatements(lines, prefix) {
  const codePattern = prefix === 'H' ? /\bH\d{3}\b/i : /\bP\d{3}(?:\+P\d{3})*\b/i;
  const results = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!codePattern.test(lines[index])) continue;
    let statement = cleanLine(lines[index]);
    if (statement.match(codePattern)?.[0] === statement && lines[index + 1] && !isKnownLabel(lines[index + 1])) {
      statement += ` ${cleanLine(lines[index + 1])}`;
    }
    if (!results.includes(statement)) results.push(statement);
  }
  return results;
}

// 명시된 제목·레이블·코드만 사용하며 누락된 내용을 추정하지 않는다.
function analyzeMsdsText(pages) {
  const lines = pages.join('\n').split(/\r?\n/).map(cleanLine).filter(Boolean);
  const sectionOne = findSection(lines, 1, 2);
  const sectionTwo = findSection(lines, 2, 3);
  const productSearch = sectionOne.length ? sectionOne : lines;
  const hazardSearch = sectionTwo.length ? sectionTwo : lines;
  const itemPrefix = '(?:[가-하]\\.?\\s*)?';
  const productName = extractAfterLabel(productSearch, [new RegExp(`^${itemPrefix}(?:제품명|상품명|물질명)\\s*[:：]?\\s*`, 'i')]);
  const supplierInfo = extractAfterLabel(productSearch, [new RegExp(`^${itemPrefix}(?:공급자(?:\\s*정보)?|제조자(?:\\s*정보)?|회사명)\\s*[:：]?\\s*`, 'i')], { maxLines: 5 });
  const signalWord = extractAfterLabel(hazardSearch, [new RegExp(`^${itemPrefix}신호어\\s*[:：]?\\s*`, 'i')]);
  const labeledHazards = extractAfterLabel(hazardSearch, [new RegExp(`^${itemPrefix}(?:유해[·ㆍ-]?위험문구|유해성[·ㆍ-]?위험문구)\\s*[:：]?\\s*`, 'i')], { maxLines: 8 });
  const labeledPrecautions = extractAfterLabel(hazardSearch, [new RegExp(`^${itemPrefix}예방조치문구\\s*[:：]?\\s*`, 'i')], { maxLines: 12 });
  const hStatements = extractCodedStatements(hazardSearch, 'H');
  const pStatements = extractCodedStatements(hazardSearch, 'P');
  const pictogramText = hazardSearch.filter((line) => /그림문자|픽토그램|pictogram/i.test(line)).join('\n');
  return {
    productName,
    supplierInfo,
    signalWord,
    hazardStatements: hStatements.length ? hStatements.join('\n') : labeledHazards,
    precautionStatements: pStatements.length ? pStatements.join('\n') : labeledPrecautions,
    pictogramText
  };
}

function findSectionTwoEvidence(extracted) {
  const allPages = extracted.pages.map((text, index) => ({ pageNumber: index + 1, text }));
  const startIndex = allPages.findIndex((page) => page.text.split(/\r?\n/).some((line) => isSectionHeading(cleanLine(line), 2)));
  const nextSectionOffset = startIndex < 0 ? -1 : allPages.slice(startIndex).findIndex((page) =>
    page.text.split(/\r?\n/).some((line) => isSectionHeading(cleanLine(line), 3))
  );
  const endIndex = nextSectionOffset === 0
    ? startIndex + 1
    : nextSectionOffset > 0 ? startIndex + nextSectionOffset : Math.min(allPages.length, startIndex + 3);
  const sectionPages = startIndex < 0 ? [] : allPages.slice(startIndex, Math.max(startIndex + 1, endIndex));
  const detected = [];
  const candidateText = [];

  sectionPages.forEach((page) => {
    const lines = page.text.split(/\r?\n/).map(cleanLine).filter(Boolean);
    lines.forEach((line, index) => {
      if (!/그림문자|픽토그램|pictogram/i.test(line)) return;
      candidateText.push(...lines.slice(index, index + 7));
    });
  });
  const context = candidateText.join(' ');
  const sectionText = sectionPages.map((page) => page.text).join('\n');

  GHS_PICTOGRAMS.forEach((pictogram) => {
    const codeFound = new RegExp(`\\b${pictogram.code}\\b`, 'i').test(sectionText);
    const nameFound = pictogram.aliases.some((alias) => context.toLowerCase().includes(alias.toLowerCase()));
    if (codeFound || nameFound) {
      detected.push({ ...pictogram, evidence: codeFound ? '코드 명시' : '그림문자 항목 명칭', confidence: codeFound ? '높음' : '중간' });
    }
  });

  const pageNumbers = sectionPages.map((page) => page.pageNumber);
  const objectEvidence = extracted.pageObjects.filter((page) => pageNumbers.includes(page.pageNumber));
  return {
    sectionPages,
    detected,
    imageCount: objectEvidence.reduce((sum, page) => sum + page.imageCount, 0),
    vectorCount: objectEvidence.reduce((sum, page) => sum + page.vectorCount, 0),
    candidateText: [...new Set(candidateText)].join('\n')
  };
}

function renderPictogramControls() {
  pictogramOptions.replaceChildren(...GHS_PICTOGRAMS.map((pictogram) => {
    const label = document.createElement('label');
    label.className = 'pictogram-choice';
    label.innerHTML = `<input type="checkbox" value="${pictogram.code}"><span><img src="${pictogram.asset}" alt=""><b>${pictogram.name}<br>${pictogram.code}</b></span>`;
    label.querySelector('input').addEventListener('change', (event) => {
      if (event.target.checked && !pictogramSources.has(pictogram.code)) pictogramSources.set(pictogram.code, '사용자가 선택함');
      if (!event.target.checked) pictogramSources.delete(pictogram.code);
      renderSelectedPictograms();
    });
    return label;
  }));
}

function renderSelectedPictograms() {
  const selected = GHS_PICTOGRAMS.filter((pictogram) => pictogramSources.has(pictogram.code));
  previewPictograms.replaceChildren(...(selected.length
    ? selected.map((pictogram) => {
      const image = document.createElement('img');
      image.src = pictogram.asset;
      image.alt = `${pictogram.name} (${pictogram.code})`;
      return image;
    })
    : [Object.assign(document.createElement('span'), { className: 'no-pictogram', textContent: '확인된 그림문자 없음' })]));

  pictogramResults.replaceChildren(...(selected.length
    ? selected.map((pictogram) => {
      const row = document.createElement('div');
      row.className = 'identified-pictogram';
      row.innerHTML = `<img src="${pictogram.asset}" alt=""><strong>${pictogram.name} (${pictogram.code})</strong><span>${pictogramSources.get(pictogram.code)}</span>`;
      return row;
    })
    : [Object.assign(document.createElement('p'), { textContent: '자동 식별된 그림문자가 없습니다. 원본 MSDS를 확인해 직접 선택해 주세요.' })]));
  statusPictograms.textContent = selected.length ? `${selected.length}개 선택됨` : '확인 필요';
}

function applyDetectedPictograms(evidence) {
  pictogramSources.clear();
  evidence.detected.forEach((pictogram) => pictogramSources.set(pictogram.code, 'MSDS에서 확인됨'));
  pictogramOptions.querySelectorAll('input').forEach((input) => {
    input.checked = pictogramSources.has(input.value);
  });
  renderSelectedPictograms();
  document.querySelector('#pictogram-detected').textContent = evidence.detected.length
    ? `2항 텍스트에서 ${evidence.detected.map((item) => `${item.name}(${item.code})`).join(', ')}을 확인했습니다.`
    : `텍스트로 그림문자를 확정하지 못했습니다. 이미지 ${evidence.imageCount}개와 벡터 명령 ${evidence.vectorCount}개는 후보 증거이며 임의 매핑하지 않습니다.`;
}

function showPictogramDebug(evidence) {
  const pages = evidence.sectionPages.map((page) => page.pageNumber);
  document.querySelector('#debug-section-pages').textContent = pages.length ? `${pages.join(', ')}페이지` : '탐지되지 않음';
  document.querySelector('#debug-image-count').textContent = `${evidence.imageCount}개`;
  document.querySelector('#debug-vector-count').textContent = `${evidence.vectorCount}개`;
  document.querySelector('#debug-candidates').textContent = evidence.candidateText || '명시적 텍스트 후보 없음';
  document.querySelector('#debug-final-result').textContent = evidence.detected.length ? evidence.detected.map((item) => item.code).join(', ') : '식별 결과 없음';
  document.querySelector('#debug-confidence').textContent = evidence.detected.length ? evidence.detected.map((item) => `${item.code} ${item.confidence}`).join(', ') : '확인 필요';
  document.querySelector('#debug-section-text').textContent = evidence.sectionPages.map((page) => `[${page.pageNumber}페이지]\n${page.text}`).join('\n\n') || '2항 텍스트를 탐지하지 못했습니다.';

  console.groupCollapsed('[HSSO GHS 그림문자 분석]');
  console.info('2항 탐지 페이지:', pages);
  console.info('해당 페이지 텍스트:', evidence.sectionPages.map((page) => page.text));
  console.info('이미지 객체 수:', evidence.imageCount);
  console.info('벡터 그래픽 명령 수:', evidence.vectorCount);
  console.info('그림문자 후보:', evidence.candidateText || '없음');
  console.info('최종 식별 결과:', evidence.detected.map((item) => item.code));
  console.info('식별 신뢰도:', evidence.detected.length ? evidence.detected.map((item) => `${item.code}: ${item.confidence}`) : '확인 필요');
  console.groupEnd();
}

function setExtractedValue(inputId, value) {
  const input = document.querySelector(`#${inputId}`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  const status = document.querySelector(`#status-${inputId}`);
  // 텍스트가 추출되어도 원본 대조 전에는 확정하지 않는다.
  status.textContent = '확인 필요';
  status.classList.remove('status-check');
  status.classList.add('status-needed');
}

function fillAnalysisResult(data) {
  setExtractedValue('product-name', data.productName);
  setExtractedValue('supplier-info', data.supplierInfo);
  setExtractedValue('signal-word', data.signalWord);
  setExtractedValue('hazard-statements', data.hazardStatements);
  setExtractedValue('precaution-statements', data.precautionStatements);
}

function getAnalysisErrorMessage(error) {
  const name = error?.name || '';
  if (name === 'PasswordException') return '암호로 보호된 PDF는 현재 읽을 수 없습니다. 암호를 해제한 파일로 다시 시도해 주세요.';
  if (name === 'InvalidPDFException') return '올바르지 않거나 손상된 PDF 파일입니다. 원본 파일을 확인해 주세요.';
  if (name === 'MissingPDFException') return 'PDF 파일을 불러오지 못했습니다. 파일을 다시 선택해 주세요.';
  if (name === 'UnexpectedResponseException') return 'PDF를 읽는 중 예상하지 못한 응답이 발생했습니다.';
  if (name === 'FormatError') return 'PDF 내부 형식을 해석하지 못했습니다. 다른 PDF 뷰어에서 파일이 정상적으로 열리는지 확인해 주세요.';
  if (name === 'AbortException') return 'PDF 분석 작업이 중단되었습니다. 파일을 다시 선택한 뒤 재시도해 주세요.';
  if (error?.pageNumber) return `${error.pageNumber}페이지의 텍스트를 읽는 중 오류가 발생했습니다.`;
  return 'PDF 분석에 실패했습니다. 네트워크 연결과 파일 상태를 확인한 뒤 다시 시도해 주세요.';
}

function buildDiagnostics(extracted) {
  const pageLengths = extracted.pages.map((page) => page.replace(/\s/g, '').length);
  const totalLength = pageLengths.reduce((sum, length) => sum + length, 0);
  const allLines = extracted.pages.join('\n').split(/\r?\n/).map(cleanLine).filter(Boolean);
  const sectionTwoDetected = allLines.some((line) => isSectionHeading(line, 2));
  const isLikelyScanned = totalLength < 200 || totalLength / extracted.pageCount < 40;
  return { pageCount: extracted.pageCount, pageLengths, totalLength, sectionTwoDetected, isLikelyScanned };
}

function showDiagnostics(diagnostics) {
  diagnosticsPageCount.textContent = `${diagnostics.pageCount}페이지`;
  diagnosticsTotalLength.textContent = `${diagnostics.totalLength.toLocaleString('ko-KR')}자`;
  diagnosticsSectionTwo.textContent = diagnostics.sectionTwoDetected ? '탐지됨' : '탐지되지 않음';
  diagnosticsPageLengths.replaceChildren(...diagnostics.pageLengths.map((length, index) => {
    const item = document.createElement('li');
    item.textContent = `${index + 1}페이지: ${length.toLocaleString('ko-KR')}자`;
    return item;
  }));
  diagnosticsScanStatus.textContent = diagnostics.isLikelyScanned ? '스캔형 PDF 의심' : '텍스트 추출 가능';
  diagnosticsScanStatus.className = `diagnostic-status ${diagnostics.isLikelyScanned ? 'warning' : 'normal'}`;
}

function logDiagnostics(file, diagnostics) {
  console.groupCollapsed(`[HSSO PDF 분석] ${file.name}`);
  console.info('전체 페이지 수:', diagnostics.pageCount);
  console.table(diagnostics.pageLengths.map((length, index) => ({ 페이지: index + 1, '추출 텍스트 길이': length })));
  console.info('전체 추출 텍스트 길이:', diagnostics.totalLength);
  console.info('"2. 유해성·위험성" 탐지 여부:', diagnostics.sectionTwoDetected);
  console.info('스캔형 PDF 의심 여부:', diagnostics.isLikelyScanned);
  console.groupEnd();
}

analyzeButton.addEventListener('click', async () => {
  if (!selectedFile || !hasValidSize() || isAnalyzing) return;
  isAnalyzing = true;
  updateAnalyzeButton();
  clearAnalysisMessages();
  results.hidden = true;
  analysisProgress.hidden = false;
  progressTitle.textContent = 'PDF를 읽고 있습니다.';
  progressDetail.textContent = '파일은 외부 서버로 전송되지 않습니다.';
  analyzeButton.querySelector('span:first-child').textContent = '분석 중...';
  try {
    const extracted = await extractPdfText(selectedFile);
    const rawText = extracted.pages.map((page, index) => `[${index + 1} 페이지]\n${page}`).join('\n\n');
    const diagnostics = buildDiagnostics(extracted);
    const pictogramEvidence = findSectionTwoEvidence(extracted);
    showDiagnostics(diagnostics);
    logDiagnostics(selectedFile, diagnostics);
    fillAnalysisResult(analyzeMsdsText(extracted.pages));
    applyDetectedPictograms(pictogramEvidence);
    showPictogramDebug(pictogramEvidence);
    rawTextContent.textContent = rawText || '(추출된 텍스트가 없습니다.)';
    rawTextSummary.textContent = `${extracted.pageCount}페이지 · ${diagnostics.totalLength.toLocaleString('ko-KR')}자`;
    const selectedSize = document.querySelector('input[name="label-size"]:checked');
    selectedSizeText.textContent = selectedSize.value === 'custom'
      ? `${customWidth.value} × ${customHeight.value} mm`
      : `${selectedSize.value} 선택됨`;
    const warningLabel = document.querySelector('.warning-label');
    if (selectedSize.value === 'custom') {
      warningLabel.style.setProperty('--label-width-mm', `${customWidth.value}mm`);
      warningLabel.style.setProperty('--label-height-mm', `${customHeight.value}mm`);
    } else {
      warningLabel.style.removeProperty('--label-width-mm');
      warningLabel.style.removeProperty('--label-height-mm');
    }
    results.hidden = false;
    if (diagnostics.isLikelyScanned) {
      analysisWarning.textContent = '텍스트를 충분히 추출하지 못했습니다. 이미지형 또는 스캔형 MSDS일 수 있습니다.';
      analysisWarning.hidden = false;
    }
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error('PDF 분석 오류:', error);
    analysisError.textContent = getAnalysisErrorMessage(error);
    analysisError.hidden = false;
    analysisErrorDebug.textContent = [
      `오류 유형: ${error?.name || '알 수 없음'}`,
      error?.pageNumber ? `발생 페이지: ${error.pageNumber}` : '',
      error?.code !== undefined ? `오류 코드: ${error.code}` : '',
      `상세 메시지: ${error?.message || '상세 메시지 없음'}`
    ].filter(Boolean).join('\n');
    analysisErrorDetail.hidden = false;
  } finally {
    isAnalyzing = false;
    analysisProgress.hidden = true;
    analyzeButton.querySelector('span:first-child').textContent = 'MSDS 분석하기';
    updateAnalyzeButton();
  }
});

const emptyMessages = {
  'preview-product': '제품명',
  'preview-signal': '신호어',
  'preview-hazard': 'MSDS에서 확인한 내용을 입력하세요.',
  'preview-precaution': 'MSDS에서 확인한 내용을 입력하세요.',
  'preview-supplier': 'MSDS에서 확인한 공급자 정보를 입력하세요.'
};

document.querySelectorAll('.preview-source').forEach((input) => {
  input.addEventListener('input', () => {
    const preview = document.querySelector(`#${input.dataset.preview}`);
    const value = input.value.trim();
    preview.textContent = value || emptyMessages[input.dataset.preview];
    preview.classList.toggle('empty-value', !value);
    const totalCopyLength = document.querySelector('#hazard-statements').value.length + document.querySelector('#precaution-statements').value.length;
    document.querySelector('.warning-label').dataset.density = totalCopyLength > 1200 ? 'dense' : totalCopyLength > 700 ? 'compact' : 'normal';
  });
});

renderPictogramControls();
renderSelectedPictograms();

// 직접 입력 크기는 인쇄 직전에 실제 mm 단위로 적용하고, 최소 9px까지 문구를 맞춘다.
let printStyleBackup = null;
window.addEventListener('beforeprint', () => {
  const warningLabel = document.querySelector('.warning-label');
  const paragraphs = warningLabel.querySelectorAll('.preview-copy p');
  printStyleBackup = {
    width: warningLabel.style.width,
    height: warningLabel.style.height,
    minHeight: warningLabel.style.minHeight,
    overflow: warningLabel.style.overflow,
    fontSizes: [...paragraphs].map((paragraph) => paragraph.style.fontSize)
  };
  const selectedSize = document.querySelector('input[name="label-size"]:checked');
  if (selectedSize?.value === 'custom') {
    warningLabel.style.width = `${customWidth.value}mm`;
    warningLabel.style.height = `${customHeight.value}mm`;
    warningLabel.style.minHeight = '0';
  }
  let fontSize = 11;
  paragraphs.forEach((paragraph) => { paragraph.style.fontSize = `${fontSize}px`; });
  while (warningLabel.scrollHeight > warningLabel.clientHeight && fontSize > 9) {
    fontSize -= 0.5;
    paragraphs.forEach((paragraph) => { paragraph.style.fontSize = `${fontSize}px`; });
  }
  // 최소 크기에서도 넘치면 자르지 않고 보이도록 하여 사용자가 인쇄 전에 확인할 수 있게 한다.
  if (warningLabel.scrollHeight > warningLabel.clientHeight) warningLabel.style.overflow = 'visible';
});

window.addEventListener('afterprint', () => {
  if (!printStyleBackup) return;
  const warningLabel = document.querySelector('.warning-label');
  const paragraphs = warningLabel.querySelectorAll('.preview-copy p');
  warningLabel.style.width = printStyleBackup.width;
  warningLabel.style.height = printStyleBackup.height;
  warningLabel.style.minHeight = printStyleBackup.minHeight;
  warningLabel.style.overflow = printStyleBackup.overflow;
  paragraphs.forEach((paragraph, index) => { paragraph.style.fontSize = printStyleBackup.fontSizes[index]; });
  printStyleBackup = null;
});

rawTextToggle.addEventListener('click', () => {
  const willOpen = rawTextPanel.hidden;
  rawTextPanel.hidden = !willOpen;
  rawTextToggle.setAttribute('aria-expanded', String(willOpen));
});

const menuButton = document.querySelector('.menu-button');
const mainMenu = document.querySelector('#main-menu');
menuButton.addEventListener('click', () => {
  const isOpen = mainMenu.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
});

let toastTimer;
document.querySelectorAll('[data-coming-soon]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const toast = document.querySelector('#toast');
    toast.textContent = `${link.textContent} 메뉴는 추후 개발 예정입니다.`;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  });
});
