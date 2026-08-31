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
  { code: 'GHS01', name: '폭발', asset: 'assets/ghs/ghs01.svg', exactNames: ['폭발하는 폭탄', 'exploding bomb'] },
  { code: 'GHS02', name: '불꽃', asset: 'assets/ghs/ghs02.svg', exactNames: ['불꽃', 'flame'] },
  { code: 'GHS03', name: '산화성', asset: 'assets/ghs/ghs03.svg', exactNames: ['원 위의 불꽃', 'flame over circle'] },
  { code: 'GHS04', name: '가스용기', asset: 'assets/ghs/ghs04.svg', exactNames: ['가스용기', '가스 실린더', 'gas cylinder'] },
  { code: 'GHS05', name: '부식성', asset: 'assets/ghs/ghs05.svg', exactNames: ['부식', 'corrosion'] },
  { code: 'GHS06', name: '해골과 뼈', asset: 'assets/ghs/ghs06.svg', exactNames: ['해골과 X자형 뼈', '해골과 뼈', 'skull and crossbones'] },
  { code: 'GHS07', name: '느낌표', asset: 'assets/ghs/ghs07.svg', exactNames: ['느낌표', 'exclamation mark'] },
  { code: 'GHS08', name: '건강유해성', asset: 'assets/ghs/ghs08.svg', exactNames: ['건강 유해성', '건강유해성', 'health hazard'] },
  { code: 'GHS09', name: '환경유해성', asset: 'assets/ghs/ghs09.svg', exactNames: ['환경', '환경 유해성', '환경유해성', 'environment'] }
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
  const value = normalized(line).replace(/[.·ㆍ:：()\-]/g, '');
  const titlePatterns = {
    1: /화학제품(?:과|및)?회사(?:에관한)?정보/,
    2: /유해성?위험성/,
    3: /구성성분(?:의)?명칭(?:및|과)?함유량/
  };
  if (!titlePatterns[number]?.test(value)) return false;
  return new RegExp(`^(?:제?${number}(?:항|장)?|${number})`).test(value) || value.length < 36;
}

function buildDocumentLines(pages) {
  return pages.flatMap((pageText, pageIndex) => pageText.split(/\r?\n/).map((text, lineIndex) => ({
    text: cleanLine(text),
    pageNumber: pageIndex + 1,
    lineNumber: lineIndex + 1
  })).filter((line) => line.text));
}

function locateMsdsSections(documentLines) {
  const candidates = { 1: [], 2: [], 3: [] };
  documentLines.forEach((line, index) => {
    [1, 2, 3].forEach((number) => {
      if (isSectionHeading(line.text, number)) candidates[number].push(index);
    });
  });
  let best = null;
  candidates[1].forEach((one) => {
    candidates[2].filter((two) => two > one).forEach((two) => {
      candidates[3].filter((three) => three > two).forEach((three) => {
        if (candidates[1].some((index) => index > one && index < two)) return;
        if (candidates[2].some((index) => index > two && index < three)) return;
        const sectionOneText = documentLines.slice(one + 1, two).map((line) => line.text).join('\n');
        const sectionTwoText = documentLines.slice(two + 1, three).map((line) => line.text).join('\n');
        let score = 0;
        if (/제품명|상품명|물질명|화학제품명/.test(sectionOneText)) score += 12;
        if (/공급자|유통업자|제조회사|회사명|긴급전화/.test(sectionOneText)) score += 12;
        if (/신호어|그림문자/.test(sectionTwoText)) score += 10;
        score += Math.min(24, (sectionTwoText.match(/\bH\d{3}\b/g) || []).length * 3);
        score += Math.min(24, (sectionTwoText.match(/\bP\d{3}(?:\+P\d{3})*\b/g) || []).length * 2);
        if (two - one < 3) score -= 20;
        if (three - two < 6) score -= 20;
        if (!best || score > best.score || (score === best.score && one > best.one)) best = { one, two, three, score };
      });
    });
  });
  if (best) return best;
  const one = candidates[1][0] ?? -1;
  const two = candidates[2].find((index) => index > one) ?? -1;
  const three = candidates[3].find((index) => index > two) ?? -1;
  return { one, two, three, score: 0 };
}

function isKnownLabel(line) {
  return /^(?:[가-하]\.?\s*)?(제품명|상품명|물질명|공급자|제조자|회사명|주소|긴급전화|담당부서|신호어|그림문자|유해.*위험문구|유해위험문구|예방조치문구)/.test(normalized(line));
}

function extractCodedStatements(lines, prefix) {
  const codePattern = prefix === 'H' ? /^H\d{3}\b/i : /^P\d{3}(?:\+P\d{3})*\b/i;
  const results = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!codePattern.test(lines[index])) continue;
    let statement = cleanLine(lines[index]);
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const next = cleanLine(lines[nextIndex]);
      if (!next || isPdfNoiseLine(next)) continue;
      if (/^[HP]\d{3}\b/i.test(next) || getPrecautionCategory(next) || isKnownLabel(next) || isSectionHeading(next, 3)) break;
      statement += ` ${next}`;
    }
    statement = statement.replace(/\s+/g, ' ').trim();
    if (!results.includes(statement)) results.push(statement);
  }
  return results;
}

function isPdfNoiseLine(line, repeatedNoise = new Set()) {
  const value = line.trim();
  return repeatedNoise.has(normalized(value)) || /물질안전보건자료\s*\(?MSDS\)?|산업안전보건법|https?:\/\/|www\.|문서\s*번호|document\s*no\.?|revision|개정\s*(?:번호|일자)|^\s*\d{1,3}\s*$|^\s*(?:page\s*)?\d+\s*(?:\/|of)\s*\d+\s*$/i.test(value);
}

function getPrecautionCategory(line) {
  const match = line.match(/^(?:[가-하]\.?\s*)?(예방|대응|저장|폐기)(?:\s*[:：-]\s*|\s+(?=P\d{3})|\s*$)/);
  return match ? match[1] : '';
}

function findRepeatedPageFurniture(pages) {
  const pageOccurrences = new Map();
  pages.forEach((page) => {
    const uniqueLines = new Set(page.split(/\r?\n/).map(cleanLine).filter(Boolean));
    uniqueLines.forEach((line) => {
      if (line.length > 120 || /^[HP]\d{3}/i.test(line) || getPrecautionCategory(line)) return;
      const key = normalized(line);
      pageOccurrences.set(key, (pageOccurrences.get(key) || 0) + 1);
    });
  });
  return new Set([...pageOccurrences].filter(([, count]) => count >= 2).map(([line]) => line));
}

function collectCategorizedPrecautions(lines, repeatedNoise = new Set()) {
  const categories = { 예방: [], 대응: [], 저장: [], 폐기: [] };
  const uncategorized = [];
  let currentCategory = '';
  let currentStatement = '';

  function saveStatement() {
    if (!currentStatement) return;
    const target = currentCategory ? categories[currentCategory] : uncategorized;
    const normalizedStatement = currentStatement.replace(/\s+/g, ' ').trim();
    if (!target.includes(normalizedStatement)) target.push(normalizedStatement);
    currentStatement = '';
  }

  lines.forEach((rawLine) => {
    let line = cleanLine(rawLine);
    if (!line || isPdfNoiseLine(line, repeatedNoise)) return;
    const category = getPrecautionCategory(line);
    if (category) {
      saveStatement();
      currentCategory = category;
      line = cleanLine(line.replace(/^(?:[가-하]\.?\s*)?(?:예방|대응|저장|폐기)(?:\s*[:：-]\s*|\s+(?=P\d{3})|\s*$)/, ''));
      if (!line) return;
    }
    if (/^P\d{3}(?:\+P\d{3})*\b/i.test(line)) {
      saveStatement();
      currentStatement = line;
      return;
    }
    if (currentStatement && !/^H\d{3}\b/i.test(line) && !isKnownLabel(line) && !isSectionHeading(line, 3)) {
      currentStatement += ` ${line}`;
    } else if (currentStatement) {
      saveStatement();
    }
  });
  saveStatement();
  return { categories, uncategorized };
}

function extractFieldValue(lines, patterns, maxFollowingLines = 2) {
  for (let index = 0; index < lines.length; index += 1) {
    const pattern = patterns.find((candidate) => candidate.test(lines[index]));
    if (!pattern) continue;
    const inlineValue = cleanLine(lines[index].replace(pattern, ''));
    if (inlineValue) return inlineValue;
    for (let offset = 1; offset <= maxFollowingLines && index + offset < lines.length; offset += 1) {
      const candidate = cleanLine(lines[index + offset]);
      if (!candidate || isPdfNoiseLine(candidate)) continue;
      if (isKnownLabel(candidate) || isSectionHeading(candidate, 2)) break;
      return candidate;
    }
  }
  return '';
}

function extractSupplierData(lines) {
  const phonePattern = /(?:\+?82[-\s]?)?(?:0\d{1,2})[-\s)]?\d{3,4}[-\s]?\d{4}/;
  const preferredSupplierPatterns = [
    /^(?:[가-하]\.?)?\s*(?:유통회사명|공급회사명?|공급자명|유통업자명)\s*[:：]?\s*/i,
    /^(?:[가-하]\.?)?\s*(?:공급자|유통업자)\s*[:：]\s*/i
  ];
  const manufacturerPatterns = [
    /^(?:[가-하]\.?)?\s*(?:제조회사명|제조사명|공급자명|유통업자명|회사명|제조자명)\s*[:：]?\s*/i,
    /^(?:[가-하]\.?)?\s*제조자\s*[:：]\s*/i
  ];
  let supplierName = extractFieldValue(lines, preferredSupplierPatterns, 2) || extractFieldValue(lines, manufacturerPatterns, 2);
  const supplierHeadingIndex = lines.findIndex((line) => /공급자\s*\/?\s*유통업자\s*정보|공급자\s*정보|제조자\s*정보/i.test(line));
  if (!supplierName && supplierHeadingIndex >= 0) {
    supplierName = lines.slice(supplierHeadingIndex + 1, supplierHeadingIndex + 10)
      .map(cleanLine)
      .find((line) => line && !isPdfNoiseLine(line) && !/주소|전화|연락처|긴급|담당부서|팩스|fax/i.test(line) && !isKnownLabel(line)) || '';
  }
  supplierName = supplierName
    .replace(/^(?:공급자\s*\/?\s*유통업자\s*정보|공급자\s*정보|제조회사명|공급자명|회사명)\s*[:：]?\s*/i, '')
    .split(/(?:주소|전화|연락처|긴급전화|담당부서)\s*[:：]?/i)[0]
    .replace(phonePattern, '')
    .trim();

  const phoneLabelIndex = lines.findIndex((line) => /긴급(?:연락)?전화(?:번호)?|연락처|전화번호/i.test(line));
  const nearbyPhoneLine = phoneLabelIndex >= 0
    ? lines.slice(phoneLabelIndex, phoneLabelIndex + 3).find((line) => phonePattern.test(line)) : '';
  const labelledPhoneLine = lines.find((line) => /긴급(?:연락)?전화(?:번호)?|연락처|전화(?:번호)?|tel\.?/i.test(line) && phonePattern.test(line));
  const fallbackPhoneLine = lines.find((line) => phonePattern.test(line));
  const contact = (nearbyPhoneLine || labelledPhoneLine || fallbackPhoneLine || '').match(phonePattern)?.[0]?.trim() || '';
  return { supplierName, contact };
}

function formatPrecautionEditor(data) {
  const blocks = Object.entries(data.categories)
    .filter(([, statements]) => statements.length)
    .map(([category, statements]) => `${category}\n${statements.join('\n')}`);
  if (data.uncategorized.length) blocks.push(data.uncategorized.join('\n'));
  return blocks.join('\n\n');
}

// 명시된 제목·레이블·코드만 사용하며 누락된 내용을 추정하지 않는다.
function analyzeMsdsText(pages) {
  const documentLines = buildDocumentLines(pages);
  const locations = locateMsdsSections(documentLines);
  const repeatedNoise = findRepeatedPageFurniture(pages);
  const sectionOneLines = locations.one >= 0 && locations.two > locations.one
    ? documentLines.slice(locations.one + 1, locations.two) : [];
  const sectionTwoLines = locations.two >= 0
    ? documentLines.slice(locations.two + 1, locations.three > locations.two ? locations.three : documentLines.length) : [];
  const cleanSection = (sectionLines) => sectionLines
    .filter((line) => !isPdfNoiseLine(line.text, repeatedNoise))
    .map((line) => line.text);
  const allTextLines = documentLines.map((line) => line.text);
  const productSearch = cleanSection(sectionOneLines).length ? cleanSection(sectionOneLines) : allTextLines;
  const hazardSearch = cleanSection(sectionTwoLines).length ? cleanSection(sectionTwoLines) : allTextLines;
  const itemPrefix = '(?:[가-하]\\.?\\s*)?';
  const productName = extractFieldValue(productSearch, [new RegExp(`^${itemPrefix}(?:제품명|제품의\\s*명칭|화학제품명|상품명|물질명)\\s*[:：]?\\s*`, 'i')], 2);
  const supplier = extractSupplierData(productSearch);
  const supplierInfo = [supplier.supplierName, supplier.contact ? `연락처: ${supplier.contact}` : ''].filter(Boolean).join('\n');
  const signalWord = extractFieldValue(hazardSearch, [new RegExp(`^${itemPrefix}신호어\\s*[:：]?\\s*`, 'i')], 1);
  const hStatements = extractCodedStatements(hazardSearch, 'H');
  const categorizedPrecautions = collectCategorizedPrecautions(hazardSearch, repeatedNoise);
  const pictogramText = hazardSearch.filter((line) => /그림문자|픽토그램|pictogram/i.test(line)).join('\n');
  return {
    productName,
    supplierInfo,
    signalWord,
    hazardStatements: hStatements.join('\n'),
    precautionStatements: formatPrecautionEditor(categorizedPrecautions),
    pictogramText,
    parserDebug: {
      locations,
      documentLines,
      sectionTwoLines,
      sectionTwoText: sectionTwoLines.map((line) => line.text).join('\n'),
      hCodes: hStatements.map((statement) => statement.match(/^H\d{3}/i)?.[0]).filter(Boolean),
      precautionCodes: Object.fromEntries(Object.entries(categorizedPrecautions.categories).map(([category, statements]) => [category, statements.map((statement) => statement.match(/^P\d{3}(?:\+P\d{3})*/i)?.[0]).filter(Boolean)])),
      supplier
    }
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
  const fieldValues = [];
  const pictogramLabelPattern = /그림문자|픽토그램|pictogram/i;
  const nextFieldPattern = /^(?:[가-하]\.\s*)?(?:신호어|유해[·ㆍ-]?위험문구|예방조치문구|유해성[·ㆍ-]?위험성\s*분류|분류기준)/i;

  sectionPages.forEach((page) => {
    const lines = page.text.split(/\r?\n/).map(cleanLine).filter(Boolean);
    lines.forEach((line, index) => {
      if (!pictogramLabelPattern.test(line)) return;
      const inlineValue = cleanLine(line.replace(/^.*?(?:그림문자|픽토그램|pictogram)\s*[:：]?\s*/i, ''));
      if (inlineValue) fieldValues.push({ pageNumber: page.pageNumber, text: inlineValue });
      for (let offset = 1; offset <= 3 && index + offset < lines.length; offset += 1) {
        const nextLine = lines[index + offset];
        if (nextFieldPattern.test(nextLine) || isSectionHeading(nextLine, 3)) break;
        fieldValues.push({ pageNumber: page.pageNumber, text: nextLine });
      }
    });
  });
  const fieldText = fieldValues.map((item) => item.text).join('\n');
  const exactTokens = fieldText
    .split(/[\n,，/|;；·ㆍ、]+/)
    .map((token) => normalized(token.replace(/[()[\]{}]/g, '')))
    .filter(Boolean);

  GHS_PICTOGRAMS.forEach((pictogram) => {
    const codeMatch = fieldValues.find((item) => new RegExp(`\\b${pictogram.code}\\b`, 'i').test(item.text));
    const matchedName = pictogram.exactNames.find((name) => exactTokens.includes(normalized(name)));
    const nameMatch = matchedName && fieldValues.find((item) => normalized(item.text).includes(normalized(matchedName)));
    const codeFound = Boolean(codeMatch);
    const nameFound = Boolean(matchedName && nameMatch);
    if (codeFound || nameFound) {
      detected.push({
        ...pictogram,
        evidence: codeFound
          ? `MSDS 제2항 그림문자 영역에서 ${pictogram.code} 코드 확인 (${codeMatch.pageNumber}페이지)`
          : `MSDS 제2항 그림문자 영역에서 표준 명칭 “${matchedName}” 확인 (${nameMatch.pageNumber}페이지)`,
        confidence: '명시적 근거 확인'
      });
    }
  });

  const pageNumbers = sectionPages.map((page) => page.pageNumber);
  const objectEvidence = extracted.pageObjects.filter((page) => pageNumbers.includes(page.pageNumber));
  return {
    sectionPages,
    detected,
    imageCount: objectEvidence.reduce((sum, page) => sum + page.imageCount, 0),
    vectorCount: objectEvidence.reduce((sum, page) => sum + page.vectorCount, 0),
    candidateText: [...new Set(fieldValues.map((item) => item.text))].join('\n')
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
  evidence.detected.forEach((pictogram) => pictogramSources.set(pictogram.code, `MSDS에서 확인됨 · 근거: ${pictogram.evidence}`));
  pictogramOptions.querySelectorAll('input').forEach((input) => {
    input.checked = pictogramSources.has(input.value);
  });
  renderSelectedPictograms();
  document.querySelector('#pictogram-detected').textContent = evidence.detected.length
    ? evidence.detected.map((item) => `${item.code} ${item.name} — 근거: ${item.evidence}`).join(' / ')
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

function showParserDebug(result, extracted) {
  const debug = result.parserDebug;
  const describeLocation = (index) => {
    const line = debug.documentLines[index];
    return line ? `${line.pageNumber}페이지 ${line.lineNumber}줄 — ${line.text}` : '탐지되지 않음';
  };
  const codeText = (codes) => codes.length ? codes.join(', ') : '없음';
  document.querySelector('#parser-section-one').textContent = describeLocation(debug.locations.one);
  document.querySelector('#parser-section-two').textContent = describeLocation(debug.locations.two);
  document.querySelector('#parser-section-three').textContent = describeLocation(debug.locations.three);
  document.querySelector('#parser-h-codes').textContent = codeText(debug.hCodes);
  document.querySelector('#parser-prevention-codes').textContent = codeText(debug.precautionCodes.예방);
  document.querySelector('#parser-response-codes').textContent = codeText(debug.precautionCodes.대응);
  document.querySelector('#parser-storage-codes').textContent = codeText(debug.precautionCodes.저장);
  document.querySelector('#parser-disposal-codes').textContent = codeText(debug.precautionCodes.폐기);
  document.querySelector('#parser-supplier-name').textContent = debug.supplier.supplierName || '없음';
  document.querySelector('#parser-contact').textContent = debug.supplier.contact || '없음';
  document.querySelector('#parser-section-two-text').textContent = debug.sectionTwoText || '제2항 범위를 탐지하지 못했습니다.';

  console.groupCollapsed('[HSSO MSDS 텍스트 파싱]');
  console.info('전체 페이지 수:', extracted.pageCount);
  extracted.pages.forEach((page, index) => console.info(`${index + 1}페이지 추출 텍스트:`, page));
  console.info('제1항 시작 위치:', describeLocation(debug.locations.one));
  console.info('제2항 시작 위치:', describeLocation(debug.locations.two));
  console.info('제3항 시작 위치:', describeLocation(debug.locations.three));
  console.info('제2항 판단 원문 전체:', debug.sectionTwoText);
  console.info('추출된 H-code 목록:', debug.hCodes);
  console.info('예방 P-code 목록:', debug.precautionCodes.예방);
  console.info('대응 P-code 목록:', debug.precautionCodes.대응);
  console.info('저장 P-code 목록:', debug.precautionCodes.저장);
  console.info('폐기 P-code 목록:', debug.precautionCodes.폐기);
  console.info('공급자명:', debug.supplier.supplierName);
  console.info('연락처:', debug.supplier.contact);
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

function renderPrecautionPreview(value) {
  const parsed = collectCategorizedPrecautions(value.split(/\r?\n/));
  const container = document.querySelector('#preview-precaution-groups');
  const groups = Object.entries(parsed.categories).filter(([, statements]) => statements.length);
  if (!groups.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-value';
    empty.textContent = '분류가 확인된 예방조치문구가 없습니다.';
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(...groups.map(([category, statements]) => {
    const group = document.createElement('section');
    group.className = 'precaution-group';
    const title = document.createElement('h4');
    title.textContent = category;
    const text = document.createElement('p');
    text.textContent = statements.slice(0, 7).join('\n');
    group.append(title, text);
    return group;
  }));
}

function renderSupplierPreview(value) {
  const phoneMatch = value.match(/(?:\+?82[-\s]?)?(?:0\d{1,2})[-\s)]?\d{3,4}[-\s]?\d{4}/);
  const phone = phoneMatch?.[0]?.trim() || '';
  const supplierLines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const supplierLine = supplierLines.find((line) => /공급자|회사명|제조자/i.test(line)) || supplierLines[0] || '';
  const name = supplierLine
    .replace(/^(?:공급자|회사명|제조자)(?:\s*정보)?\s*[:：]?\s*/i, '')
    .split(/(?:연락처|전화|긴급전화|주소)\s*[:：]?/i)[0]
    .replace(phone, '')
    .trim();
  const nameTarget = document.querySelector('#preview-supplier-name');
  const phoneTarget = document.querySelector('#preview-supplier-phone');
  nameTarget.textContent = name;
  phoneTarget.textContent = phone;
  nameTarget.classList.toggle('empty-value', !name);
  phoneTarget.classList.toggle('empty-value', !phone);
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
    const analysisResult = analyzeMsdsText(extracted.pages);
    fillAnalysisResult(analysisResult);
    showParserDebug(analysisResult, extracted);
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
  'preview-signal': '',
  'preview-hazard': 'MSDS에서 확인한 내용을 입력하세요.'
};

document.querySelectorAll('.preview-source').forEach((input) => {
  input.addEventListener('input', () => {
    const value = input.value.trim();
    if (input.dataset.preview === 'precaution-categories') {
      renderPrecautionPreview(value);
    } else if (input.dataset.preview === 'preview-supplier') {
      renderSupplierPreview(value);
    } else {
      const preview = document.querySelector(`#${input.dataset.preview}`);
      preview.textContent = value || emptyMessages[input.dataset.preview];
      preview.classList.toggle('empty-value', !value);
    }
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
  const paragraphs = warningLabel.querySelectorAll('.preview-hazard-section p, .precaution-group p');
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
  const paragraphs = warningLabel.querySelectorAll('.preview-hazard-section p, .precaution-group p');
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
