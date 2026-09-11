import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.mjs';
import { initAuthUI } from './auth.js';
import { initMyPage } from './mypage.js';
import { createSavedDocumentPreview } from './saved-document-preview.js';

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
const downloadPdfButton = document.querySelector('#download-pdf');
const pdfDownloadMessage = document.querySelector('#pdf-download-message');
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
const printPreview = document.querySelector('#print-preview');
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

const PRINT_LAYOUTS = {
  대형: { pageWidth: 210, pageHeight: 297, columns: 1, rows: 1, count: 1, margin: 5, gap: 0, description: 'A4 세로 · 1개' },
  중형: { pageWidth: 297, pageHeight: 210, columns: 2, rows: 1, count: 2, margin: 5, gap: 10, description: 'A4 가로 · 세로형 2개' },
  소형: { pageWidth: 210, pageHeight: 297, columns: 2, rows: 2, count: 4, margin: 5, gap: 6, description: 'A4 세로 · 세로형 4개' }
};

const pictogramSources = new Map();
const pictogramCandidates = new Map();
const pictogramAutomaticGrades = new Map();
let unresolvedPictogramCount = 0;
let pictogramEmptyReason = '';
let previewWarningLabelData = null;
let previewResizeObserver = null;

let selectedFile = null;
let isAnalyzing = false;
let selectedProcessFile = null;
let isProcessAnalyzing = false;

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

function getSelectedLabelSize() {
  const selectedSize = document.querySelector('input[name="label-size"]:checked');
  if (!selectedSize) return null;
  if (selectedSize.value === 'custom') {
    const width = Number(customWidth.value);
    const height = Number(customHeight.value);
    return width > 0 && height > 0 ? {
      name: '직접 입력', pageWidth: width, pageHeight: height, columns: 1, rows: 1,
      count: 1, margin: 0, gap: 0, description: `${width} × ${height} mm`
    } : null;
  }
  const layout = PRINT_LAYOUTS[selectedSize.value];
  return layout ? { name: selectedSize.value, ...layout } : null;
}

function refreshSelectedLabelSize() {
  const size = getSelectedLabelSize();
  if (!size || results.hidden) return;
  selectedSizeText.textContent = `${size.name} · ${size.description}`;
  renderPrintPreview();
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
    refreshSelectedLabelSize();
  });
});
[customWidth, customHeight].forEach((input) => input.addEventListener('input', () => {
  updateAnalyzeButton();
  refreshSelectedLabelSize();
}));

const CIRCLED_ITEM_PATTERN = /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*/;
const LIST_ITEM_PATTERN = /^(?:(?:[가-하]|\d{1,2})\s*[.)·]\s*|[()（]\s*(?:[가-하]|\d{1,2})\s*[)）]\s*)/;

function stripListMarker(value) {
  return value.replace(/^[○●◎◇◆□■△▲▽▼※]\s*/, '').replace(CIRCLED_ITEM_PATTERN, '').replace(LIST_ITEM_PATTERN, '').trim();
}

function compactLabelText(value) {
  return stripListMarker(value).replace(/[\s|:：/·ㆍ・()（）\-]/g, '').toLowerCase();
}

const LABEL_FAMILIES = [
  { canonical: '제품명', pattern: /^(?:제품명|제품의명칭|화학제품명|상품명|물질명)/ },
  { canonical: '그림문자', pattern: /^(?:그림문자|픽토그램|pictogram)/i },
  { canonical: '신호어', pattern: /^신호어/ },
  { canonical: '공급자정보', pattern: /^(?:(?:공급자|유통업자|유통자|제조자)(?:유통업자|유통자)?정보|공급자유통업자정보)/ },
  { canonical: '공급자', pattern: /^(?:공급회사명|공급자명|유통회사명|유통업자명|제조회사명|제조사명|회사명|제조자명|공급자|유통업자|제조자)/ },
  { canonical: '연락처', pattern: /^(?:긴급연락전화번호|긴급전화번호|긴급연락전화|긴급전화|전화번호|연락처|전화|tel)/i }
];

function identifyKnownLabel(value) {
  const compact = compactLabelText(value);
  return LABEL_FAMILIES.find((definition) => definition.pattern.test(compact)) || null;
}

function normalizeKnownLabelLine(value) {
  const source = cleanLine(value);
  const markerless = stripListMarker(source);
  const spacedLabelPatterns = [
    { canonical: '제품명', pattern: /^(?:제\s*품\s*명|제품의\s*명칭|화학\s*제품명|상\s*품\s*명|물\s*질\s*명)(?=\s|[|:：]|$)/i },
    { canonical: '그림문자', pattern: /^(?:그\s*림\s*문\s*자|픽토그램|pictogram)(?=\s|[|:：]|$)/i },
    { canonical: '신호어', pattern: /^신\s*호\s*어(?=\s|[|:：]|$)/i },
    { canonical: '공급자정보', pattern: /^(?:공\s*급\s*자\s*(?:\/|\||및)?\s*(?:유\s*통\s*(?:업\s*)?자)?\s*정\s*보|공\s*급\s*자\s*\/\s*유\s*통\s*업\s*자\s*정\s*보)(?=\s|[|:：]|$)/i },
    { canonical: '공급자', pattern: /^(?:공급회사명|공급자명|유통회사명|유통업자명|제조회사명|제조사명|회사명|제조자명|공\s*급\s*자|유\s*통\s*업\s*자|제\s*조\s*자)(?=\s|[|:：]|$)/i },
    { canonical: '연락처', pattern: /^(?:긴급\s*(?:연락\s*)?전화(?:\s*번호)?|전화\s*번호|연\s*락\s*처|전화|tel\.?)\s*(?=\s|[|:：]|$)/i }
  ];
  const directMatch = spacedLabelPatterns.map((definition) => ({ definition, match: markerless.match(definition.pattern) })).find((candidate) => candidate.match);
  if (directMatch) {
    const remainder = markerless.slice(directMatch.match[0].length).replace(/^(?:\s*[|:：]\s*)+/, '').trim();
    return remainder ? `${directMatch.definition.canonical} | ${remainder}` : directMatch.definition.canonical;
  }
  const cells = markerless.split(/\s*\|\s*/).filter(Boolean);
  for (let count = Math.min(4, cells.length); count >= 1; count -= 1) {
    const labelSource = cells.slice(0, count).join(' ');
    const definition = identifyKnownLabel(labelSource);
    if (!definition) continue;
    const compact = compactLabelText(labelSource);
    const match = compact.match(definition.pattern);
    if (!match || match[0].length !== compact.length) continue;
    const valueText = cells.slice(count).join(' | ').trim();
    return valueText ? `${definition.canonical} | ${valueText}` : definition.canonical;
  }
  return source;
}

function estimateFontSize(item) {
  const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
  return Math.abs(Number(item.height)) || Math.hypot(Number(transform[2]) || 0, Number(transform[3]) || 0) || Math.hypot(Number(transform[0]) || 0, Number(transform[1]) || 0) || 0;
}

// 기존 문자열 결과와 함께 PDF.js 원본 item 및 좌표 기반 행/셀 구조를 보존한다.
function buildPageStructure(items, pageNumber) {
  const textItems = items
    .filter((item) => typeof item.str === 'string' && item.str.trim())
    .map((item, itemIndex) => ({
      page: pageNumber,
      text: item.str,
      x: Number(item.transform?.[4]) || 0,
      y: Number(item.transform?.[5]) || 0,
      width: Math.abs(Number(item.width)) || 0,
      height: Math.abs(Number(item.height)) || estimateFontSize(item),
      fontSize: estimateFontSize(item),
      itemIndex,
      raw: item
    }))
    .filter((item, index, allItems) => allItems.findIndex((candidate) => candidate.text === item.text && Math.abs(candidate.x - item.x) < 0.5 && Math.abs(candidate.y - item.y) < 0.5) === index)
    .sort((a, b) => b.y - a.y || a.x - b.x || a.itemIndex - b.itemIndex);
  const rows = [];
  textItems.forEach((item) => {
    const tolerance = Math.max(2, Math.min(5, item.fontSize * 0.35 || 3));
    let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(candidate.tolerance, tolerance));
    if (!row) {
      row = { page: pageNumber, y: item.y, tolerance, items: [] };
      rows.push(row);
    }
    row.items.push(item);
    row.y = row.items.reduce((sum, current) => sum + current.y, 0) / row.items.length;
    row.tolerance = Math.max(row.tolerance, tolerance);
  });
  rows.sort((a, b) => b.y - a.y).forEach((row, rowIndex) => {
    row.items.sort((a, b) => a.x - b.x || a.itemIndex - b.itemIndex);
    const cells = [];
    row.items.forEach((item) => {
      const previous = cells.at(-1)?.items.at(-1);
      const gap = previous ? item.x - (previous.x + previous.width) : 0;
      const cellThreshold = Math.max(12, (previous?.fontSize || item.fontSize || 8) * 1.6);
      if (!cells.length || gap > cellThreshold) cells.push({ items: [] });
      cells.at(-1).items.push(item);
    });
    cells.forEach((cell) => {
      cell.x = cell.items[0].x;
      cell.width = Math.max(...cell.items.map((item) => item.x + item.width)) - cell.x;
      cell.rawText = cell.items.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
    });
    row.rowNumber = rowIndex + 1;
    row.cells = cells;
    row.rawText = cells.map((cell) => cell.rawText).join(' | ');
    row.normalizedText = normalizeKnownLabelLine(normalizeCodesInText(row.rawText).normalized);
    row.text = row.normalizedText;
  });
  const text = rows.map((row) => row.text).filter(Boolean).join('\n');
  return { pageNumber, items: textItems, rawItems: items, rows, text };
}

function buildPageText(items, pageNumber = 1) {
  return buildPageStructure(items, pageNumber).text;
}

async function extractPdfText(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const pages = [];
  const pageStructures = [];
  const pageObjects = [];
  progressTitle.textContent = `총 ${pageCount}페이지를 확인했습니다.`;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    progressDetail.textContent = `${pageNumber} / ${pageCount} 페이지의 텍스트를 추출하는 중입니다.`;
    try {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent({ includeMarkedContent: false });
      const pageStructure = buildPageStructure(textContent.items, pageNumber);
      pageStructures.push(pageStructure);
      pages.push(pageStructure.text);
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
  return { pageCount, pages, pageStructures, pageObjects, pdfDocument: pdf };
}

const PICTOGRAM_LABEL_PATTERN = /(?:그\s*림\s*문\s*자|픽토그램|pictograms?)/i;
const PDF_MATRIX_IDENTITY = [1, 0, 0, 1, 0, 0];

function multiplyPdfMatrices(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5]
  ];
}

function transformedUnitBox(matrix) {
  const points = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => ({
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5]
  }));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function collectPageImageBoxes(operatorList) {
  const imageOperators = new Map([
    [pdfjsLib.OPS.paintImageXObject, 'image-xobject'],
    [pdfjsLib.OPS.paintInlineImageXObject, 'inline-image'],
    [pdfjsLib.OPS.paintImageMaskXObject, 'image-mask'],
    [pdfjsLib.OPS.paintSolidColorImageMask, 'solid-image-mask']
  ]);
  const boxes = [];
  const stack = [];
  let transform = [...PDF_MATRIX_IDENTITY];
  operatorList.fnArray.forEach((operation, index) => {
    const args = operatorList.argsArray[index] || [];
    if (operation === pdfjsLib.OPS.save) {
      stack.push([...transform]);
    } else if (operation === pdfjsLib.OPS.restore) {
      transform = stack.pop() || [...PDF_MATRIX_IDENTITY];
    } else if (operation === pdfjsLib.OPS.transform && args.length >= 6) {
      transform = multiplyPdfMatrices(transform, args.slice(0, 6).map(Number));
    } else if (imageOperators.has(operation)) {
      boxes.push({
        ...transformedUnitBox(transform),
        sourceType: imageOperators.get(operation),
        operatorIndex: index,
        objectName: typeof args[0] === 'string' ? args[0] : null
      });
    }
  });
  return boxes;
}

function getPictogramLabelRows(analysisResult) {
  return analysisResult.parserDebug.sectionTwoLines.filter((line) =>
    PICTOGRAM_LABEL_PATTERN.test(line.rawText || line.text)
  ).map((line) => {
    const items = line.items || [];
    const x = items.length ? Math.min(...items.map((item) => item.x)) : line.x;
    const right = items.length ? Math.max(...items.map((item) => item.x + item.width)) : x + (line.width || 0);
    const height = Math.max(line.height || 0, ...items.map((item) => item.height || 0), 8);
    return {
      page: line.pageNumber,
      text: line.rawText || line.text,
      bbox: { x, y: line.y - height * 0.25, width: right - x, height },
      explicitlyEmpty: /해당\s*없음|없\s*음|not\s+applicable|none/i.test(line.rawText || line.text)
    };
  });
}

function isSpatialPictogramCandidate(box, label) {
  const labelRight = label.bbox.x + label.bbox.width;
  const boxRight = box.x + box.width;
  const boxTop = box.y + box.height;
  const labelTop = label.bbox.y + label.bbox.height;
  const horizontalRelation = boxRight >= label.bbox.x - 8 && box.x <= labelRight + 430;
  const verticalRelation = boxTop >= label.bbox.y - 75 && box.y <= labelTop + 45;
  const plausibleSize = box.width >= 18 && box.height >= 18 && box.width <= 120 && box.height <= 120;
  const aspectRatio = box.width / Math.max(box.height, 0.01);
  return horizontalRelation && verticalRelation && plausibleSize && aspectRatio >= 0.55 && aspectRatio <= 1.8;
}

function cropRenderedPage(pageCanvas, viewport, box, scale) {
  const margin = 3;
  const rectangle = viewport.convertToViewportRectangle([
    box.x - margin,
    box.y - margin,
    box.x + box.width + margin,
    box.y + box.height + margin
  ]);
  const left = Math.max(0, Math.floor(Math.min(rectangle[0], rectangle[2])));
  const top = Math.max(0, Math.floor(Math.min(rectangle[1], rectangle[3])));
  const right = Math.min(pageCanvas.width, Math.ceil(Math.max(rectangle[0], rectangle[2])));
  const bottom = Math.min(pageCanvas.height, Math.ceil(Math.max(rectangle[1], rectangle[3])));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, right - left);
  canvas.height = Math.max(1, bottom - top);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(pageCanvas, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let redPixels = 0;
  let darkPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    if (red > 120 && red > green * 1.3 && red > blue * 1.3) redPixels += 1;
    if (red < 90 && green < 90 && blue < 90) darkPixels += 1;
  }
  const pixelCount = Math.max(1, canvas.width * canvas.height);
  return {
    canvas,
    imageData: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    renderScale: scale,
    redRatio: redPixels / pixelCount,
    darkRatio: darkPixels / pixelCount
  };
}

function findRenderedRedPictogramBoxes(pageCanvas, viewport, labels) {
  const { width, height } = pageCanvas;
  const pixels = pageCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  // Thin, anti-aliased vector diamonds may have sub-pixel gaps at the corners.
  // Tile grouping keeps one diamond connected without merging adjacent symbols.
  const tileSize = 4;
  const maskWidth = Math.ceil(width / tileSize);
  const maskHeight = Math.ceil(height / tileSize);
  const redMask = new Uint8Array(maskWidth * maskHeight);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
    if (red > 120 && red - green > 40 && red - blue > 40) {
      redMask[Math.floor(y / tileSize) * maskWidth + Math.floor(x / tileSize)] = 1;
    }
  }
  const groupedMask = new Uint8Array(redMask.length);
  for (let index = 0; index < redMask.length; index += 1) {
    if (!redMask[index]) continue;
    const x = index % maskWidth, y = Math.floor(index / maskWidth);
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const nextX = x + dx, nextY = y + dy;
      if (nextX >= 0 && nextX < maskWidth && nextY >= 0 && nextY < maskHeight) {
        groupedMask[nextY * maskWidth + nextX] = 1;
      }
    }
  }
  const visited = new Uint8Array(groupedMask.length);
  const boxes = [];
  for (let start = 0; start < groupedMask.length; start += 1) {
    if (!groupedMask[start] || visited[start]) continue;
    const queue = [start]; visited[start] = 1;
    let cursor = 0, count = 0, left = maskWidth, right = 0, top = maskHeight, bottom = 0;
    while (cursor < queue.length) {
      const pixel = queue[cursor++];
      const x = pixel % maskWidth;
      const y = Math.floor(pixel / maskWidth);
      count += 1;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nextX = x + dx, nextY = y + dy;
        if (nextX < 0 || nextX >= maskWidth || nextY < 0 || nextY >= maskHeight) continue;
        const next = nextY * maskWidth + nextX;
        if (groupedMask[next] && !visited[next]) { visited[next] = 1; queue.push(next); }
      }
    }
    const pixelLeft = left * tileSize;
    const pixelTop = top * tileSize;
    const pixelRight = Math.min(width, (right + 1) * tileSize);
    const pixelBottom = Math.min(height, (bottom + 1) * tileSize);
    if (count < 20 || pixelRight - pixelLeft < 40 || pixelBottom - pixelTop < 40) continue;
    const componentWidth = pixelRight - pixelLeft;
    const componentHeight = pixelBottom - pixelTop;
    const segmentCount = componentWidth / componentHeight > 1.8
      ? Math.max(2, Math.round(componentWidth / componentHeight)) : 1;
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const segmentLeft = pixelLeft + componentWidth * segment / segmentCount;
      const segmentRight = pixelLeft + componentWidth * (segment + 1) / segmentCount;
      const first = viewport.convertToPdfPoint(segmentLeft, pixelTop);
      const second = viewport.convertToPdfPoint(segmentRight, pixelBottom);
      boxes.push({ x: Math.min(first[0], second[0]), y: Math.min(first[1], second[1]), width: Math.abs(second[0] - first[0]), height: Math.abs(second[1] - first[1]), sourceType: 'rendered-red-vector', operatorIndex: -1, objectName: null });
    }
  }
  return boxes;
}

async function extractSectionTwoPictogramCrops(extracted, analysisResult) {
  const labels = getPictogramLabelRows(analysisResult);
  const crops = [];
  const candidates = [];
  const scale = 4;
  for (const pageNumber of [...new Set(labels.filter((label) => !label.explicitlyEmpty).map((label) => label.page))]) {
    const pageLabels = labels.filter((label) => label.page === pageNumber && !label.explicitlyEmpty);
    const page = await extracted.pdfDocument.getPage(pageNumber);
    const operatorList = await page.getOperatorList();
    const imageBoxes = collectPageImageBoxes(operatorList);
    const viewport = page.getViewport({ scale });
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = Math.ceil(viewport.width);
    pageCanvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: pageCanvas.getContext('2d'), viewport }).promise;
    const renderedBoxes = findRenderedRedPictogramBoxes(pageCanvas, viewport, pageLabels);
    const pageCandidates = [...imageBoxes, ...renderedBoxes].filter((box) => pageLabels.some((label) => isSpatialPictogramCandidate(box, label)))
      .filter((box, index, all) => all.findIndex((other) =>
        Math.abs((other.x + other.width / 2) - (box.x + box.width / 2)) < 5 &&
        Math.abs((other.y + other.height / 2) - (box.y + box.height / 2)) < 5 &&
        Math.abs(other.width - box.width) < 8 && Math.abs(other.height - box.height) < 8) === index)
      .sort((left, right) => left.x - right.x || right.y - left.y);
    candidates.push(...pageCandidates.map((candidate) => ({ page: pageNumber, ...candidate })));
    if (!pageCandidates.length) continue;
    pageCandidates.forEach((candidate) => {
      const rendered = cropRenderedPage(pageCanvas, viewport, candidate, scale);
      const hasPictogramAppearance = rendered.redRatio >= 0.002 && rendered.darkRatio >= 0.002;
      if (!hasPictogramAppearance) return;
      crops.push({
        page: pageNumber,
        bbox: { x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height },
        width: rendered.width,
        height: rendered.height,
        detectionConfidence: rendered.redRatio >= 0.01 ? 'high' : 'medium',
        sourceType: `${candidate.sourceType}+page-render`,
        cropCanvas: rendered.canvas,
        cropImageData: rendered.imageData,
        metrics: { redRatio: rendered.redRatio, darkRatio: rendered.darkRatio, renderScale: rendered.renderScale }
      });
    });
    pageCanvas.width = 1;
    pageCanvas.height = 1;
  }
  return {
    labelDetected: labels.length > 0,
    labels,
    candidateCount: candidates.length,
    candidates,
    crops,
    noPictogram: crops.length === 0
  };
}

const PICTOGRAM_COMPARE_SIZE = 128;
let normalizedGhsTemplatePromise;

function loadCanvasImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error(`그림문자 템플릿을 불러오지 못했습니다: ${source}`)), { once: true });
    image.src = source;
  });
}

function findColorBounds(pixels, width, height, predicate) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (!predicate(pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3])) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right >= left && bottom >= top ? { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 } : null;
}

function normalizePictogramCanvas(source, size = PICTOGRAM_COMPARE_SIZE) {
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = source.naturalWidth || source.width;
  sourceCanvas.height = source.naturalHeight || source.height;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  sourceContext.fillStyle = '#fff';
  sourceContext.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  sourceContext.drawImage(source, 0, 0, sourceCanvas.width, sourceCanvas.height);
  const sourcePixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
  const redBounds = findColorBounds(sourcePixels, sourceCanvas.width, sourceCanvas.height,
    (red, green, blue, alpha) => alpha > 32 && red > 110 && red > green * 1.25 && red > blue * 1.25);
  const contentBounds = redBounds || findColorBounds(sourcePixels, sourceCanvas.width, sourceCanvas.height,
    (red, green, blue, alpha) => alpha > 32 && Math.min(red, green, blue) < 220);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, size, size);
  if (contentBounds) {
    const padding = Math.round(size * 0.08);
    const targetSize = size - padding * 2;
    context.drawImage(sourceCanvas,
      contentBounds.left, contentBounds.top, contentBounds.width, contentBounds.height,
      padding, padding, targetSize, targetSize);
  }
  const pixels = context.getImageData(0, 0, size, size).data;
  const redMask = new Uint8Array(size * size);
  const blackMask = new Uint8Array(size * size);
  for (let pixel = 0; pixel < redMask.length; pixel += 1) {
    const index = pixel * 4;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const isRed = red > 105 && red > green * 1.2 && red > blue * 1.2;
    redMask[pixel] = isRed ? 1 : 0;
    blackMask[pixel] = !isRed && (red + green + blue) / 3 < 155 ? 1 : 0;
  }
  return { canvas, redMask, blackMask, redBounds, size };
}

function compareBinaryMasks(reference, candidate, size, offsetX = 0, offsetY = 0) {
  let intersection = 0;
  let union = 0;
  let referenceCount = 0;
  let candidateCount = 0;
  let paired = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const shiftedX = x + offsetX;
      const shiftedY = y + offsetY;
      const left = reference[y * size + x];
      const right = shiftedX >= 0 && shiftedX < size && shiftedY >= 0 && shiftedY < size
        ? candidate[shiftedY * size + shiftedX] : 0;
      intersection += left && right ? 1 : 0;
      union += left || right ? 1 : 0;
      referenceCount += left;
      candidateCount += right;
      paired += left * right;
    }
  }
  const count = size * size;
  const numerator = paired - (referenceCount * candidateCount) / count;
  const denominator = Math.sqrt(referenceCount * (1 - referenceCount / count) * candidateCount * (1 - candidateCount / count));
  return {
    iou: union ? intersection / union : 0,
    correlation: denominator ? numerator / denominator : 0
  };
}

function bestMaskComparison(reference, candidate, size) {
  let best = { iou: 0, correlation: -1, score: 0, offsetX: 0, offsetY: 0 };
  for (let offsetY = -3; offsetY <= 3; offsetY += 1) {
    for (let offsetX = -3; offsetX <= 3; offsetX += 1) {
      const metrics = compareBinaryMasks(reference, candidate, size, offsetX, offsetY);
      const score = metrics.iou * 0.55 + Math.max(0, metrics.correlation) * 0.45;
      if (score > best.score) best = { ...metrics, score, offsetX, offsetY };
    }
  }
  return best;
}

async function getNormalizedGhsTemplates() {
  if (!normalizedGhsTemplatePromise) {
    normalizedGhsTemplatePromise = Promise.all(GHS_PICTOGRAMS.map(async (pictogram) => {
      const image = await loadCanvasImage(pictogram.asset);
      return { code: pictogram.code, name: pictogram.name, ...normalizePictogramCanvas(image) };
    }));
  }
  return normalizedGhsTemplatePromise;
}

async function comparePictogramCrops(cropDetection) {
  if (!cropDetection.crops.length) return [];
  const templates = await getNormalizedGhsTemplates();
  return cropDetection.crops.map((crop, cropIndex) => {
    const normalizedCrop = normalizePictogramCanvas(crop.cropCanvas);
    const scores = templates.map((template) => ({
      code: template.code,
      name: template.name,
      ...bestMaskComparison(template.blackMask, normalizedCrop.blackMask, PICTOGRAM_COMPARE_SIZE)
    })).sort((left, right) => right.score - left.score);
    const first = scores[0];
    const second = scores[1];
    return {
      cropIndex: cropIndex + 1,
      page: crop.page,
      bbox: crop.bbox,
      detectionConfidence: crop.detectionConfidence,
      first: { code: first.code, score: first.score, iou: first.iou, correlation: first.correlation },
      second: { code: second.code, score: second.score, iou: second.iou, correlation: second.correlation },
      scoreGap: first.score - second.score,
      scores,
      normalizedCanvas: normalizedCrop.canvas
    };
  });
}

function cleanLine(line) {
  return line.replace(/^[\s:：·•\-–—]+|[\s]+$/g, '').trim();
}

function normalized(line) {
  return line.replace(/\s+/g, '').replace(/[ㆍ·・]/g, '·').toLowerCase();
}

function normalizeCodesInText(value) {
  const matches = [];
  const normalizedValue = value.replace(/\b([HP])\s*(\d(?:\s*\d){2})(?=(?:\s*\+\s*[HP]\s*\d)|\b|\s|[.,;:：)）])/gi, (original, prefix, digits) => {
    const code = `${prefix.toUpperCase()}${digits.replace(/\s/g, '')}`;
    matches.push({ original, normalized: code });
    return code;
  }).replace(/\s*\+\s*(?=[HP]\d{3}\b)/gi, '+');
  return { original: value, normalized: normalizedValue, matches };
}

const PHONE_PATTERN = /(?<!\d)(?:(?:\+?82\s*[-)]?\s*)?(?:\(\s*)?0\d{1,2}\s*(?:\)\s*|[-\s])\s*\d{3,4}\s*(?:-|\s)\s*\d{4}|\+?82\s*[-)]?\s*\d{1,2}\s*(?:-|\s)\s*\d{3,4}\s*(?:-|\s)\s*\d{4}|0(?:2\d{7,8}|\d{9,10}))(?!\d)/;

function normalizePhone(raw) {
  const value = raw.trim().replace(/\s+/g, ' ');
  const hasKoreaPrefix = /^\+?82/.test(value);
  const localValue = hasKoreaPrefix ? value.replace(/^\+?82\s*[-)]?\s*/, '0') : value;
  const separated = localValue.replace(/[()]/g, '').split(/\s*-\s*|\s+/).filter(Boolean);
  if (separated.length === 3 && /^0\d{1,2}$/.test(separated[0]) && /^\d{3,4}$/.test(separated[1]) && /^\d{4}$/.test(separated[2])) return separated.join('-');
  const digits = localValue.replace(/\D/g, '');
  const areaLength = digits.startsWith('02') ? 2 : 3;
  const match = digits.match(new RegExp(`^(0\\d{${areaLength - 1}})(\\d{3,4})(\\d{4})$`));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function extractPhone(value) {
  const match = value.match(PHONE_PATTERN);
  if (!match) return null;
  const normalizedPhone = normalizePhone(match[0]);
  return normalizedPhone ? { original: match[0], normalized: normalizedPhone } : null;
}

function isSectionHeading(line, number) {
  const value = normalized(line).replace(/[.·ㆍ•:：()\-]/g, '');
  const titlePatterns = {
    1: /^화학제품(?:과|및)?회사(?:에관한)?정보$/,
    2: /^유해성?위험성$/,
    3: /^구성성분(?:의)?명칭(?:및|과)?함유량$/
  };
  const withoutSectionNumber = value.replace(new RegExp(`^(?:제?${number}(?:항|장)?)`), '');
  return titlePatterns[number]?.test(withoutSectionNumber) || false;
}

function buildDocumentLines(source) {
  const structuredPages = Array.isArray(source?.pageStructures) ? source.pageStructures : null;
  if (structuredPages?.length) {
    return structuredPages.flatMap((page) => page.rows.map((row, lineIndex) => ({
      text: cleanLine(row.normalizedText || row.text || row.rawText),
      rawText: row.rawText,
      pageNumber: page.pageNumber,
      lineNumber: lineIndex + 1,
      x: row.items[0]?.x ?? 0,
      y: row.y,
      width: row.items.length ? Math.max(...row.items.map((item) => item.x + item.width)) - row.items[0].x : 0,
      height: Math.max(0, ...row.items.map((item) => item.height)),
      cells: row.cells,
      items: row.items,
      source: 'coordinates'
    })).filter((line) => line.text));
  }
  const pages = Array.isArray(source) ? source : source?.pages || [];
  return pages.flatMap((pageText, pageIndex) => pageText.split(/\r?\n/).map((text, lineIndex) => ({
    text: cleanLine(text), rawText: text, pageNumber: pageIndex + 1, lineNumber: lineIndex + 1, source: 'legacy'
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
  return Boolean(identifyKnownLabel(line)) || /^(?:[가-하]\.?\s*)?(주소|담당부서|유해.*위험문구|유해위험문구|예방조치문구)/.test(normalized(line));
}

function extractCodedStatements(lines, prefix) {
  const codePattern = prefix === 'H' ? /\bH\d{3}\b/i : /\bP\d{3}(?:\+P\d{3})*\b/i;
  const results = [];
  for (let index = 0; index < lines.length; index += 1) {
    const codeMatch = lines[index].match(codePattern);
    if (!codeMatch) continue;
    let statement = cleanLine(lines[index].slice(codeMatch.index));
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const next = cleanLine(lines[nextIndex]);
      if (!next || isPdfNoiseLine(next)) continue;
      if (/^[HP]\d{3}\b/i.test(next) || /^[가-하]\.\s*/.test(next) || getPrecautionCategory(next) || isKnownLabel(next) || isSectionHeading(next, 3)) break;
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
  const match = line.match(/^(?:(?:[가-하]\.?)|(?:\d{1,2}[.)]))?\s*(?:예방조치\s*문구\s*(?:\|\s*)?)?[\[［【(（]?\s*(예방|대응|저장|폐기)\s*[\]］】)）]?(?:\s*[|:：-]\s*|\s+(?=P\d{3})|\s*$)/);
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

function furnitureFingerprint(value) {
  const compact = normalized(value)
    .replace(/(?:page)?\d{1,3}(?:\/|of)\d{1,3}/gi, 'page#/#')
    .replace(/\d{4}[./-]\d{1,2}[./-]\d{1,2}/g, 'date#')
    .replace(/(?:revision|rev)\.?\d+(?:\.\d+)*/gi, 'rev#');
  return compact.replace(/[.,:：()（）\[\]\-_/]/g, '');
}

function findRepeatedPageFurnitureByPosition(documentLines) {
  const coordinateLines = documentLines.filter((line) => line.source === 'coordinates' && Number.isFinite(line.y));
  const pageBounds = new Map();
  coordinateLines.forEach((line) => {
    const bounds = pageBounds.get(line.pageNumber) || { min: line.y, max: line.y };
    bounds.min = Math.min(bounds.min, line.y);
    bounds.max = Math.max(bounds.max, line.y);
    pageBounds.set(line.pageNumber, bounds);
  });
  const occurrences = new Map();
  coordinateLines.forEach((line) => {
    if (/\b[HP]\d{3}\b/i.test(line.text) || getPrecautionCategory(line.text) || [1, 2, 3].some((number) => isSectionHeading(line.text, number))) return;
    const bounds = pageBounds.get(line.pageNumber);
    const span = Math.max(1, bounds.max - bounds.min);
    const position = (line.y - bounds.min) / span;
    const zone = position >= 0.82 ? 'top' : position <= 0.18 ? 'bottom' : '';
    if (!zone) return;
    const fingerprint = furnitureFingerprint(line.text);
    if (!fingerprint || fingerprint.length < 2) return;
    const key = `${zone}:${fingerprint}`;
    const entries = occurrences.get(key) || [];
    if (!entries.some((entry) => entry.pageNumber === line.pageNumber)) entries.push({ ...line, position, fingerprint, zone });
    occurrences.set(key, entries);
  });
  const pageCount = pageBounds.size;
  const minimumPages = Math.max(2, Math.ceil(pageCount * 0.3));
  const keys = new Set();
  const removedRows = [];
  occurrences.forEach((entries, key) => {
    if (entries.length < minimumPages) return;
    const positions = entries.map((entry) => entry.position);
    if (Math.max(...positions) - Math.min(...positions) > 0.08) return;
    keys.add(key);
    removedRows.push(...entries);
  });
  return {
    keys,
    removedRows,
    isFurniture(line) {
      if (line.source !== 'coordinates' || !Number.isFinite(line.y)) return false;
      const bounds = pageBounds.get(line.pageNumber);
      if (!bounds) return false;
      const span = Math.max(1, bounds.max - bounds.min);
      const position = (line.y - bounds.min) / span;
      const zone = position >= 0.82 ? 'top' : position <= 0.18 ? 'bottom' : '';
      return zone ? keys.has(`${zone}:${furnitureFingerprint(line.text)}`) : false;
    }
  };
}

function stripStatementPrefix(value, matchIndex) {
  return cleanLine(value.slice(matchIndex)).replace(/^\|\s*/, '').replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function isStatementBoundary(line) {
  const value = cleanLine(line).replace(/\s*\|\s*/g, ' ');
  const markerless = stripListMarker(value);
  return CIRCLED_ITEM_PATTERN.test(value) || LIST_ITEM_PATTERN.test(value) || [1, 2, 3].some((number) => isSectionHeading(value, number)) || Boolean(getPrecautionCategory(value)) || /^(?:유해[·ㆍ-]?위험문구|예방조치\s*문구|신호어|그림문자|픽토그램|유해성?\s*[·ㆍ-]?\s*위험성?\s*분류|분류기준|nfpa\s*등급)/i.test(markerless);
}

function statementKey(statement) {
  return `${statement.code}\u0000${normalized(statement.finalText).replace(/[.,:：;()（）]/g, '')}`;
}

function parseStructuredStatements(sectionLines, prefix, furniture) {
  const codePattern = prefix === 'H' ? /\bH\d{3}\b/i : /\bP\d{3}(?:\+P\d{3})*\b/i;
  const anyCodePattern = /\b[HP]\d{3}(?:\+P\d{3})*\b/i;
  const statements = [];
  let current = null;

  function saveCurrent() {
    if (!current) return;
    current.finalText = current.fragments.join(' ').replace(/\s+/g, ' ').replace(/\s+([.,;:：)）])/g, '$1').trim();
    current.originalText = current.originalFragments.join('\n').trim();
    delete current.fragments;
    delete current.originalFragments;
    if (current.finalText) statements.push(current);
    current = null;
  }

  sectionLines.forEach((line, sectionIndex) => {
    if (furniture.isFurniture(line) || isPdfNoiseLine(line.text)) return;
    const text = cleanLine(line.text);
    const codeMatch = text.match(codePattern);
    const otherCodeMatch = text.match(anyCodePattern);
    if (codeMatch) {
      saveCurrent();
      const sourceText = stripStatementPrefix(text, codeMatch.index);
      current = {
        code: codeMatch[0].toUpperCase(),
        finalText: '',
        originalText: '',
        page: line.pageNumber,
        sourceRows: [{ page: line.pageNumber, line: line.lineNumber, x: line.x, y: line.y, text: line.text, rawText: line.rawText }],
        startLine: line,
        sectionIndex,
        fragments: [sourceText],
        originalFragments: [line.rawText || line.text],
        confidence: '높음'
      };
      return;
    }
    if (!current) return;
    const inlineBoundary = text.match(/(?:^|\s)(?:예방|대응|저장|폐기)\s*(?:\||:：)?\s*해당\s*없음(?=\s|$)/);
    if (inlineBoundary) {
      const leadingText = text.slice(0, inlineBoundary.index).replace(/\s*\|\s*/g, ' ').trim();
      if (leadingText) {
        current.fragments.push(leadingText);
        current.originalFragments.push(line.rawText || line.text);
        current.sourceRows.push({ page: line.pageNumber, line: line.lineNumber, x: line.x, y: line.y, text: leadingText, rawText: line.rawText });
      }
      saveCurrent();
      return;
    }
    const boundaryCellIndex = (line.cells || []).findIndex((cell) => categoryFromCell(cell));
    if (boundaryCellIndex >= 0) {
      const leadingText = line.cells.slice(0, boundaryCellIndex).map((cell) => cell.rawText).join(' ').replace(/\s+/g, ' ').trim();
      if (leadingText) {
        current.fragments.push(leadingText);
        current.originalFragments.push(leadingText);
        current.sourceRows.push({ page: line.pageNumber, line: line.lineNumber, x: line.x, y: line.y, text: leadingText, rawText: line.rawText });
      }
      saveCurrent();
      return;
    }
    if (otherCodeMatch || isStatementBoundary(text) || isKnownLabel(text)) {
      saveCurrent();
      return;
    }
    const continuation = text.replace(/^\|\s*/, '').replace(/\s*\|\s*/g, ' ').trim();
    if (!continuation) return;
    current.fragments.push(continuation);
    current.originalFragments.push(line.rawText || line.text);
    current.sourceRows.push({ page: line.pageNumber, line: line.lineNumber, x: line.x, y: line.y, text: line.text, rawText: line.rawText });
  });
  saveCurrent();

  const seen = new Set();
  return statements.filter((statement) => {
    const key = statementKey(statement);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function categoryFromCell(cell) {
  const value = cleanLine(cell?.rawText || '').replace(/^(?:(?:[가-하]\.?)|(?:\d{1,2}[.)]))\s*/, '').replace(/[\[\]［］【】()（）|:：\-]/g, '').trim();
  const match = value.match(/^(예방|대응|저장|폐기)(?:\s*해당\s*없음)?$/);
  return match ? match[1] : '';
}

function collectCategoryAnchors(sectionLines) {
  const anchors = [];
  sectionLines.forEach((line, sectionIndex) => {
    const cells = line.cells || [];
    cells.forEach((cell, cellIndex) => {
      const category = categoryFromCell(cell);
      if (category) anchors.push({ category, page: line.pageNumber, x: cell.x, y: line.y, width: cell.width, sectionIndex, cellIndex, line });
    });
    const lineCategory = getPrecautionCategory(line.text);
    if (lineCategory && !anchors.some((anchor) => anchor.sectionIndex === sectionIndex && anchor.category === lineCategory)) {
      anchors.push({ category: lineCategory, page: line.pageNumber, x: line.x || 0, y: line.y || 0, width: line.width || 0, sectionIndex, cellIndex: -1, line });
    }
  });
  return anchors;
}

function categorizeStructuredPrecautions(statements, sectionLines, fallback) {
  const categories = { 예방: [], 대응: [], 저장: [], 폐기: [] };
  const uncategorized = [];
  const anchors = collectCategoryAnchors(sectionLines);
  const fallbackByCode = new Map();
  Object.entries(fallback.categories).forEach(([category, values]) => values.forEach((value) => {
    const code = value.match(/^P\d{3}(?:\+P\d{3})*/i)?.[0];
    if (code && !fallbackByCode.has(code)) fallbackByCode.set(code, category);
  }));

  statements.forEach((statement) => {
    const row = statement.startLine;
    const rowAnchors = anchors.filter((anchor) => anchor.sectionIndex === statement.sectionIndex);
    const precedingAnchor = [...anchors].reverse().find((anchor) => anchor.sectionIndex <= statement.sectionIndex);
    let selected = rowAnchors[0] || precedingAnchor || null;
    let confidence = selected ? '높음' : '';
    if (!selected && Number.isFinite(row.y)) {
      const pageAnchors = anchors.filter((anchor) => anchor.page === row.pageNumber).sort((a, b) => b.y - a.y);
      const pageStatementYs = statements.filter((candidate) => candidate.startLine.pageNumber === row.pageNumber).map((candidate) => candidate.startLine.y).filter(Number.isFinite).sort((a, b) => b - a);
      const rowGaps = pageStatementYs.slice(1).map((value, index) => pageStatementYs[index] - value).filter((gap) => gap > 1 && gap < 50).sort((a, b) => a - b);
      const rowGap = rowGaps.length ? rowGaps[Math.floor(rowGaps.length / 2)] : 10;
      const centeredCandidates = pageAnchors.map((anchor, index) => {
        if (/\bP\d{3}/i.test(anchor.line.text)) return false;
        if (/해당\s*없음/.test(anchor.line.text)) return false;
        const previous = pageAnchors[index - 1];
        const next = pageAnchors[index + 1];
        const upper = previous ? (previous.y + anchor.y) / 2 + rowGap * 0.75 : Number.POSITIVE_INFINITY;
        const lower = next ? (anchor.y + next.y) / 2 - rowGap * 1.5 : Number.NEGATIVE_INFINITY;
        return row.y <= upper && row.y >= lower ? anchor : null;
      }).filter(Boolean).sort((a, b) => b.sectionIndex - a.sectionIndex);
      selected = centeredCandidates[0] || null;
      if (selected) confidence = '중간';
    }
    if (!selected) {
      const sameColumnCandidates = anchors.filter((anchor) => anchor.sectionIndex < statement.sectionIndex && anchor.page === row.pageNumber && Math.abs((anchor.x || 0) - (row.x || 0)) <= Math.max(30, anchor.width || 0))
        .map((anchor) => ({ anchor, distance: statement.sectionIndex - anchor.sectionIndex }))
        .sort((a, b) => a.distance - b.distance);
      if (sameColumnCandidates[0]?.distance <= 12) {
        selected = sameColumnCandidates[0].anchor;
        confidence = '중간';
      }
    }
    if (!selected) {
      selected = [...anchors].reverse().find((anchor) => anchor.sectionIndex < statement.sectionIndex) || null;
      if (selected) confidence = statement.sectionIndex - selected.sectionIndex <= 15 ? '중간' : '낮음';
    }
    if (!selected) {
      const fallbackCategory = fallbackByCode.get(statement.code);
      if (fallbackCategory) selected = { category: fallbackCategory };
      if (selected) confidence = '낮음';
    }
    statement.category = selected?.category || '미분류';
    statement.confidence = confidence || '확인 필요';
    const target = statement.category === '미분류' ? uncategorized : categories[statement.category];
    target.push(statement.finalText);
  });
  statements.forEach((statement) => {
    delete statement.startLine;
    delete statement.sectionIndex;
  });
  return { categories, uncategorized, statements, anchors };
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
      line = cleanLine(line.replace(/^(?:(?:[가-하]\.?)|(?:\d{1,2}[.)]))?\s*(?:예방조치\s*문구\s*(?:\|\s*)?)?[\[［【(（]?\s*(?:예방|대응|저장|폐기)\s*[\]］】)）]?(?:\s*[|:：-]\s*|\s+(?=P\d{3})|\s*$)/, ''));
      if (!line) return;
    }
    if (/^P\d{3}(?:\+P\d{3})*\b/i.test(line)) {
      saveStatement();
      currentStatement = line;
      return;
    }
    if (currentStatement && !/^H\d{3}\b/i.test(line) && !/^[가-하]\.\s*/.test(line) && !isKnownLabel(line) && !isSectionHeading(line, 3)) {
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
    const inlineValue = cleanLine(lines[index].replace(pattern, '')).replace(/^(?:\|\s*)+/, '').trim();
    if (inlineValue) return inlineValue.split(/\s*\|\s*/)[0].trim();
    for (let offset = 1; offset <= maxFollowingLines && index + offset < lines.length; offset += 1) {
      const candidate = cleanLine(lines[index + offset]);
      if (!candidate || isPdfNoiseLine(candidate)) continue;
      if (isKnownLabel(candidate) || isSectionHeading(candidate, 2)) break;
      return candidate.replace(/^(?:\|\s*)+/, '').split(/\s*\|\s*/)[0].trim();
    }
  }
  return '';
}

function extractSupplierData(lines) {
  const preferredSupplierPatterns = [
    /^(?:[가-하]\.?)?\s*공급자정보\s*(?:[|:：]\s*)?/i,
    /^(?:[가-하]\.?)?\s*(?:유통회사명|공급회사명?|공급자명|유통업자명)\s*(?:[|:：]\s*)?/i,
    /^(?:[가-하]\.?)?\s*(?:공급자|유통업자)(?=\s*[|:：])\s*(?:[|:：]\s*)?/i,
    /^(?:[○●◎◇◆□■△▲▽▼※]\s*)?(?:생산\s*및\s*)?공급\s*회사명\s*(?:[|:：]\s*)?/i
  ];
  const manufacturerPatterns = [
    /^(?:[○●◎◇◆□■△▲▽▼※]\s*)?(?:생산\s*및\s*)?공급\s*회사명\s*(?:[|:：]\s*)?/i,
    /^(?:[가-하]\.?)?\s*(?:제조회사명|제조사명|공급자명|유통업자명|회사명|제조자명)\s*(?:[|:：]\s*)?/i,
    /^(?:[가-하]\.?)?\s*제조자\s*(?:[|:：]\s*)?/i
  ];
  let supplierName = extractFieldValue(lines, preferredSupplierPatterns, 2) || extractFieldValue(lines, manufacturerPatterns, 2);
  const invalidSupplier = (value) => {
    const compact = cleanLine(value).replace(/[\s|/:：·ㆍ・()（）-]/g, '');
    return !value || /수입품|정보\s*기재|긴급\s*연락\s*가능/i.test(value)
      || /^(?:정보|배급업자|유통업자|제조자)$/i.test(value)
      || /^(?:(?:제조자)?수입자유통업자정보|공급자유통(?:업자)?정보)$/i.test(compact);
  };
  if (invalidSupplier(supplierName)) {
    supplierName = extractFieldValue(lines, manufacturerPatterns, 2) || lines.map((line) => {
      const match = line.match(/^공급자\s*\|\s*(.+)$/i);
      return match ? match[1].split(/\s*\|\s*/)[0].trim() : '';
    }).filter((candidate) => !invalidSupplier(candidate)).at(-1) || '';
  }
  const supplierHeadingIndex = lines.findIndex((line) => /공급자\s*\/?\s*유통업자\s*정보|공급자\s*정보|공급자정보|제조자\s*정보/i.test(line));
  if (!supplierName && supplierHeadingIndex >= 0) {
    supplierName = lines.slice(supplierHeadingIndex + 1, supplierHeadingIndex + 10)
      .map(cleanLine)
      .find((line) => line && !isPdfNoiseLine(line) && !/주소|전화|연락처|긴급|담당부서|팩스|fax/i.test(line) && !isKnownLabel(line)) || '';
  }
  supplierName = supplierName
    .replace(/^(?:공급자\s*\/?\s*유통업자\s*정보|공급자\s*정보|공급자정보|제조회사명|공급자명|회사명)\s*(?:[|:：]\s*)?/i, '')
    .split(/(?:주소|전화|연락처|긴급전화|담당부서)\s*[:：]?/i)[0]
    .replace(PHONE_PATTERN, '')
    .replace(/^정보\s*\|\s*/i, '')
    .split(/\s*\|\s*/)[0]
    .trim();

  const phoneLabelIndex = lines.findIndex((line) => /긴급(?:연락)?전화(?:번호)?|연락처|전화번호/i.test(line));
  const nearbyPhoneLine = phoneLabelIndex >= 0
    ? lines.slice(phoneLabelIndex, phoneLabelIndex + 3).find((line) => PHONE_PATTERN.test(line)) : '';
  const labelledPhoneLine = lines.find((line) => /긴급(?:연락)?전화(?:번호)?|연락처|전화(?:번호)?|tel\.?/i.test(line) && PHONE_PATTERN.test(line));
  const fallbackPhoneLine = lines.find((line) => PHONE_PATTERN.test(line));
  const phone = extractPhone(nearbyPhoneLine || labelledPhoneLine || fallbackPhoneLine || '');
  return { supplierName, contact: phone?.normalized || '', contactOriginal: phone?.original || '' };
}

function formatPrecautionEditor(data) {
  const blocks = Object.entries(data.categories)
    .filter(([, statements]) => statements.length)
    .map(([category, statements]) => `${category}\n${statements.join('\n')}`);
  if (data.uncategorized.length) blocks.push(`미분류\n${data.uncategorized.join('\n')}`);
  return blocks.join('\n\n');
}

// 명시된 제목·레이블·코드만 사용하며 누락된 내용을 추정하지 않는다.
function analyzeMsdsText(source) {
  const pages = Array.isArray(source) ? source : source.pages;
  let documentLines = buildDocumentLines(source);
  let locations = locateMsdsSections(documentLines);
  if (!Array.isArray(source) && source.pageStructures?.length && [locations.one, locations.two, locations.three].some((index) => index < 0)) {
    const legacyLines = buildDocumentLines(pages);
    const legacyLocations = locateMsdsSections(legacyLines);
    const structuredCount = [locations.one, locations.two, locations.three].filter((index) => index >= 0).length;
    const legacyCount = [legacyLocations.one, legacyLocations.two, legacyLocations.three].filter((index) => index >= 0).length;
    if (legacyCount > structuredCount) {
      documentLines = legacyLines;
      locations = legacyLocations;
    }
  }
  const repeatedNoise = findRepeatedPageFurniture(pages);
  const repeatedFurniture = findRepeatedPageFurnitureByPosition(documentLines);
  const sectionOneLines = locations.one >= 0 && locations.two > locations.one
    ? documentLines.slice(locations.one + 1, locations.two) : [];
  const sectionTwoLines = locations.two >= 0
    ? documentLines.slice(locations.two + 1, locations.three > locations.two ? locations.three : documentLines.length) : [];
  const filteredSectionTwoLines = sectionTwoLines.filter((line) => !repeatedFurniture.isFurniture(line) && !isPdfNoiseLine(line.text, repeatedNoise));
  const cleanSection = (sectionLines) => sectionLines
    .filter((line) => !isPdfNoiseLine(line.text, repeatedNoise))
    .map((line) => line.text);
  const allTextLines = documentLines.map((line) => line.text);
  const productSearch = cleanSection(sectionOneLines).length ? cleanSection(sectionOneLines) : allTextLines;
  const hazardSearch = filteredSectionTwoLines.length ? filteredSectionTwoLines.map((line) => line.text) : (cleanSection(sectionTwoLines).length ? cleanSection(sectionTwoLines) : allTextLines);
  const itemPrefix = '(?:[가-하]\\.?\\s*)?';
  const productName = extractFieldValue(productSearch, [new RegExp(`^${itemPrefix}(?:제품명|제품의\\s*명칭|화학제품명|상품명|물질명)\\s*(?:[|:：]\\s*)?`, 'i')], 2);
  const supplier = extractSupplierData(productSearch);
  const supplierInfo = [supplier.supplierName, supplier.contact ? `연락처: ${supplier.contact}` : ''].filter(Boolean).join('\n');
  const signalWord = extractFieldValue(hazardSearch, [new RegExp(`^${itemPrefix}신호어\\s*(?:[|:：]\\s*)?`, 'i')], 1);
  const legacyHStatements = extractCodedStatements(hazardSearch, 'H');
  const legacyPrecautions = collectCategorizedPrecautions(hazardSearch, repeatedNoise);
  const structuredHStatements = filteredSectionTwoLines.length ? parseStructuredStatements(filteredSectionTwoLines, 'H', repeatedFurniture) : [];
  const structuredPStatements = filteredSectionTwoLines.length ? parseStructuredStatements(filteredSectionTwoLines, 'P', repeatedFurniture) : [];
  const hStatementRecords = structuredHStatements.length ? structuredHStatements : legacyHStatements.map((text) => ({
    code: text.match(/^H\d{3}/i)?.[0] || '', finalText: text, originalText: text, page: null, sourceRows: [], confidence: '낮음'
  }));
  const categorizedPrecautions = structuredPStatements.length
    ? categorizeStructuredPrecautions(structuredPStatements, filteredSectionTwoLines, legacyPrecautions)
    : { ...legacyPrecautions, statements: [], anchors: [] };
  const pictogramText = hazardSearch.filter((line) => /그림문자|픽토그램|pictogram/i.test(line)).join('\n');
  return {
    productName,
    supplierInfo,
    signalWord,
    hazardStatements: hStatementRecords.map((statement) => statement.finalText).join('\n'),
    precautionStatements: formatPrecautionEditor(categorizedPrecautions),
    pictogramText,
    parserDebug: {
      locations,
      documentLines,
      sectionTwoLines,
      sectionTwoText: filteredSectionTwoLines.map((line) => line.text).join('\n'),
      sectionTwoOriginalText: sectionTwoLines.map((line) => line.rawText || line.text).join('\n'),
      removedFurniture: sectionTwoLines.filter((line) => repeatedFurniture.isFurniture(line)).map((line) => ({
        page: line.pageNumber, line: line.lineNumber, x: line.x, y: line.y, text: line.text, rawText: line.rawText
      })),
      hStatements: hStatementRecords,
      pStatements: categorizedPrecautions.statements,
      categoryAnchors: categorizedPrecautions.anchors,
      hCodes: hStatementRecords.map((statement) => statement.code).filter(Boolean),
      precautionCodes: Object.fromEntries(Object.entries(categorizedPrecautions.categories).map(([category, statements]) => [category, statements.map((statement) => statement.match(/^P\d{3}(?:\+P\d{3})*/i)?.[0]).filter(Boolean)])),
      supplier,
      codeNormalizations: documentLines.flatMap((line) => normalizeCodesInText(line.rawText || line.text).matches.map((match) => ({
        page: line.pageNumber, line: line.lineNumber, ...match
      })))
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
    label.innerHTML = `<input type="checkbox" value="${pictogram.code}"><span><img src="${pictogram.asset}" alt=""><b>${pictogram.name}<br>${pictogram.code}<small class="pictogram-card-status" aria-live="polite"></small></b></span>`;
    label.querySelector('input').addEventListener('change', (event) => {
      if (event.target.checked) pictogramSources.set(pictogram.code, '직접 선택');
      if (!event.target.checked) pictogramSources.delete(pictogram.code);
      renderSelectedPictograms();
    });
    return label;
  }));
}

function renderSelectedPictograms() {
  const selected = GHS_PICTOGRAMS.filter((pictogram) => pictogramSources.has(pictogram.code));
  pictogramOptions.querySelectorAll('.pictogram-choice').forEach((choice) => {
    const code = choice.querySelector('input').value;
    const badge = choice.querySelector('.pictogram-card-status');
    const source = pictogramSources.get(code);
    const grade = pictogramAutomaticGrades.get(code);
    badge.textContent = source === '직접 선택'
      ? '직접 선택'
      : grade === 'A' ? 'MSDS에서 자동 확인'
        : pictogramCandidates.has(code) ? '확인 필요' : '';
    badge.dataset.grade = source === '직접 선택' ? 'manual' : (grade || '');
  });
  const resultRows = selected.map((pictogram) => {
      const row = document.createElement('div');
      row.className = 'identified-pictogram';
      row.innerHTML = `<img src="${pictogram.asset}" alt=""><strong>${pictogram.name} (${pictogram.code})</strong><span>${pictogramSources.get(pictogram.code)}</span>`;
      return row;
    });
  GHS_PICTOGRAMS.filter((pictogram) => pictogramCandidates.has(pictogram.code) && !pictogramSources.has(pictogram.code)).forEach((pictogram) => {
    const row = document.createElement('div');
    row.className = 'identified-pictogram pictogram-candidate';
    row.innerHTML = `<img src="${pictogram.asset}" alt=""><strong>${pictogram.name} (${pictogram.code})</strong><span>확인 필요</span>`;
    resultRows.push(row);
  });
  if (unresolvedPictogramCount) {
    resultRows.push(Object.assign(document.createElement('p'), {
      className: 'pictogram-unresolved',
      textContent: '자동 판별이 어려운 그림문자가 있습니다. MSDS를 확인해 직접 선택해주세요.'
    }));
  }
  if (!resultRows.length) {
    const message = pictogramEmptyReason === 'declared-none'
      ? 'MSDS 그림문자 항목에 해당 없음으로 표시되어 있습니다. 필요한 경우 직접 선택할 수 있습니다.'
      : pictogramEmptyReason === 'not-found'
        ? 'MSDS에서 그림문자 영역을 찾지 못했습니다. 원본을 확인해 직접 선택해 주세요.'
        : '자동 식별된 그림문자가 없습니다. 원본 MSDS를 확인해 직접 선택해 주세요.';
    resultRows.push(Object.assign(document.createElement('p'), { textContent: message }));
  }
  pictogramResults.replaceChildren(...resultRows);
  statusPictograms.textContent = selected.length
    ? `${selected.length}개 선택됨`
    : pictogramCandidates.size || unresolvedPictogramCount ? '확인 필요' : '선택 없음';
  renderPrintPreview();
}

function classifyPictogramComparison(comparison) {
  const reliableCrop = comparison.detectionConfidence === 'high';
  if (!reliableCrop || comparison.first.score < 0.45 || comparison.scoreGap < 0.10) return 'C';
  if (comparison.first.score >= 0.75 && comparison.scoreGap >= 0.20) return 'A';
  if (comparison.first.score >= 0.65 && comparison.scoreGap >= 0.25) return 'A';
  return 'B';
}

function applyDetectedPictograms(evidence) {
  pictogramSources.clear();
  pictogramCandidates.clear();
  pictogramAutomaticGrades.clear();
  unresolvedPictogramCount = 0;
  const cropDetection = evidence.cropDetection;
  const comparisons = cropDetection?.comparisons || [];
  comparisons.forEach((comparison) => { comparison.grade = classifyPictogramComparison(comparison); });
  comparisons.filter((comparison) => comparison.grade === 'A').forEach((comparison) => {
    pictogramAutomaticGrades.set(comparison.first.code, 'A');
    pictogramSources.set(comparison.first.code, 'MSDS에서 자동 확인');
  });
  comparisons.filter((comparison) => comparison.grade === 'B').forEach((comparison) => {
    if (!pictogramAutomaticGrades.has(comparison.first.code)) {
      pictogramAutomaticGrades.set(comparison.first.code, 'B');
      pictogramCandidates.set(comparison.first.code, comparison);
    }
  });
  unresolvedPictogramCount = comparisons.filter((comparison) => comparison.grade === 'C').length;
  pictogramEmptyReason = cropDetection?.crops.length ? ''
    : cropDetection?.labels.some((label) => label.explicitlyEmpty) ? 'declared-none' : 'not-found';
  pictogramOptions.querySelectorAll('input').forEach((input) => {
    input.checked = pictogramSources.has(input.value);
  });
  renderSelectedPictograms();
  const automaticCodes = [...pictogramAutomaticGrades].filter(([, grade]) => grade === 'A').map(([code]) => code);
  const candidateCodes = [...pictogramCandidates.keys()];
  document.querySelector('#pictogram-detected').textContent = automaticCodes.length || candidateCodes.length || unresolvedPictogramCount
    ? [
      automaticCodes.length ? `MSDS에서 자동 확인: ${automaticCodes.join(', ')}` : '',
      candidateCodes.length ? `확인 필요: ${candidateCodes.join(', ')}` : '',
      unresolvedPictogramCount ? `직접 확인 필요: ${unresolvedPictogramCount}개` : ''
    ].filter(Boolean).join(' / ')
    : pictogramEmptyReason === 'declared-none'
      ? 'MSDS에 실제 그림문자가 표시되지 않았습니다.'
      : '그림문자를 자동으로 확인하지 못했습니다. 원본 MSDS를 확인해 주세요.';
}

function showPictogramDebug(evidence) {
  if (evidence.cropDetection) {
    console.groupCollapsed('[HSSO GHS 그림문자 crop]');
    console.info('그림문자 라벨 탐지:', evidence.cropDetection.labelDetected);
    console.info('그림문자 후보 영역 수:', evidence.cropDetection.candidateCount);
    console.info('그림문자 crop 수:', evidence.cropDetection.crops.length);
    console.info('그림문자 없음 판단:', evidence.cropDetection.noPictogram);
    console.table(evidence.cropDetection.crops.map((crop, index) => ({
      crop: index + 1,
      page: crop.page,
      x: Number(crop.bbox.x.toFixed(2)),
      y: Number(crop.bbox.y.toFixed(2)),
      width: Number(crop.bbox.width.toFixed(2)),
      height: Number(crop.bbox.height.toFixed(2)),
      confidence: crop.detectionConfidence,
      sourceType: crop.sourceType
    })));
    console.info('그림문자 crop 원본 데이터:', evidence.cropDetection.crops);
    console.table((evidence.cropDetection.comparisons || []).map((comparison) => ({
      crop: comparison.cropIndex,
      page: comparison.page,
      first: comparison.first.code,
      firstScore: Number(comparison.first.score.toFixed(4)),
      firstIoU: Number(comparison.first.iou.toFixed(4)),
      firstCorrelation: Number(comparison.first.correlation.toFixed(4)),
      second: comparison.second.code,
      secondScore: Number(comparison.second.score.toFixed(4)),
      scoreGap: Number(comparison.scoreGap.toFixed(4)),
      grade: comparison.grade || '',
      detectionConfidence: comparison.detectionConfidence
    })));
    console.info('GHS01~GHS09 전체 비교 점수:', evidence.cropDetection.comparisons || []);
    console.groupEnd();
  }
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
  console.info('H문구 출처 추적:', debug.hStatements);
  console.info('P문구 출처·분류 추적:', debug.pStatements);
  console.info('좌표 기반 분류 제목:', debug.categoryAnchors);
  console.info('제거된 반복 머리말·꼬리말 원문:', debug.removedFurniture);
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

function parseSupplier(value) {
  const phoneMatch = value.match(/(?:\+?82[-\s]?)?(?:0\d{1,2})[-\s)]?\d{3,4}[-\s]?\d{4}/);
  const phone = phoneMatch?.[0]?.trim() || '';
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const supplierLine = lines.find((line) => /공급자|회사명|제조자/i.test(line)) || lines[0] || '';
  const name = supplierLine.replace(/^(?:공급자|회사명|제조자)(?:\s*정보)?\s*[:：]?\s*/i, '')
    .split(/(?:연락처|전화|긴급전화|주소)\s*[:：]?/i)[0].replace(phone, '').trim();
  return { name, phone };
}

function getFinalWarningLabelData() {
  const precautionValue = document.querySelector('#precaution-statements').value.trim();
  const parsed = collectCategorizedPrecautions(precautionValue.split(/\r?\n/));
  const precautions = Object.entries(parsed.categories)
    .filter(([, statements]) => statements.length)
    .map(([category, statements]) => ({ category, statements: [...statements] }));
  const supplier = parseSupplier(document.querySelector('#supplier-info').value.trim());
  return {
    productName: document.querySelector('#product-name').value.trim(),
    ghsCodes: GHS_PICTOGRAMS.filter((item) => pictogramSources.has(item.code)).map((item) => item.code),
    signalWord: document.querySelector('#signal-word').value.trim(),
    hazardStatements: document.querySelector('#hazard-statements').value.trim(),
    precautions,
    supplierName: supplier.name,
    supplierPhone: supplier.phone
  };
}

function appendTextElement(parent, tag, className, text, emptyText = '') {
  const element = document.createElement(tag);
  element.className = className + (!text ? ' empty-value' : '');
  element.textContent = text || emptyText;
  parent.append(element);
  return element;
}

function createWarningLabel(data, outputMode = 'screen') {
  const label = document.createElement('article');
  label.className = 'warning-label';
  label.dataset.outputMode = outputMode;
  appendTextElement(label, 'div', 'warning-label-title', '산업안전보건법 제115조 규정에 의한 경고표지');
  appendTextElement(label, 'div', 'preview-product', data.productName, '제품명');
  const symbolSignal = document.createElement('div');
  symbolSignal.className = `preview-symbol-signal${data.ghsCodes.length ? '' : ' no-ghs'}`;
  if (data.ghsCodes.length) {
    const symbols = document.createElement('div');
    symbols.className = 'preview-pictograms';
    data.ghsCodes.forEach((code) => {
      const pictogram = GHS_PICTOGRAMS.find((item) => item.code === code);
      const image = document.createElement('img');
      image.src = pictogram.asset;
      image.alt = `${pictogram.name} (${pictogram.code})`;
      image.dataset.ghsCode = code;
      symbols.append(image);
    });
    symbolSignal.append(symbols);
  }
  const signal = document.createElement('div');
  signal.className = 'signal-block';
  const signalLabel = document.createElement('strong');
  signalLabel.className = 'signal-label';
  signalLabel.setAttribute('aria-label', '신호어');
  signalLabel.append(...[...'신호어'].map((character) => {
    const span = document.createElement('span');
    span.textContent = character;
    return span;
  }));
  signal.append(signalLabel);
  appendTextElement(signal, 'div', 'preview-signal', data.signalWord);
  symbolSignal.append(signal);
  label.append(symbolSignal);
  const hazard = document.createElement('section');
  hazard.className = 'preview-hazard-section';
  appendTextElement(hazard, 'strong', '', '유해·위험문구');
  appendTextElement(hazard, 'p', '', data.hazardStatements, 'MSDS에서 확인한 내용을 입력하세요.');
  label.append(hazard);
  const precaution = document.createElement('section');
  precaution.className = 'preview-precaution-section';
  appendTextElement(precaution, 'strong', '', '예방조치문구');
  const groups = document.createElement('div');
  groups.className = 'precaution-groups';
  if (data.precautions.length) data.precautions.forEach(({ category, statements }) => {
    const group = document.createElement('section');
    group.className = 'precaution-group';
    appendTextElement(group, 'h4', '', category);
    appendTextElement(group, 'p', '', statements.join('\n'));
    groups.append(group);
  });
  else appendTextElement(groups, 'p', 'empty-value', '', '분류가 확인된 예방조치문구가 없습니다.');
  precaution.append(groups);
  label.append(precaution);
  const supplier = document.createElement('div');
  supplier.className = 'preview-supplier';
  appendTextElement(supplier, 'strong', '', '공급자 :');
  appendTextElement(supplier, 'span', '', data.supplierName);
  appendTextElement(supplier, 'strong', '', '연락처 :');
  appendTextElement(supplier, 'span', '', data.supplierPhone);
  label.append(supplier);
  return label;
}

function createPrintSheet(data, layout, outputMode = 'screen') {
  const sheet = document.createElement('div');
  sheet.className = 'print-sheet';
  sheet.dataset.size = layout.name;
  sheet.dataset.outputMode = outputMode;
  sheet.style.setProperty('--sheet-ratio', `${layout.pageWidth} / ${layout.pageHeight}`);
  sheet.style.setProperty('--sheet-columns', layout.columns);
  sheet.style.setProperty('--sheet-rows', layout.rows);
  sheet.style.setProperty('--sheet-margin-mm', `${layout.margin}mm`);
  sheet.style.setProperty('--sheet-gap-mm', `${layout.gap}mm`);
  sheet.style.setProperty('--sheet-margin-percent', `${layout.margin / layout.pageWidth * 100}%`);
  sheet.style.setProperty('--sheet-gap-percent', `${layout.gap / layout.pageWidth * 100}%`);
  for (let index = 0; index < layout.count; index += 1) sheet.append(createWarningLabel(data, outputMode));
  return sheet;
}

function renderPrintPreview() {
  if (!printPreview) return;
  const layout = getSelectedLabelSize();
  if (!layout) {
    previewResizeObserver?.disconnect();
    return printPreview.replaceChildren();
  }
  previewWarningLabelData = getFinalWarningLabelData();
  const sheet = createPrintSheet(previewWarningLabelData, layout, 'screen');
  const logicalWidth = Math.round(layout.pageWidth / 25.4 * 96);
  const logicalHeight = Math.round(layout.pageHeight / 25.4 * 96);
  const stage = document.createElement('div');
  stage.className = 'print-sheet-preview-stage';
  sheet.style.width = `${logicalWidth}px`;
  sheet.style.height = `${logicalHeight}px`;
  stage.append(sheet);
  printPreview.replaceChildren(stage);
  const scalePreview = () => {
    const previewStyle = getComputedStyle(printPreview);
    const availableWidth = printPreview.clientWidth - parseFloat(previewStyle.paddingLeft) - parseFloat(previewStyle.paddingRight);
    const scale = Math.min(1, availableWidth / logicalWidth);
    stage.style.width = `${logicalWidth * scale}px`;
    stage.style.height = `${logicalHeight * scale}px`;
    sheet.style.transform = `scale(${scale})`;
  };
  previewResizeObserver?.disconnect();
  previewResizeObserver = new ResizeObserver(scalePreview);
  previewResizeObserver.observe(printPreview);
  scalePreview();
  requestAnimationFrame(() => {
    const fit = fitOutputLabels(sheet);
    sheet.classList.toggle('content-overflow', !fit.fits);
    sheet.title = fit.fits ? '' : '이 출력 크기에는 내용이 너무 많습니다. 더 큰 출력 크기를 선택해주세요.';
    scalePreview();
  });
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
  let extracted;
  try {
    extracted = await extractPdfText(selectedFile);
    const rawText = extracted.pages.map((page, index) => `[${index + 1} 페이지]\n${page}`).join('\n\n');
    const diagnostics = buildDiagnostics(extracted);
    showDiagnostics(diagnostics);
    logDiagnostics(selectedFile, diagnostics);
    const analysisResult = analyzeMsdsText(extracted);
    const pictogramEvidence = findSectionTwoEvidence(extracted);
    pictogramEvidence.cropDetection = await extractSectionTwoPictogramCrops(extracted, analysisResult);
    pictogramEvidence.cropDetection.comparisons = await comparePictogramCrops(pictogramEvidence.cropDetection);
    fillAnalysisResult(analysisResult);
    showParserDebug(analysisResult, extracted);
    applyDetectedPictograms(pictogramEvidence);
    showPictogramDebug(pictogramEvidence);
    rawTextContent.textContent = rawText || '(추출된 텍스트가 없습니다.)';
    rawTextSummary.textContent = `${extracted.pageCount}페이지 · ${diagnostics.totalLength.toLocaleString('ko-KR')}자`;
    const selectedSize = getSelectedLabelSize();
    selectedSizeText.textContent = `${selectedSize.name} · ${selectedSize.description}`;
    renderPrintPreview();
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
    if (extracted?.pdfDocument) await extracted.pdfDocument.destroy();
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
    renderPrintPreview();
  });
});

renderPictogramControls();
renderSelectedPictograms();

function safePdfFilename(productName) {
  const safeName = productName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[.\s]+$/g, '')
    .trim()
    .slice(0, 80);
  return safeName ? `경고표지_${safeName}.pdf` : '경고표지.pdf';
}

function warningDataSummary(data) {
  const byCategory = Object.fromEntries(['예방', '대응', '저장', '폐기'].map((category) => [
    category, data.precautions.find((group) => group.category === category)?.statements.length || 0
  ]));
  return {
    productName: data.productName, ghsCodes: [...data.ghsCodes], ghsCount: data.ghsCodes.length,
    signalWord: data.signalWord,
    hazardCount: data.hazardStatements ? data.hazardStatements.split(/\r?\n/).filter(Boolean).length : 0,
    precautionCount: data.precautions.reduce((sum, group) => sum + group.statements.length, 0),
    preventionCount: byCategory.예방, responseCount: byCategory.대응,
    storageCount: byCategory.저장, disposalCount: byCategory.폐기,
    supplier: data.supplierName, contact: data.supplierPhone
  };
}

function assertSameWarningData(previewData, pdfData) {
  const preview = warningDataSummary(previewData);
  const pdf = warningDataSummary(pdfData);
  console.groupCollapsed('[HSSO Preview ↔ PDF 데이터 검증]');
  console.table({ preview, pdf });
  console.groupEnd();
  if (JSON.stringify(preview) !== JSON.stringify(pdf)) {
    throw new Error('미리보기와 PDF 데이터가 일치하지 않아 출력을 중단했습니다. 화면을 새로 확인해 주세요.');
  }
}

function fitOutputLabels(sheet) {
  const steps = ['normal', 'compact', 'dense'];
  for (const density of steps) {
    sheet.querySelectorAll('.warning-label').forEach((label) => { label.dataset.density = density; });
    const fits = [...sheet.querySelectorAll('.warning-label')].every((label) => {
      const regions = [label, ...label.querySelectorAll('.preview-hazard-section, .preview-precaution-section, .precaution-groups')];
      return regions.every((region) => region.scrollHeight <= region.clientHeight + 1 && region.scrollWidth <= region.clientWidth + 1);
    });
    if (fits) return { fits: true, density };
  }
  return { fits: false, density: 'dense' };
}

async function waitForOutputImages(root) {
  await document.fonts?.ready;
  await Promise.all([...root.querySelectorAll('img')].map(async (image) => {
    if (!image.complete) await new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', reject, { once: true });
    });
    if (image.decode) await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error(`GHS 이미지 준비 실패: ${image.dataset.ghsCode || image.alt}`);
  }));
}

async function rasterizeOutputPictograms(root) {
  await Promise.all([...root.querySelectorAll('img[data-ghs-code]')].map(async (image) => {
    const sourceUrl = image.getAttribute('src');
    const source = new Image();
    source.src = sourceUrl;
    await source.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    image.dataset.sourceSrc = sourceUrl;
    image.src = canvas.toDataURL('image/png');
    await image.decode();
  }));
}

function inspectPdfRenderGeometry(sheet, data, layout) {
  const sheetRect = sheet.getBoundingClientRect();
  const labels = [...sheet.querySelectorAll('.warning-label')];
  const expectedImageCount = data.ghsCodes.length * layout.count;
  const images = [...sheet.querySelectorAll('img[data-ghs-code]')];
  const imageDetails = images.map((image) => {
    const style = getComputedStyle(image);
    const rect = image.getBoundingClientRect();
    return {
      code: image.dataset.ghsCode,
      sourceSrc: image.dataset.sourceSrc || '',
      renderedSrc: image.currentSrc || image.src,
      naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
      display: style.display, visibility: style.visibility, opacity: style.opacity,
      width: rect.width, height: rect.height, left: rect.left, top: rect.top
    };
  });
  const labelDetails = labels.map((label) => {
    const rect = label.getBoundingClientRect();
    const supplierRect = label.querySelector('.preview-supplier').getBoundingClientRect();
    return { width: rect.width, height: rect.height, supplierBottomGap: rect.bottom - supplierRect.bottom };
  });
  console.groupCollapsed('[HSSO PDF 캡처 직전 실제 DOM 검증]');
  console.table(imageDetails);
  console.table(labelDetails);
  console.groupEnd();
  const expectedCodes = Array.from({ length: layout.count }, () => data.ghsCodes).flat();
  if (images.length !== expectedImageCount || imageDetails.some((item, index) =>
    item.code !== expectedCodes[index] || !item.sourceSrc || !item.renderedSrc || !item.naturalWidth || !item.naturalHeight ||
    item.display === 'none' || item.visibility === 'hidden' || Number(item.opacity) <= 0 || item.width <= 0 || item.height <= 0)) {
    throw new Error('PDF 출력 DOM에서 GHS 그림문자 렌더링 상태가 올바르지 않아 생성을 중단했습니다.');
  }
  if (!sheetRect.width || !sheetRect.height || labelDetails.some((item) => item.height <= 0 || Math.abs(item.supplierBottomGap) > 2)) {
    throw new Error('PDF 출력 DOM에서 공급자 행이 경고표지 최하단에 배치되지 않아 생성을 중단했습니다.');
  }
  return {
    sheetRect,
    sheetSize: { width: sheetRect.width, height: sheetRect.height },
    imageDetails,
    labelDetails
  };
}

function verifyCanvasPictograms(canvas, geometry) {
  const scaleX = canvas.width / geometry.sheetRect.width;
  const scaleY = canvas.height / geometry.sheetRect.height;
  const results = geometry.imageDetails.map((item) => {
    const x = Math.max(0, Math.floor((item.left - geometry.sheetRect.left) * scaleX));
    const y = Math.max(0, Math.floor((item.top - geometry.sheetRect.top) * scaleY));
    const width = Math.min(canvas.width - x, Math.max(1, Math.floor(item.width * scaleX)));
    const height = Math.min(canvas.height - y, Math.max(1, Math.floor(item.height * scaleY)));
    const pixels = canvas.getContext('2d').getImageData(x, y, width, height).data;
    let redPixels = 0;
    let darkPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      if (alpha > 0 && red > 150 && green < 130 && blue < 130) redPixels += 1;
      if (alpha > 0 && red < 110 && green < 110 && blue < 110) darkPixels += 1;
    }
    return { code: item.code, width, height, redPixels, darkPixels };
  });
  console.table(results);
  if (results.some((item) => item.redPixels < 25 || item.darkPixels < 25)) {
    throw new Error('html2canvas 결과에서 일부 GHS 그림문자가 확인되지 않아 PDF 생성을 중단했습니다.');
  }
  return results;
}

async function createPdfRenderSheet(data, layout) {
  const sheet = createPrintSheet(data, layout, 'pdf');
  sheet.classList.add('pdf-render-sheet');
  const logicalWidth = Math.round(layout.pageWidth / 25.4 * 96);
  const logicalHeight = Math.round(layout.pageHeight / 25.4 * 96);
  sheet.style.width = `${logicalWidth}px`;
  sheet.style.height = `${logicalHeight}px`;
  document.body.append(sheet);
  await waitForOutputImages(sheet);
  await rasterizeOutputPictograms(sheet);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const fit = fitOutputLabels(sheet);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const geometry = inspectPdfRenderGeometry(sheet, data, layout);
  return { sheet, logicalWidth, logicalHeight, fit, geometry };
}

async function downloadWarningLabelPdf(saved = null) {
  const size = saved?.layout || getSelectedLabelSize();
  const pdfDownloadMessage = saved?.message || document.querySelector('#pdf-download-message');
  const downloadPdfButton = saved?.button || document.querySelector('#download-pdf');
  pdfDownloadMessage.hidden = true;
  pdfDownloadMessage.className = 'pdf-download-message';
  if (!size) {
    pdfDownloadMessage.textContent = '출력 크기를 먼저 선택해 주세요.';
    pdfDownloadMessage.classList.add('error');
    pdfDownloadMessage.hidden = false;
    return;
  }
  if (!window.html2canvas || !window.jspdf?.jsPDF) {
    pdfDownloadMessage.textContent = 'PDF 생성 도구를 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
    pdfDownloadMessage.classList.add('error');
    pdfDownloadMessage.hidden = false;
    return;
  }
  downloadPdfButton.disabled = true;
  downloadPdfButton.textContent = 'PDF 생성 중...';
  let renderSheet;
  try {
    const previewData = saved?.data || previewWarningLabelData || getFinalWarningLabelData();
    const pdfData = structuredClone(previewData);
    assertSameWarningData(previewData, saved?.data || getFinalWarningLabelData());
    assertSameWarningData(previewData, pdfData);
    renderSheet = await createPdfRenderSheet(pdfData, size);
    if (!renderSheet.fit.fits) throw new Error('이 출력 크기에는 내용이 너무 많습니다. 더 큰 출력 크기를 선택해주세요.');
    const targetWidthPixels = size.pageWidth / 25.4 * 300;
    const targetHeightPixels = size.pageHeight / 25.4 * 300;
    const renderScale = Math.min(
      targetWidthPixels / renderSheet.logicalWidth,
      targetHeightPixels / renderSheet.logicalHeight,
      5000 / Math.max(renderSheet.logicalWidth, renderSheet.logicalHeight)
    );
    const canvas = await window.html2canvas(renderSheet.sheet, {
      backgroundColor: '#ffffff',
      logging: false,
      scale: renderScale,
      useCORS: true,
      width: renderSheet.logicalWidth,
      height: renderSheet.logicalHeight,
      windowWidth: renderSheet.logicalWidth,
      windowHeight: renderSheet.logicalHeight,
      onclone: (clonedDocument) => {
        const originalCanvases = [...renderSheet.sheet.querySelectorAll('canvas')];
        clonedDocument.querySelectorAll('.pdf-render-sheet canvas').forEach((canvasClone, index) => {
          const source = originalCanvases[index];
          canvasClone.getContext('2d').drawImage(source, 0, 0);
        });
      }
    });
    const canvasPictograms = verifyCanvasPictograms(canvas, renderSheet.geometry);
    window.__hssoLastPdfRenderAudit = {
      dom: {
        sheetSize: renderSheet.geometry.sheetSize,
        images: renderSheet.geometry.imageDetails,
        labels: renderSheet.geometry.labelDetails
      },
      canvas: canvasPictograms
    };
    const orientation = size.pageWidth > size.pageHeight ? 'landscape' : 'portrait';
    const pdf = new window.jspdf.jsPDF({ orientation, unit: 'mm', format: [size.pageWidth, size.pageHeight], compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    if (Math.abs(pageWidth - size.pageWidth) > 0.02 || Math.abs(pageHeight - size.pageHeight) > 0.02) {
      throw new Error('선택한 출력 크기로 PDF 페이지를 만들지 못했습니다. 크기 값을 확인해 주세요.');
    }
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, size.pageWidth, size.pageHeight, undefined, 'FAST');
    const productName = saved?.data?.productName ?? document.querySelector('#product-name').value;
    pdf.save(safePdfFilename(productName));
    pdfDownloadMessage.textContent = `${size.pageWidth} × ${size.pageHeight} mm · 경고표지 ${size.count}개 PDF를 생성했습니다.`;
    pdfDownloadMessage.hidden = false;
  } catch (error) {
    console.error('경고표지 PDF 생성 오류:', error);
    pdfDownloadMessage.textContent = error?.message || 'PDF 생성 중 오류가 발생했습니다.';
    pdfDownloadMessage.classList.add('error');
    pdfDownloadMessage.hidden = false;
  } finally {
    renderSheet?.sheet.remove();
    downloadPdfButton.disabled = false;
    downloadPdfButton.textContent = saved?.data ? 'PDF 저장' : 'PDF 다운로드';
  }
}

downloadPdfButton.addEventListener('click', () => downloadWarningLabelPdf());

rawTextToggle.addEventListener('click', () => {
  const willOpen = rawTextPanel.hidden;
  rawTextPanel.hidden = !willOpen;
  rawTextToggle.setAttribute('aria-expanded', String(willOpen));
});

const PROCESS_SECTION_TITLES = {
  4: /^(?:응급조치(?:요령)?|응급처치(?:요령)?|firstaidmeasures?|healthhazardinformation)$/i,
  5: /^(?:폭발화재시대처방법|화재시대처방법|소방조치|firefightingmeasures?)$/i,
  6: /^(?:누출사고시대처방법|누출시대처방법|accidentalreleasemeasures?)$/i,
  7: /^(?:취급및저장방법|취급저장방법|handlingandstorage)$/i,
  8: /^(?:노출방지및개인보호구|노출방지개인보호구|노출관리개인보호구|exposurecontrolspersonalprotection)$/i,
  9: /^(?:물리화학적특성|physicalandchemicalproperties)$/i
};

function isProcessSectionHeading(line, number) {
  const value = normalized(line).replace(/[.·ㆍ•:：()\-_/,&]/g, '');
  if (value.length > 100) return false;
  const numberPrefix = `(?:제?${number}(?:항|장)?)`;
  const firstPrefix = value.match(new RegExp(`^${numberPrefix}`))?.[0] || '';
  if (!firstPrefix) return false;
  const firstTitle = value.slice(firstPrefix.length);
  if (PROCESS_SECTION_TITLES[number]?.test(firstTitle)) return true;
  const repeatedNumber = firstTitle.match(new RegExp(numberPrefix))?.[0] || '';
  if (!repeatedNumber) return false;
  const repeatedIndex = firstTitle.indexOf(repeatedNumber);
  const englishTitle = firstTitle.slice(0, repeatedIndex);
  const koreanTitle = firstTitle.slice(repeatedIndex + repeatedNumber.length);
  return PROCESS_SECTION_TITLES[number]?.test(englishTitle)
    && PROCESS_SECTION_TITLES[number]?.test(koreanTitle);
}

function getProcessSections(source) {
  const pages = Array.isArray(source) ? source : source.pages;
  const repeatedNoise = findRepeatedPageFurniture(pages);
  const lines = buildDocumentLines(source);
  const repeatedFurniture = findRepeatedPageFurnitureByPosition(lines);
  const starts = {};
  let previous = -1;
  [4, 5, 6, 7, 8, 9].forEach((number) => {
    const index = lines.findIndex((line, lineIndex) => lineIndex > previous && isProcessSectionHeading(line.text, number));
    starts[number] = index;
    if (index >= 0) previous = index;
  });
  const section = (number) => {
    const start = starts[number];
    if (start < 0) return [];
    const laterStarts = Object.entries(starts)
      .filter(([nextNumber, index]) => Number(nextNumber) > number && index > start)
      .map(([, index]) => index);
    const end = laterStarts.length ? Math.min(...laterStarts) : lines.length;
    return lines.slice(start + 1, end)
      .filter((line) => !isProcessSectionHeading(line.text, number))
      .filter((line) => !repeatedFurniture.isFurniture(line))
      .map((line) => line.text)
      .filter((line) => line && !isPdfNoiseLine(line, repeatedNoise) && !isProcessPageFurniture(line));
  };
  return { section, locations: starts };
}

function isProcessPageFurniture(line) {
  const value = cleanLine(line);
  const hasPageFraction = /(?:^|\|)\s*(?:page\s*)?(?:\|\s*)?\d+\s*(?:\/|of)\s*\d+(?:\s*\||$)/i.test(value);
  const hasRevisionLabel = /개정\s*(?:횟수|번호|일자)|revision|rev\.?\s*(?:no\.?|date|\d)/i.test(value);
  return hasPageFraction && (hasRevisionLabel || /\bpage\b/i.test(value) || value.split('|').length > 1);
}

function extractProcessSubfields(lines, definitions, boundaryPatterns = []) {
  const result = Object.fromEntries(Object.keys(definitions).map((key) => [key, '']));
  let activeKey = '';
  lines.forEach((rawLine) => {
    const line = cleanLine(rawLine);
    const normalizedLine = normalized(line);
    if (boundaryPatterns.some((pattern) => pattern.test(normalizedLine))) {
      activeKey = '';
      return;
    }
    const matched = Object.entries(definitions).find(([, pattern]) => pattern.test(normalizedLine));
    if (matched) {
      activeKey = matched[0];
      const separatorIndex = line.search(/[|:：]/);
      const inline = separatorIndex >= 0
        ? cleanLine(line.slice(separatorIndex + 1))
        : cleanLine(normalizedLine.replace(matched[1], ''));
      if (inline) result[activeKey] = inline;
      return;
    }
    if (!activeKey || isProcessSectionHeading(line, 4) || isProcessSectionHeading(line, 5)
      || isProcessSectionHeading(line, 6) || isProcessSectionHeading(line, 7)
      || isProcessSectionHeading(line, 8) || isProcessSectionHeading(line, 9)) return;
    result[activeKey] = [result[activeKey], line].filter(Boolean).join('\n');
  });
  return result;
}

function createProcessGuideData(extracted, baseAnalysis, ghsCodes) {
  const sections = getProcessSections(extracted);
  const firstAid = extractProcessSubfields(sections.section(4), {
    eye: /^(?:(?:[가-하]|\d{1,2})[.)]?\s*)?(?:눈에들어갔을(?:때|경우)|눈(?:에)?접촉(?:했을(?:때|경우)|시)?|안구접촉(?:했을(?:때|경우)|시)?|eyecontact)\s*(?:[|:：-]\s*)?/i,
    skin: /^(?:(?:[가-하]|\d{1,2})[.)]?\s*)?(?:피부에접촉했을(?:때|경우)|피부접촉(?:했을(?:때|경우)|시)?|skincontact)\s*(?:[|:：-]\s*)?/i,
    inhalation: /^(?:(?:[가-하]|\d{1,2})[.)]?\s*)?(?:흡입했을(?:때|경우)|흡입시|inhalation)\s*(?:[|:：-]\s*)?/i,
    ingestion: /^(?:(?:[가-하]|\d{1,2})[.)]?\s*)?(?:먹었을(?:때|경우)|삼켰을(?:때|경우)|섭취(?:했을(?:때|경우)|시)?|ingestion)\s*(?:[|:：-]\s*)?/i
  }, [/^(?:(?:[가-하]|\d{1,2})[.)]?\s*)?(?:기타의사의주의사항|의사의주의사항)/i]);
  const handlingParts = extractProcessSubfields(sections.section(7), {
    safeHandling: /^(?:(?:[가-하]|\d{1,2})[.)]?\s*)?(?:안전취급요령|안전한취급을위한(?:예방조치|주의사항)|취급시주의사항|precautionsforsafehandling)\s*(?:[|:：-]\s*)?/i,
    storage: /^(?:(?:[가-하]|\d{1,2})[.)]?\s*)?(?:피해야할조건을포함한안전한저장방법|안전한저장방법|저장방법|저장시주의사항|보관방법|conditionsforsafestorage)\s*(?:[|:：-]\s*)?/i
  });
  if (!handlingParts.safeHandling && !handlingParts.storage) handlingParts.safeHandling = sections.section(7).join('\n');
  const ppe = extractProcessSubfields(sections.section(8), {
    respiratory: /^(?:[가-하]\.\s*)?(?:호흡기보호|호흡기보호구|respiratoryprotection)\s*(?:[|:：-]\s*)?/i,
    eye: /^(?:[가-하]\.\s*)?(?:눈보호|눈및안면보호|눈안면보호|eye(?:face)?protection)\s*(?:[|:：-]\s*)?/i,
    hand: /^(?:[가-하]\.\s*)?(?:손보호|손보호구|handprotection)\s*(?:[|:：-]\s*)?/i,
    body: /^(?:[가-하]\.\s*)?(?:신체보호|신체보호구|피부및신체보호|bodyprotection|skinprotection)\s*(?:[|:：-]\s*)?/i
  });
  return {
    productName: baseAnalysis.productName || '',
    signalWord: baseAnalysis.signalWord || '',
    ghs: [...ghsCodes],
    hazardStatements: baseAnalysis.hazardStatements || '',
    firstAid,
    accidentResponse: {
      fire: sections.section(5).join('\n'),
      spill: sections.section(6).join('\n')
    },
    handling: handlingParts,
    ppe,
    extractionStatus: { sectionLocations: sections.locations }
  };
}

function automaticGhsCodesFromEvidence(evidence) {
  return [...new Set((evidence.cropDetection?.comparisons || [])
    .filter((comparison) => classifyPictogramComparison(comparison) === 'A')
    .map((comparison) => comparison.first.code))];
}

function displayProcessValue(value) {
  return value && String(value).trim() ? String(value).trim() : '확인 필요';
}

function formatProcessGroups(groups, labels) {
  const blocks = Object.entries(labels).map(([key, label]) => {
    const value = groups[key];
    return value ? `${label}\n${value}` : `${label}\n확인 필요`;
  });
  return blocks.join('\n\n');
}

const PROCESS_GHS_LABELS = {
  GHS01: '폭발성', GHS02: '인화성', GHS03: '산화성', GHS04: '고압가스', GHS05: '부식성',
  GHS06: '급성독성', GHS07: '경고', GHS08: '건강유해성', GHS09: '환경유해성'
};

const PROCESS_PPE_ICONS = [
  { code: '301', key: 'eye', label: '보안경 착용', asset: 'assets/ppe/goggles.svg', present: (ppe) => Boolean(String(ppe.eye || '').trim()) },
  { code: '302', key: 'gasMask', label: '방독마스크 착용', asset: 'assets/ppe/gas-mask.svg', present: (ppe) => /방독\s*마스크/i.test(ppe.respiratory) },
  { code: '303', key: 'dustMask', label: '방진마스크 착용', asset: 'assets/ppe/dust-mask.svg', present: (ppe) => /방진\s*마스크/i.test(ppe.respiratory) },
  { code: '304', key: 'faceShield', label: '보안면 착용', asset: 'assets/ppe/face-shield.svg', present: () => false },
  { code: '305', key: 'helmet', label: '안전모 착용', asset: 'assets/ppe/helmet.svg', present: () => false },
  { code: '306', key: 'hearing', label: '귀마개 착용', asset: 'assets/ppe/hearing-protection.svg', present: () => false },
  { code: '307', key: 'shoes', label: '안전화 착용', asset: 'assets/ppe/safety-shoes.svg', present: () => false },
  { code: '308', key: 'hand', label: '안전장갑 착용', asset: 'assets/ppe/gloves.svg', present: (ppe) => Boolean(String(ppe.hand || '').trim()) },
  { code: '309', key: 'body', label: '안전복 착용', asset: 'assets/ppe/protective-clothing.svg', present: (ppe) => Boolean(String(ppe.body || '').trim()) }
];

function processPreviewItems(value, limit) {
  const lines = String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const itemStart = /^(?:[①-⑳]|[-•·▪◆◇■□※]|\d{1,2}[.)]|[가-하][.)]|[HP]\d{3}\b)/i;
  const items = [];
  lines.forEach((line) => {
    if (!items.length || itemStart.test(line)) items.push(line);
    else items[items.length - 1] += ` ${line}`;
  });
  if (items.length === 1 && !itemStart.test(items[0])) {
    const sentences = items[0].split(/(?<=[.!?。])\s+(?=[가-힣A-Za-z0-9])/).filter(Boolean);
    if (sentences.length > 1) return sentences.slice(0, limit);
  }
  return items.slice(0, limit);
}

function processAccidentPreviewItems(value, limit = 4) {
  const rawLines = String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const repairedLines = [];
  rawLines.forEach((line) => {
    const previousIndex = repairedLines.length - 1;
    const continuesPrevious = previousIndex >= 0 && (
      line.length <= 3
      || /^(?:부터|까지|시오\.?$)/.test(line)
      || /(?:으|시|으로)$/.test(repairedLines[previousIndex])
    );
    if (continuesPrevious) repairedLines[previousIndex] += line;
    else repairedLines.push(line);
  });

  const items = [];
  repairedLines.forEach((sourceLine) => {
    let line = sourceLine.replace(/\s+\d{1,3}\s*\/\s*\d{1,3}\s*$/, '').trim();
    if (!line || isPdfNoiseLine(line) || /^\d+\s*\.\s*(?:화재|누출)/.test(line)) return;
    if (line.includes('|')) line = line.slice(line.lastIndexOf('|') + 1).trim();
    else if (/^[가-하][.)]\s*/.test(line)) return;
    line = line.replace(/^(?:[①-⑳]|[-•·▪◆◇■□※]|\d{1,2}[.)])\s*/, '').trim();
    if (!line || isPdfNoiseLine(line)) return;
    line.split(/(?<=[.!?。])\s+(?=[가-힣A-Za-z0-9①-⑳])/).map((sentence) => sentence.trim()).filter(Boolean).forEach((sentence) => {
      if (items.length < limit && !isPdfNoiseLine(sentence)) items.push(sentence);
    });
  });
  return items.slice(0, limit);
}

function renderProcessItemList(selector, value, limit, root = document) {
  const list = root.querySelector(selector);
  const items = processPreviewItems(value, limit);
  list.replaceChildren(...items.map((text) => Object.assign(document.createElement('li'), { textContent: text })));
}

function renderProcessAccidentList(selector, value, root = document) {
  const list = root.querySelector(selector);
  const items = processAccidentPreviewItems(value);
  list.replaceChildren(...items.map((text) => Object.assign(document.createElement('li'), { textContent: text })));
}

function scaleProcessPreview() {
  const shell = document.querySelector('#process-preview');
  const stage = shell?.querySelector('.process-preview-stage');
  const poster = stage?.querySelector('.process-poster');
  if (!shell || shell.hidden || !stage || !poster) return;
  const availableWidth = shell.clientWidth - parseFloat(getComputedStyle(shell).paddingLeft) - parseFloat(getComputedStyle(shell).paddingRight);
  const scale = Math.min(1, availableWidth / 794);
  poster.style.transform = `scale(${scale})`;
  poster.style.transformOrigin = 'top left';
  stage.style.width = `${794 * scale}px`;
  stage.style.height = `${poster.offsetHeight * scale}px`;
}

function renderProcessGuideData(data, root = document) {
  const productName = root.querySelector('#process-product-name');
  productName.textContent = String(data.productName || '').trim();
  productName.classList.toggle('long', productName.textContent.length > 24);
  const ghsArea = root.querySelector('#process-ghs');
  const pictograms = data.ghs.map((code) => GHS_PICTOGRAMS.find((item) => item.code === code)).filter(Boolean);
  ghsArea.replaceChildren(...pictograms.map((pictogram) => {
    const item = document.createElement('div');
    item.className = 'process-ghs-item';
    item.append(
      Object.assign(document.createElement('img'), { src: pictogram.asset, alt: pictogram.name }),
      Object.assign(document.createElement('span'), { textContent: PROCESS_GHS_LABELS[pictogram.code] || pictogram.name })
    );
    return item;
  }));
  root.querySelector('#process-signal-word').textContent = String(data.signalWord || '').trim();
  renderProcessItemList('#process-hazards', data.hazardStatements, 5, root);
  renderProcessItemList('#process-handling', data.handling.safeHandling, 5, root);
  const ppeArea = root.querySelector('#process-ppe');
  const selectedPpe = new Set(data.selectedPpe || PROCESS_PPE_ICONS.filter((item) => item.present(data.ppe)).map((item) => item.code));
  const ppeItems = PROCESS_PPE_ICONS.filter((item) => selectedPpe.has(item.code)).map((item) => {
    const icon = document.createElement('div');
    icon.className = 'process-ppe-icon';
    icon.dataset.ppe = item.key;
    icon.append(
      Object.assign(document.createElement('img'), { src: item.asset, alt: item.label }),
      Object.assign(document.createElement('span'), { textContent: item.label })
    );
    return icon;
  });
  const emptyPpe = data.ppeNone ? Object.assign(document.createElement('span'), {
    className: 'process-ppe-empty', textContent: '해당 없음'
  }) : null;
  ppeArea.replaceChildren(...ppeItems, ...(emptyPpe ? [emptyPpe] : []));
  renderProcessItemList('#process-first-aid-eye', data.firstAid.eye, 3, root);
  renderProcessItemList('#process-first-aid-skin', data.firstAid.skin, 3, root);
  renderProcessItemList('#process-first-aid-inhalation', data.firstAid.inhalation, 3, root);
  renderProcessItemList('#process-first-aid-ingestion', data.firstAid.ingestion, 3, root);
  renderProcessAccidentList('#process-accident-fire', data.accidentResponse.fire, root);
  renderProcessAccidentList('#process-accident-spill', data.accidentResponse.spill, root);
  if (root === document) {
    document.querySelector('#process-preview').hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(scaleProcessPreview));
  }
}

window.addEventListener('resize', scaleProcessPreview);

function automaticProcessPpeCodes(ppe) {
  return PROCESS_PPE_ICONS.filter((item) => item.present(ppe)).map((item) => item.code);
}

function setProcessEditorHeading(isPreview) {
  document.querySelector('#process-result-step').textContent = isPreview ? '03' : '02';
  document.querySelector('#process-result-title').textContent = isPreview ? '미리보기' : '분석결과 확인 및 수정';
}

function renderProcessEditorChoices(data) {
  const ghsArea = document.querySelector('#process-edit-ghs');
  ghsArea.replaceChildren(...GHS_PICTOGRAMS.map((item) => {
    const label = document.createElement('label');
    label.className = 'process-edit-choice';
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', value: item.code, checked: data.ghs.includes(item.code) });
    input.dataset.processGhs = '';
    const content = document.createElement('span');
    content.append(Object.assign(document.createElement('img'), { src: item.asset, alt: '' }), document.createTextNode(`${item.code} ${PROCESS_GHS_LABELS[item.code] || item.name}`));
    label.append(input, content);
    return label;
  }));
  const ppeArea = document.querySelector('#process-edit-ppe');
  ppeArea.replaceChildren(...PROCESS_PPE_ICONS.map((item) => {
    const label = document.createElement('label');
    label.className = 'process-edit-choice process-edit-ppe-choice';
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', value: item.code, checked: data.selectedPpe.includes(item.code) });
    input.dataset.processPpe = '';
    input.addEventListener('change', () => {
      if (input.checked) document.querySelector('#process-edit-ppe-none').checked = false;
    });
    const content = document.createElement('span');
    content.append(Object.assign(document.createElement('img'), { src: item.asset, alt: '' }), document.createTextNode(`${item.code} ${item.label}`));
    label.append(input, content);
    return label;
  }));
}

function initializeProcessGuideEditor(sourceData) {
  const editable = structuredClone(sourceData);
  editable.selectedPpe = automaticProcessPpeCodes(editable.ppe);
  editable.ppeNone = false;
  window.__hssoProcessGuideEditableData = editable;
  document.querySelector('#process-edit-product').value = editable.productName;
  document.querySelector('#process-edit-signal').value = editable.signalWord;
  document.querySelector('#process-edit-hazards').value = editable.hazardStatements;
  document.querySelector('#process-edit-handling').value = editable.handling.safeHandling;
  document.querySelector('#process-edit-first-eye').value = editable.firstAid.eye;
  document.querySelector('#process-edit-first-skin').value = editable.firstAid.skin;
  document.querySelector('#process-edit-first-inhalation').value = editable.firstAid.inhalation;
  document.querySelector('#process-edit-first-ingestion').value = editable.firstAid.ingestion;
  document.querySelector('#process-edit-fire').value = editable.accidentResponse.fire;
  document.querySelector('#process-edit-spill').value = editable.accidentResponse.spill;
  document.querySelector('#process-edit-ppe-none').checked = false;
  renderProcessEditorChoices(editable);
  const status = document.querySelector('#process-ppe-analysis-status');
  status.textContent = editable.selectedPpe.length ? '자동 선택됨' : '확인 필요';
  status.classList.toggle('confirmed', Boolean(editable.selectedPpe.length));
  setProcessEditorHeading(false);
  document.querySelector('#process-preview').hidden = true;
  document.querySelector('#process-editor').hidden = false;
}

function collectProcessGuideEditableData() {
  const data = window.__hssoProcessGuideEditableData;
  data.productName = document.querySelector('#process-edit-product').value.trim();
  data.signalWord = document.querySelector('#process-edit-signal').value.trim();
  data.ghs = [...document.querySelectorAll('[data-process-ghs]:checked')].map((input) => input.value);
  data.hazardStatements = document.querySelector('#process-edit-hazards').value.trim();
  data.handling.safeHandling = document.querySelector('#process-edit-handling').value.trim();
  data.firstAid.eye = document.querySelector('#process-edit-first-eye').value.trim();
  data.firstAid.skin = document.querySelector('#process-edit-first-skin').value.trim();
  data.firstAid.inhalation = document.querySelector('#process-edit-first-inhalation').value.trim();
  data.firstAid.ingestion = document.querySelector('#process-edit-first-ingestion').value.trim();
  data.accidentResponse.fire = document.querySelector('#process-edit-fire').value.trim();
  data.accidentResponse.spill = document.querySelector('#process-edit-spill').value.trim();
  data.ppeNone = document.querySelector('#process-edit-ppe-none').checked;
  data.selectedPpe = data.ppeNone ? [] : [...document.querySelectorAll('[data-process-ppe]:checked')].map((input) => input.value);
  return data;
}

document.querySelector('#process-edit-ppe-none').addEventListener('change', (event) => {
  if (event.target.checked) document.querySelectorAll('[data-process-ppe]').forEach((input) => { input.checked = false; });
});

document.querySelector('#process-create-preview').addEventListener('click', () => {
  const editable = collectProcessGuideEditableData();
  renderProcessGuideData(editable);
  document.querySelector('#process-editor').hidden = true;
  setProcessEditorHeading(true);
  document.querySelector('#process-preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelector('#process-edit-again').addEventListener('click', () => {
  document.querySelector('#process-preview').hidden = true;
  document.querySelector('#process-editor').hidden = false;
  setProcessEditorHeading(false);
  document.querySelector('#process-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function safeProcessGuidePdfFilename(productName) {
  const safeName = String(productName || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[.\s]+$/g, '')
    .trim()
    .slice(0, 80);
  return safeName ? `작업공정별관리요령_${safeName}.pdf` : '작업공정별관리요령.pdf';
}

async function rasterizeProcessGuideImages(root) {
  await Promise.all([...root.querySelectorAll('img')].map(async (image) => {
    const sourceUrl = image.currentSrc || image.src;
    const source = new Image();
    source.src = sourceUrl;
    await source.decode();
    if (!source.naturalWidth || !source.naturalHeight) throw new Error(`이미지 변환 실패: ${image.alt || sourceUrl}`);
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    image.dataset.sourceSrc = sourceUrl;
    image.src = canvas.toDataURL('image/png');
    await image.decode();
  }));
}

function inspectProcessPdfDom(poster) {
  const posterRect = poster.getBoundingClientRect();
  const renderTolerance = 2;
  const images = [...poster.querySelectorAll('.process-ghs-item img, .process-ppe-icon img')].map((image) => {
    const rect = image.getBoundingClientRect();
    return {
      kind: image.closest('.process-ghs-item') ? 'ghs' : 'ppe',
      label: image.alt,
      sourceSrc: image.dataset.sourceSrc || '',
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
  });
  const clipped = [poster, ...poster.querySelectorAll('*')].filter((element) =>
    element.scrollHeight > element.clientHeight + 1 && getComputedStyle(element).overflowY === 'hidden'
  );
  if (Math.abs(posterRect.width - 794) > renderTolerance || posterRect.height - 1123 > renderTolerance
    || poster.scrollWidth - poster.clientWidth > renderTolerance || poster.scrollHeight - poster.clientHeight > renderTolerance || clipped.length) {
    throw new Error('입력한 내용이 A4 한 페이지에 들어가지 않습니다. 일부 항목의 내용을 줄인 후 다시 시도해 주세요.');
  }
  if (images.some((item) => !item.sourceSrc || !item.naturalWidth || !item.naturalHeight || item.width <= 0 || item.height <= 0)) {
    throw new Error('PDF 캡처용 GHS 또는 보호구 이미지를 준비하지 못했습니다.');
  }
  return { posterRect, width: posterRect.width, height: posterRect.height, images };
}

function verifyProcessPdfCanvas(canvas, geometry) {
  const scaleX = canvas.width / geometry.width;
  const scaleY = canvas.height / geometry.height;
  const results = geometry.images.map((item) => {
    const x = Math.max(0, Math.floor((item.left - geometry.posterRect.left) * scaleX));
    const y = Math.max(0, Math.floor((item.top - geometry.posterRect.top) * scaleY));
    const width = Math.min(canvas.width - x, Math.max(1, Math.floor(item.width * scaleX)));
    const height = Math.min(canvas.height - y, Math.max(1, Math.floor(item.height * scaleY)));
    const pixels = canvas.getContext('2d').getImageData(x, y, width, height).data;
    let redPixels = 0;
    let bluePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      if (alpha > 0 && red > 145 && green < 135 && blue < 135) redPixels += 1;
      if (alpha > 0 && blue > 100 && blue > red * 1.25 && blue > green * 1.08) bluePixels += 1;
    }
    return { kind: item.kind, label: item.label, redPixels, bluePixels, width, height };
  });
  if (results.some((item) => item.kind === 'ghs' && item.redPixels < 25)
    || results.some((item) => item.kind === 'ppe' && item.bluePixels < 25)) {
    throw new Error('PDF 캡처 결과에서 일부 GHS 또는 보호구 지시표지를 확인하지 못했습니다.');
  }
  return results;
}

async function createProcessGuidePdfCanvas(preview = document.querySelector('#process-preview')) {
  const poster = preview.querySelector('.process-poster');
  if (preview.hidden || !poster) throw new Error('먼저 미리보기를 생성해 주세요.');
  const renderPoster = poster.cloneNode(true);
  renderPoster.classList.add('process-pdf-render');
  document.body.append(renderPoster);
  try {
    await waitForOutputImages(renderPoster);
    await rasterizeProcessGuideImages(renderPoster);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const geometry = inspectProcessPdfDom(renderPoster);
    const scale = 3;
    const canvas = await window.html2canvas(renderPoster, {
      backgroundColor: '#ffffff',
      logging: false,
      scale,
      useCORS: true,
      width: 794,
      height: 1123,
      windowWidth: 794,
      windowHeight: 1123,
      scrollX: 0,
      scrollY: 0
    });
    const imageAudit = verifyProcessPdfCanvas(canvas, geometry);
    return { canvas, scale, geometry, imageAudit };
  } finally {
    renderPoster.remove();
  }
}

async function downloadProcessGuidePdf(saved = null) {
  const button = saved?.button || document.querySelector('#process-download-pdf');
  const message = saved?.message || document.querySelector('#process-pdf-message');
  message.hidden = true;
  message.className = 'process-pdf-message';
  if (!window.html2canvas || !window.jspdf?.jsPDF) {
    message.textContent = 'PDF 생성 도구를 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
    message.classList.add('error');
    message.hidden = false;
    return;
  }
  button.disabled = true;
  button.textContent = 'PDF 생성 중...';
  try {
    const render = await createProcessGuidePdfCanvas(saved?.preview);
    const pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    if (Math.abs(pageWidth - 210) > 0.02 || Math.abs(pageHeight - 297) > 0.02 || pdf.getNumberOfPages() !== 1) {
      throw new Error('A4 세로 1페이지 PDF를 준비하지 못했습니다.');
    }
    pdf.addImage(render.canvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
    const filename = safeProcessGuidePdfFilename(saved?.productName ?? window.__hssoProcessGuideEditableData?.productName);
    window.__hssoLastProcessPdfAudit = {
      filename,
      captureScale: render.scale,
      canvas: { width: render.canvas.width, height: render.canvas.height },
      page: { width: pageWidth, height: pageHeight, count: pdf.getNumberOfPages() },
      images: render.imageAudit
    };
    pdf.save(filename);
    message.textContent = 'A4 세로 1페이지 PDF를 생성했습니다.';
    message.hidden = false;
  } catch (error) {
    console.error('작업공정별 관리요령 PDF 생성 오류:', error);
    message.textContent = error?.message || 'PDF 생성 중 오류가 발생했습니다.';
    message.classList.add('error');
    message.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = saved?.preview ? 'PDF 저장' : 'PDF 출력';
  }
}

document.querySelector('#process-download-pdf').addEventListener('click', () => downloadProcessGuidePdf());

const processFileInput = document.querySelector('#process-file-input');
const processDropZone = document.querySelector('.process-drop-zone');
const processAnalyzeButton = document.querySelector('#process-analyze-button');
const processAnalysisStatus = document.querySelector('#process-analysis-status');

function selectProcessFile(file) {
  if (!isPdf(file)) {
    selectedProcessFile = null;
    processAnalysisStatus.textContent = 'PDF 파일만 선택할 수 있습니다.';
  } else {
    selectedProcessFile = file;
    processAnalysisStatus.textContent = `${file.name} · ${formatFileSize(file.size)}`;
  }
  processAnalyzeButton.disabled = !selectedProcessFile || isProcessAnalyzing;
}

processFileInput.addEventListener('change', () => selectProcessFile(processFileInput.files[0]));
['dragenter', 'dragover'].forEach((eventName) => processDropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  processDropZone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((eventName) => processDropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  processDropZone.classList.remove('dragging');
}));
processDropZone.addEventListener('drop', (event) => selectProcessFile(event.dataTransfer.files[0]));

processAnalyzeButton.addEventListener('click', async () => {
  if (!selectedProcessFile || isProcessAnalyzing) return;
  isProcessAnalyzing = true;
  processAnalyzeButton.disabled = true;
  processAnalyzeButton.textContent = '분석 중...';
  processAnalysisStatus.textContent = 'MSDS의 1·2·4·5·6·7·8항을 분석하고 있습니다.';
  let extracted;
  try {
    extracted = await extractPdfText(selectedProcessFile);
    const baseAnalysis = analyzeMsdsText(extracted);
    const pictogramEvidence = findSectionTwoEvidence(extracted);
    pictogramEvidence.cropDetection = await extractSectionTwoPictogramCrops(extracted, baseAnalysis);
    pictogramEvidence.cropDetection.comparisons = await comparePictogramCrops(pictogramEvidence.cropDetection);
    const data = createProcessGuideData(extracted, baseAnalysis, automaticGhsCodesFromEvidence(pictogramEvidence));
    window.__hssoLastProcessGuideData = data;
    initializeProcessGuideEditor(data);
    processAnalysisStatus.textContent = '분석이 완료되었습니다. 확인 필요 항목은 원본 MSDS와 대조해 주세요.';
    document.querySelector('#process-result-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error('관리요령 MSDS 분석 오류:', error);
    processAnalysisStatus.textContent = error?.message || 'PDF 분석 중 오류가 발생했습니다.';
  } finally {
    if (extracted?.pdfDocument) await extracted.pdfDocument.destroy();
    isProcessAnalyzing = false;
    processAnalyzeButton.disabled = !selectedProcessFile;
    processAnalyzeButton.textContent = '분석하기';
  }
});

const menuButton = document.querySelector('.menu-button');
const mainMenu = document.querySelector('#main-menu');
const msdsDropdown = document.querySelector('.nav-dropdown');
const msdsMenuButton = document.querySelector('#msds-menu-button');
const msdsMenu = document.querySelector('#msds-menu');
const desktopNavigation = window.matchMedia('(min-width: 901px)');
let msdsCloseTimer;
let msdsOpenBeforeTouch = false;

function setMsdsMenuOpen(isOpen) {
  clearTimeout(msdsCloseTimer);
  msdsMenuButton.setAttribute('aria-expanded', String(isOpen));
  msdsMenu.hidden = !isOpen;
}

msdsDropdown.addEventListener('pointerenter', (event) => {
  if (desktopNavigation.matches && event.pointerType === 'mouse') setMsdsMenuOpen(true);
});
msdsDropdown.addEventListener('pointerleave', (event) => {
  if (desktopNavigation.matches && event.pointerType === 'mouse') {
    msdsCloseTimer = setTimeout(() => {
      if (!msdsDropdown.contains(document.activeElement)) setMsdsMenuOpen(false);
    }, 180);
  }
});
msdsDropdown.addEventListener('focusin', () => {
  if (desktopNavigation.matches) setMsdsMenuOpen(true);
});
msdsDropdown.addEventListener('focusout', (event) => {
  if (!msdsDropdown.contains(event.relatedTarget)) setMsdsMenuOpen(false);
});
msdsMenuButton.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch') msdsOpenBeforeTouch = !msdsMenu.hidden;
});
msdsMenuButton.addEventListener('click', (event) => {
  // Desktop focus/hover already opens the menu; touch remains a disclosure toggle.
  if (event.pointerType === 'touch') setMsdsMenuOpen(!msdsOpenBeforeTouch);
  else if (desktopNavigation.matches) setMsdsMenuOpen(true);
  else setMsdsMenuOpen(msdsMenu.hidden);
});
msdsMenuButton.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setMsdsMenuOpen(true);
    msdsMenu.querySelector('a').focus();
  }
});
document.querySelector('.site-header').addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!msdsMenu.hidden) {
    msdsMenuButton.focus();
    setMsdsMenuOpen(false);
  } else if (mainMenu.classList.contains('open')) {
    mainMenu.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.focus();
  }
});
document.addEventListener('pointerdown', (event) => {
  if (!msdsDropdown.contains(event.target)) setMsdsMenuOpen(false);
});
msdsMenu.addEventListener('click', (event) => {
  if (event.target.closest('[data-coming-soon]')) msdsMenuButton.focus();
  if (event.target.closest('a, button')) setMsdsMenuOpen(false);
});
desktopNavigation.addEventListener('change', () => {
  if (mainMenu.contains(document.activeElement)) {
    (desktopNavigation.matches ? msdsMenuButton : menuButton).focus();
  }
  setMsdsMenuOpen(false);
  mainMenu.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
});
menuButton.addEventListener('click', () => {
  const isOpen = mainMenu.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
  if (!isOpen) setMsdsMenuOpen(false);
});

let toastTimer;
document.querySelectorAll('[data-coming-soon]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const toast = document.querySelector('#toast');
    toast.textContent = link.dataset.comingSoon || `${link.textContent} 메뉴는 추후 개발 예정입니다.`;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  });
});

const appViews = {
  mypage: document.querySelector('#mypage'),
  home: document.querySelector('#home'),
  login: document.querySelector('#login'),
  signup: document.querySelector('#signup'),
  maker: document.querySelector('#maker'),
  'process-guide': document.querySelector('#process-guide'),
  'risk-assessment': document.querySelector('#risk-assessment'),
  'risk-survey-create': document.querySelector('#risk-survey-create'),
  'risk-survey-preview': document.querySelector('#risk-survey-preview'),
  boards: document.querySelector('#boards')
};

// Read-only adapters around the existing final preview data. No parser/editor mutation.
const updateMyPageView = initMyPage((viewName) => {
  if (window.location.hash !== `#${viewName}`) history.pushState({ viewName }, '', `#${viewName}`);
  showAppView(viewName);
}, () => results.hidden ? null : getFinalWarningLabelData(), () => {
  if (document.querySelector('#process-preview').hidden) return null;
  const data = window.__hssoProcessGuideEditableData;
  if (!data) return null;
  return structuredClone({ productName: data.productName, signalWord: data.signalWord, ghs: data.ghs,
    hazardStatements: data.hazardStatements, handling: { safeHandling: data.handling.safeHandling },
    firstAid: { eye: data.firstAid.eye, skin: data.firstAid.skin, inhalation: data.firstAid.inhalation, ingestion: data.firstAid.ingestion },
    accidentResponse: { fire: data.accidentResponse.fire, spill: data.accidentResponse.spill },
    selectedPpe: data.selectedPpe, ppeNone: data.ppeNone });
}, createSavedDocumentPreview({
  createPrintSheet, fitOutputLabels, layouts: PRINT_LAYOUTS,
  processTemplate: document.querySelector('#process-preview .process-poster'),
  renderProcess: renderProcessGuideData,
  downloadWarning: downloadWarningLabelPdf, downloadProcess: downloadProcessGuidePdf
}));

const updateAuthView = initAuthUI((viewName) => {
  if (window.location.hash !== `#${viewName}`) history.pushState({ viewName }, '', `#${viewName}`);
  showAppView(viewName);
});

function showAppView(viewName) {
  if (viewName === 'risk-survey-preview') prepareWorkerSurveyPreview();
  const nextView = appViews[viewName] || appViews.home;
  Object.values(appViews).forEach((view) => {
    view.hidden = view !== nextView;
  });
  document.querySelectorAll('[data-view-link]').forEach((link) => {
    const navView = viewName.startsWith('risk-survey-') ? 'risk-assessment' : viewName;
    const isActive = link.dataset.viewLink === navView && link.closest('.main-nav');
    link.classList.toggle('active', Boolean(isActive));
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  mainMenu.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setMsdsMenuOpen(false);
  updateAuthView(nextView.id);
  updateMyPageView(nextView.id);
}

document.querySelectorAll('[data-view-link]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const viewName = link.dataset.viewLink;
    if (window.location.hash !== `#${viewName}`) history.pushState({ viewName }, '', `#${viewName}`);
    showAppView(viewName);
  });
});

window.addEventListener('popstate', () => {
  showAppView(window.location.hash.slice(1) || 'home');
  if (['#home-tools', '#home-about'].includes(window.location.hash)) scrollToHomeSection(window.location.hash.slice(1));
});

function scrollToHomeSection(id) {
  const section = document.getElementById(id);
  section.focus({ preventScroll: true });
  section.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}

document.querySelectorAll('[data-home-tools], [data-home-section]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const id = link.dataset.homeSection || 'home-tools';
    if (window.location.hash !== `#${id}`) history.pushState({ viewName: 'home' }, '', `#${id}`);
    showAppView('home');
    scrollToHomeSection(id);
  });
});

if (window.location.hash === '#maker') showAppView('maker');
if (window.location.hash === '#mypage') showAppView('mypage');
if (['#home-tools', '#home-about'].includes(window.location.hash)) scrollToHomeSection(window.location.hash.slice(1));
if (window.location.hash === '#process-guide') showAppView('process-guide');
if (window.location.hash === '#risk-assessment') showAppView('risk-assessment');
if (window.location.hash === '#risk-survey-create') showAppView('risk-survey-create');
if (window.location.hash === '#boards') showAppView('boards');
if (['#login', '#signup'].includes(window.location.hash)) showAppView(window.location.hash.slice(1));

document.querySelector('#risk-survey-form').addEventListener('submit', (event) => event.preventDefault());

['before', 'after'].forEach((phase) => {
  const likelihood = document.querySelector(`#${phase}-likelihood`);
  const severity = document.querySelector(`#${phase}-severity`);
  const score = document.querySelector(`#${phase}-risk-score`);
  const updateScore = () => {
    score.value = likelihood.value && severity.value
      ? `발생 가능성 ${likelihood.value} × 중대성 ${severity.value} = 위험성 ${Number(likelihood.value) * Number(severity.value)}`
      : '발생 가능성과 중대성을 모두 선택해주세요.';
  };
  likelihood.addEventListener('change', updateScore);
  severity.addEventListener('change', updateScore);
});

function prepareWorkerSurveyPreview() {
  const value = (id) => document.getElementById(id).value.trim();
  document.querySelector('#worker-survey-title').textContent = value('survey-title') || '위험성평가 설문';
  document.querySelector('#worker-survey-target').textContent = value('survey-target') || '대상 미입력';
  document.querySelector('#worker-survey-period').textContent = `${value('survey-start-date') || '시작일 미입력'} ~ ${value('survey-end-date') || '종료일 미입력'}`;
  document.querySelector('#worker-survey-description').textContent = value('survey-description');
  let participantCount = 0;
  [['survey-collect-name', 'worker-name'], ['survey-collect-department', 'worker-department'], ['survey-collect-employee-id', 'worker-employee-id']].forEach(([setting, inputId]) => {
    const enabled = document.getElementById(setting).checked;
    document.getElementById(`${inputId}-field`).hidden = !enabled;
    document.getElementById(inputId).disabled = !enabled;
    if (enabled) participantCount += 1;
  });
  const anonymous = document.querySelector('#survey-allow-anonymous').checked;
  document.querySelector('#worker-anonymous-note').textContent = anonymous
    ? '익명 응답이 허용됩니다. 이름과 사번을 비워두어도 됩니다.'
    : '설정된 참여자 정보를 작성해주세요.';
  document.querySelector('#worker-participants').hidden = !participantCount && !anonymous;
  const photoAllowed = document.querySelector('#survey-allow-photo').checked;
  document.querySelector('#worker-photo-field').hidden = !photoAllowed;
  document.querySelector('#worker-photo').disabled = !photoAllowed;
  document.querySelector('#worker-submit-message').hidden = true;
}

function appendWorkerChoice(container, name, value, text, type) {
  const label = document.createElement('label');
  label.className = 'worker-choice';
  const input = document.createElement('input');
  input.type = type;
  input.name = name;
  input.value = value;
  input.id = `${name}-${value}`;
  const caption = document.createElement('span');
  caption.textContent = text;
  label.append(input, caption);
  container.append(label);
}

document.querySelectorAll('#survey-question-2 .survey-choice-list li').forEach((item, index) => {
  appendWorkerChoice(document.querySelector('#worker-hazard-types'), 'workerHazardTypes', String(index + 1), item.textContent, 'checkbox');
});
document.querySelectorAll('.survey-reason-list li').forEach((item, index) => {
  appendWorkerChoice(document.querySelector('#worker-safe-reasons'), 'workerSafeReason', String(index + 1), item.textContent, 'radio');
});
['before', 'after'].forEach((phase) => {
  ['likelihood', 'severity'].forEach((dimension) => {
    const container = document.getElementById(`worker-${phase}-${dimension}`);
    [...document.getElementById(`${phase}-${dimension}`).options].filter((option) => option.value).forEach((option) => {
      appendWorkerChoice(container, `worker-${phase}-${dimension}`, option.value, option.textContent, 'radio');
    });
    container.addEventListener('change', () => {
      const likelihood = document.querySelector(`input[name="worker-${phase}-likelihood"]:checked`)?.value;
      const severity = document.querySelector(`input[name="worker-${phase}-severity"]:checked`)?.value;
      document.getElementById(`worker-${phase}-risk-score`).value = likelihood && severity
        ? `발생 가능성 ${likelihood} × 중대성 ${severity} = 위험성 ${Number(likelihood) * Number(severity)}`
        : '발생 가능성과 중대성을 모두 선택해주세요.';
    });
  });
});
document.querySelectorAll('input[name="workerHasHazard"]').forEach((input) => {
  input.addEventListener('change', () => {
    document.querySelector('#worker-hazard-details').hidden = input.value !== 'yes';
    document.querySelector('#worker-safe-reasons-field').hidden = input.value !== 'no';
  });
});
document.querySelector('#worker-survey-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submitWorkerSurvey();
});
if (window.location.hash === '#risk-survey-preview') showAppView('risk-survey-preview');

const surveyQuestions = () => {
  const questions = [...document.querySelectorAll('#survey-question-1, #survey-question-2, #survey-question-3, #survey-question-4, #survey-question-5, #survey-question-6, #survey-question-7, #survey-question-8')].map((node, index) => ({
    id: `q${index + 1}`,
    type: node.querySelector('.survey-question-type')?.textContent.trim() || 'text',
    text: node.querySelector('h3')?.textContent.trim() || '',
    options: [...node.querySelectorAll('.survey-choice-list li')].map(item => item.textContent.trim())
  }));
  questions.push({ id: 'safe_reason', type: 'single_choice', text: document.querySelector('#survey-no-risk-heading').textContent.trim(), options: [...document.querySelectorAll('.survey-reason-list li')].map(item => item.textContent.trim()) });
  return questions;
};

function builderSurveyData() {
  const checked = id => document.getElementById(id).checked;
  return {
    title: document.getElementById('survey-title').value.trim(), target: document.getElementById('survey-target').value.trim(),
    startDate: document.getElementById('survey-start-date').value, endDate: document.getElementById('survey-end-date').value,
    guidance: document.getElementById('survey-description').value,
    settings: { collectName: checked('survey-collect-name'), collectDepartment: checked('survey-collect-department'), collectEmployeeId: checked('survey-collect-employee-id'), allowAnonymous: checked('survey-allow-anonymous'), allowDuplicates: checked('survey-allow-duplicates'), allowEdit: checked('survey-allow-edit'), allowPhoto: checked('survey-allow-photo') },
    questions: surveyQuestions(), isActive: checked('survey-active')
  };
}

document.getElementById('survey-create-button').addEventListener('click', async () => {
  const trigger = document.getElementById('survey-create-button'), note = document.getElementById('survey-action-note'), data = builderSurveyData();
  if (!data.title || !data.target || !data.startDate || !data.endDate || data.startDate > data.endDate || !data.questions.length) { note.textContent = '제목, 대상, 올바른 실시기간을 입력해주세요.'; return; }
  trigger.disabled = true; note.textContent = '설문을 저장하는 중입니다.';
  try {
    const response = await fetch('/api/risk-surveys', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json().catch(() => null);
    if (response.status === 401) { note.textContent = '설문을 저장하려면 로그인이 필요합니다.'; history.pushState({ viewName: 'login' }, '', '#login'); showAppView('login'); return; }
    if (!response.ok || !result?.ok) throw new Error();
    const url = `${location.origin}/survey/${result.survey.publicToken}`;
    note.replaceChildren(document.createTextNode('설문 저장 완료 · '));
    const link = document.createElement('a'); link.href = url; link.textContent = url; link.target = '_blank'; link.rel = 'noopener';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'secondary-button survey-copy-button'; copy.textContent = '링크 복사';
    copy.addEventListener('click', async () => { await navigator.clipboard.writeText(url); copy.textContent = '복사됨'; });
    note.append(link, document.createTextNode(' '), copy, document.createTextNode(' · 마이페이지에서 관리할 수 있습니다.'));
  } catch { note.textContent = '설문을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.'; }
  finally { trigger.disabled = false; }
});

let publicSurveyToken = null;
function applyPublicSurvey(survey) {
  document.getElementById('worker-survey-title').textContent = survey.title;
  document.getElementById('worker-survey-target').textContent = survey.target;
  document.getElementById('worker-survey-period').textContent = `${survey.startDate} ~ ${survey.endDate}`;
  document.getElementById('worker-survey-description').textContent = survey.guidance;
  const pairs = [['collectName','worker-name'],['collectDepartment','worker-department'],['collectEmployeeId','worker-employee-id']];
  for (const [setting,id] of pairs) { document.getElementById(`${id}-field`).hidden = !survey.settings[setting]; document.getElementById(id).disabled = !survey.settings[setting]; document.getElementById(id).required = survey.settings[setting] && !survey.settings.allowAnonymous; }
  document.getElementById('worker-anonymous-note').textContent = survey.settings.allowAnonymous ? '익명 응답이 허용됩니다. 개인정보를 비우면 익명으로 제출됩니다.' : '표시된 참여자 정보를 입력해주세요.';
  document.getElementById('worker-photo-field').hidden = !survey.settings.allowPhoto;
  document.getElementById('worker-photo').disabled = true;
  if (survey.settings.allowPhoto) document.querySelector('#worker-photo-field .survey-help').textContent = '사진 첨부 기능은 준비 중입니다.';
  document.querySelector('.site-header').hidden = true; document.querySelector('.site-footer').hidden = true;
}

async function loadPublicSurvey(token) {
  publicSurveyToken = token; showAppView('risk-survey-preview');
  document.querySelector('#risk-survey-preview > .back-button').hidden = true;
  const message = document.getElementById('worker-submit-message'); message.hidden = false; message.textContent = '설문을 불러오는 중입니다.';
  try {
    const response = await fetch(`/api/public/risk-surveys/${encodeURIComponent(token)}`, { credentials: 'omit', cache: 'no-store' }); const result = await response.json().catch(() => null);
    if (!response.ok) { const messages = { SURVEY_INACTIVE: '현재 응답을 받고 있지 않은 설문입니다.', SURVEY_NOT_STARTED: '아직 시작되지 않은 설문입니다.', SURVEY_ENDED: '종료된 설문입니다.' }; throw Object.assign(new Error(), { message: messages[result?.error] || '설문을 찾을 수 없습니다.' }); }
    applyPublicSurvey(result.survey); message.hidden = true;
  } catch (error) { document.getElementById('worker-survey-form').querySelectorAll('input,textarea,button').forEach(node => node.disabled = true); message.textContent = error.message || '설문을 불러오지 못했습니다.'; }
}

async function submitWorkerSurvey() {
  const message = document.getElementById('worker-submit-message');
  if (!publicSurveyToken) { message.hidden = false; message.textContent = '미리보기에서는 응답이 저장되지 않습니다.'; return; }
  const button = document.getElementById('worker-submit-button'), hasHazardValue = document.querySelector('input[name="workerHasHazard"]:checked')?.value;
  if (!hasHazardValue) { message.hidden = false; message.textContent = '위험요인 여부를 선택해주세요.'; return; }
  const value = id => document.getElementById(id).value.trim(); const selected = name => document.querySelector(`input[name="${name}"]:checked`)?.value;
  const hasHazard = hasHazardValue === 'yes';
  const data = { respondentName:value('worker-name'), department:value('worker-department'), employeeId:value('worker-employee-id'), isAnonymous: !value('worker-name') && !value('worker-department') && !value('worker-employee-id'), hasHazard,
    hazardTypes:[...document.querySelectorAll('input[name="workerHazardTypes"]:checked')].map(node => node.parentElement.textContent.trim()), hazardDescription:value('worker-hazard-description'), location:value('worker-hazard-location'), improvementSuggestion:value('worker-improvement'), safeReason:document.querySelector('input[name="workerSafeReason"]:checked')?.parentElement.textContent.trim() || '',
    preLikelihood:hasHazard ? Number(selected('worker-before-likelihood')) || null : null, preSeverity:hasHazard ? Number(selected('worker-before-severity')) || null : null, postLikelihood:hasHazard ? Number(selected('worker-after-likelihood')) || null : null, postSeverity:hasHazard ? Number(selected('worker-after-severity')) || null : null };
  button.disabled = true; message.hidden = false; message.textContent = '응답을 제출하는 중입니다.';
  try { const response = await fetch(`/api/public/risk-surveys/${encodeURIComponent(publicSurveyToken)}/responses`, { method:'POST', credentials:'omit', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) }); const result=await response.json().catch(()=>null); if(!response.ok) throw Object.assign(new Error(),{code:result?.error}); message.textContent='응답이 제출되었습니다.'; document.getElementById('worker-survey-form').querySelectorAll('input,textarea,button').forEach(node=>node.disabled=true); localStorage.setItem(`hsso-risk-${publicSurveyToken}`,'submitted'); }
  catch(error) { button.disabled=false; message.textContent=error.code==='DUPLICATE_RESPONSE'?'이미 제출된 사번입니다.':'입력 내용을 확인한 뒤 다시 제출해주세요.'; }
}

const publicPathMatch = /^\/survey\/([a-f0-9]{64})\/?$/.exec(location.pathname);
if (publicPathMatch) loadPublicSurvey(publicPathMatch[1]);
