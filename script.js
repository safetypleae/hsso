// DOM 요소 참조
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
const results = document.querySelector('#results');
const selectedSizeText = document.querySelector('#selected-size-text');

let selectedFile = null;

// 파일 크기를 읽기 쉬운 단위로 변환한다.
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

// PDF만 화면 상태에 반영하며 파일 내용은 읽거나 분석하지 않는다.
function selectFile(file) {
  fileError.hidden = true;
  if (!isPdf(file)) {
    showFileError('PDF 파일만 선택할 수 있습니다.');
    return;
  }

  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  fileInfo.hidden = false;
  dropZone.hidden = true;
  updateAnalyzeButton();
}

function removeFile() {
  selectedFile = null;
  fileInput.value = '';
  fileInfo.hidden = true;
  dropZone.hidden = false;
  fileError.hidden = true;
  results.hidden = true;
  updateAnalyzeButton();
}

function hasValidSize() {
  const selectedSize = document.querySelector('input[name="label-size"]:checked');
  if (!selectedSize) return false;
  if (selectedSize.value !== 'custom') return true;
  return Number(customWidth.value) > 0 && Number(customHeight.value) > 0;
}

function updateAnalyzeButton() {
  analyzeButton.disabled = !(selectedFile && hasValidSize());
}

// 클릭, 키보드, 드래그 앤 드롭으로 파일을 선택한다.
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

// 크기 선택 및 직접 입력 유효성을 관리한다.
sizeInputs.forEach((input) => {
  input.addEventListener('change', () => {
    customSize.hidden = input.value !== 'custom';
    updateAnalyzeButton();
  });
});
[customWidth, customHeight].forEach((input) => input.addEventListener('input', updateAnalyzeButton));

// 현재 MVP에서는 분석 대신 비어 있는 편집 화면을 표시한다.
analyzeButton.addEventListener('click', () => {
  const selectedSize = document.querySelector('input[name="label-size"]:checked');
  selectedSizeText.textContent = selectedSize.value === 'custom'
    ? `${customWidth.value} × ${customHeight.value} mm`
    : `${selectedSize.value} 선택됨`;
  results.hidden = false;
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// 입력값을 경고표지 미리보기에 즉시 반영한다.
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
  });
});

// 모바일 메뉴와 추후 개발 메뉴 안내
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
