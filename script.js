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
const pictogramCandidates = new Map();
const pictogramAutomaticGrades = new Map();
let unresolvedPictogramCount = 0;
let pictogramEmptyReason = '';

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

const CIRCLED_ITEM_PATTERN = /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*/;
const LIST_ITEM_PATTERN = /^(?:(?:[가-하]|\d{1,2})\s*[.)·]\s*|[()（]\s*(?:[가-하]|\d{1,2})\s*[)）]\s*)/;

function stripListMarker(value) {
  return value.replace(CIRCLED_ITEM_PATTERN, '').replace(LIST_ITEM_PATTERN, '').trim();
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
    const pageCandidates = imageBoxes.filter((box) => pageLabels.some((label) => isSpatialPictogramCandidate(box, label)))
      .filter((box, index, all) => all.findIndex((other) => Math.abs(other.x - box.x) < 0.5 && Math.abs(other.y - box.y) < 0.5 && Math.abs(other.width - box.width) < 0.5 && Math.abs(other.height - box.height) < 0.5) === index)
      .sort((left, right) => left.x - right.x || right.y - left.y);
    candidates.push(...pageCandidates.map((candidate) => ({ page: pageNumber, ...candidate })));
    if (!pageCandidates.length) continue;
    const viewport = page.getViewport({ scale });
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = Math.ceil(viewport.width);
    pageCanvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: pageCanvas.getContext('2d'), viewport }).promise;
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

const PHONE_PATTERN = /(?<!\d)(?:\+?82\s*[-)]?\s*)?(?:\(\s*)?0\d{1,2}\s*\)?\s*(?:-|\s)\s*\d{3,4}\s*(?:-|\s)\s*\d{4}(?!\d)/;

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
  const value = normalized(line).replace(/[.·ㆍ:：()\-]/g, '');
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
  const match = line.match(/^(?:[가-하]\.?\s*)?(?:예방조치\s*문구\s*\|\s*)?(예방|대응|저장|폐기)(?:\s*[|:：-]\s*|\s+(?=P\d{3})|\s*$)/);
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
  const value = cleanLine(cell?.rawText || '').replace(/^[가-하]\.?\s*/, '').replace(/[|:：\-]/g, '').trim();
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
    let selected = rowAnchors[0] || null;
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
      line = cleanLine(line.replace(/^(?:[가-하]\.?\s*)?(?:예방조치\s*문구\s*\|\s*)?(?:예방|대응|저장|폐기)(?:\s*[|:：-]\s*|\s+(?=P\d{3})|\s*$)/, ''));
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
    /^(?:[가-하]\.?)?\s*(?:공급자|유통업자)(?=\s*[|:：])\s*(?:[|:：]\s*)?/i
  ];
  const manufacturerPatterns = [
    /^(?:[가-하]\.?)?\s*(?:제조회사명|제조사명|공급자명|유통업자명|회사명|제조자명)\s*(?:[|:：]\s*)?/i,
    /^(?:[가-하]\.?)?\s*제조자\s*(?:[|:：]\s*)?/i
  ];
  let supplierName = extractFieldValue(lines, preferredSupplierPatterns, 2) || extractFieldValue(lines, manufacturerPatterns, 2);
  const invalidSupplier = (value) => !value || /수입품|정보\s*기재|긴급\s*연락\s*가능/i.test(value) || /^(?:정보|배급업자|유통업자|제조자)$/i.test(value);
  if (invalidSupplier(supplierName)) {
    supplierName = lines.map((line) => {
      const match = line.match(/^공급자\s*\|\s*(.+)$/i);
      return match ? match[1].split(/\s*\|\s*/)[0].trim() : '';
    }).find((candidate) => !invalidSupplier(candidate)) || '';
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
  previewPictograms.replaceChildren(...(selected.length
    ? selected.map((pictogram) => {
      const image = document.createElement('img');
      image.src = pictogram.asset;
      image.alt = `${pictogram.name} (${pictogram.code})`;
      return image;
    })
    : [Object.assign(document.createElement('span'), { className: 'no-pictogram', textContent: '확인된 그림문자 없음' })]));

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
}

function classifyPictogramComparison(comparison) {
  const reliableCrop = comparison.detectionConfidence === 'high';
  if (!reliableCrop || comparison.first.score < 0.45 || comparison.scoreGap < 0.10) return 'C';
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
