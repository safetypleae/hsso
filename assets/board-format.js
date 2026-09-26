export const BOARD_RICH_MARKER = '[HSSO:RICH]';

const SIZES = new Set(['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px']);
const ALIGNS = new Set(['left', 'center', 'right']);
const BLOCKS = new Set(['paragraph', 'ul', 'ol']);
const FORBIDDEN = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG', 'MATH', 'VIDEO', 'AUDIO', 'CANVAS', 'FORM', 'INPUT', 'BUTTON']);
const MAX_TEXT = 10000;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameMarks = (a, b) => ['bold', 'italic', 'underline', 'strike', 'size', 'href'].every(key => (a[key] || null) === (b[key] || null));

export function safeRichHref(value) {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  if (!href || href.length > 2048) return null;
  if ((href.startsWith('/') && !href.startsWith('//')) || href.startsWith('#')) return href;
  return /^(?:https?:\/\/|mailto:|tel:)/i.test(href) ? href : null;
}

function normalizeRun(value) {
  if (!object(value) || typeof value.text !== 'string') return null;
  const run = { text: value.text };
  for (const key of ['bold', 'italic', 'underline', 'strike']) if (value[key] === true) run[key] = true;
  if (SIZES.has(value.size)) run.size = value.size;
  const href = safeRichHref(value.href); if (href) run.href = href;
  return run;
}

function normalizeRuns(values, state) {
  if (!Array.isArray(values)) return [];
  const runs = [];
  for (const value of values) {
    const run = normalizeRun(value); if (!run) continue;
    state.length += Array.from(run.text).length; if (state.length > MAX_TEXT) return null;
    const last = runs.at(-1);
    if (last && sameMarks(last, run)) last.text += run.text; else runs.push(run);
  }
  return runs;
}

export function normalizeRichDocument(value) {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.blocks) || value.blocks.length > 1000) return null;
  const state = { length: 0 }, blocks = [];
  for (const source of value.blocks) {
    if (!object(source) || !BLOCKS.has(source.type)) continue;
    const align = ALIGNS.has(source.align) ? source.align : 'left';
    if (source.type === 'paragraph') {
      const runs = normalizeRuns(source.runs, state); if (runs === null) return null; blocks.push({ type: 'paragraph', align, runs });
    } else {
      if (!Array.isArray(source.items) || source.items.length > 1000) continue;
      const items = [];
      for (const item of source.items) { const runs = normalizeRuns(item, state); if (runs === null) return null; items.push(runs); }
      blocks.push({ type: source.type, align, items });
    }
  }
  if (!blocks.length || state.length === 0) return null;
  return { version: 1, blocks };
}

export function parseRichStorage(value) {
  if (typeof value !== 'string' || !value.startsWith(`${BOARD_RICH_MARKER}\n`)) return null;
  try { return normalizeRichDocument(JSON.parse(value.slice(BOARD_RICH_MARKER.length + 1))); } catch { return null; }
}

export function sanitizeStoredBoardContent(value) {
  if (typeof value !== 'string') return null;
  if (!value.startsWith(`${BOARD_RICH_MARKER}\n`)) return Array.from(value).length <= MAX_TEXT && value.trim() ? value.trim() : null;
  const rich = parseRichStorage(value); return rich ? `${BOARD_RICH_MARKER}\n${JSON.stringify(rich)}` : null;
}

function appendRuns(parent, runs, doc) {
  for (const run of runs) {
    let node = doc.createTextNode(run.text);
    if (run.bold) { const element = doc.createElement('strong'); element.append(node); node = element; }
    if (run.italic) { const element = doc.createElement('em'); element.append(node); node = element; }
    if (run.underline) { const element = doc.createElement('u'); element.append(node); node = element; }
    if (run.strike) { const element = doc.createElement('s'); element.append(node); node = element; }
    if (run.size) { const element = doc.createElement('span'); element.classList.add(`board-rich-size-${run.size}`); element.append(node); node = element; }
    if (run.href) { const link = doc.createElement('a'); link.href = run.href; if (/^https?:\/\//i.test(run.href)) { link.target = '_blank'; link.rel = 'noopener noreferrer'; } link.append(node); node = link; }
    parent.append(node);
  }
}

export function renderBoardContent(value, doc = document) {
  const rich = parseRichStorage(value), root = doc.createElement('div');
  if (!rich) { root.className = 'board-format-plain'; root.textContent = String(value ?? ''); return root; }
  root.className = 'board-rich-content';
  for (const block of rich.blocks) {
    if (block.type === 'paragraph') { const paragraph = doc.createElement('p'); paragraph.className = `board-rich-align-${block.align}`; appendRuns(paragraph, block.runs, doc); if (!block.runs.length) paragraph.append(doc.createElement('br')); root.append(paragraph); }
    else { const list = doc.createElement(block.type); list.className = `board-rich-align-${block.align}`; for (const item of block.items) { const row = doc.createElement('li'); appendRuns(row, item, doc); list.append(row); } root.append(list); }
  }
  return root;
}

function sizeValue(element) {
  for (const size of SIZES) if (element.classList?.contains(`board-rich-size-${size}`)) return size;
  const value = String(element.style?.fontSize || '').toLowerCase();
  return SIZES.has(value) ? value : null;
}

function collectRuns(node, marks, runs) {
  if (node.nodeType === 3) { if (node.data) runs.push({ text: node.data, ...marks }); return; }
  if (node.nodeType !== 1 || FORBIDDEN.has(node.tagName)) return;
  if (node.tagName === 'BR') { runs.push({ text: '\n', ...marks }); return; }
  const next = { ...marks }, tag = node.tagName;
  if (tag === 'B' || tag === 'STRONG' || node.style?.fontWeight === 'bold' || Number(node.style?.fontWeight) >= 600) next.bold = true;
  if (tag === 'I' || tag === 'EM' || node.style?.fontStyle === 'italic') next.italic = true;
  const decoration = node.style?.textDecoration || node.style?.textDecorationLine || '';
  if (tag === 'U' || decoration.includes('underline')) next.underline = true;
  if (tag === 'S' || tag === 'STRIKE' || decoration.includes('line-through')) next.strike = true;
  const size = sizeValue(node); if (size) next.size = size;
  if (tag === 'A') { const href = safeRichHref(node.getAttribute('href')); if (href) next.href = href; }
  node.childNodes.forEach(child => collectRuns(child, next, runs));
}

const alignment = node => {
  if (ALIGNS.has(node.style?.textAlign)) return node.style.textAlign;
  if (ALIGNS.has(node.getAttribute?.('align'))) return node.getAttribute('align');
  for (const align of ALIGNS) if (node.classList?.contains(`board-rich-align-${align}`)) return align;
  return 'left';
};
const runsFor = node => { const runs = []; node.childNodes.forEach(child => collectRuns(child, {}, runs)); return runs; };

export function editorElementToDocument(editor) {
  const blocks = [];
  const appendNodes = (nodes, inheritedAlign = 'left') => {
    const inline = [];
    const flush = () => {
      if (!inline.length) return;
      const shell = editor.ownerDocument.createElement('div');
      inline.splice(0).forEach(node => shell.append(node.cloneNode(true)));
      blocks.push({ type: 'paragraph', align: inheritedAlign, runs: runsFor(shell) });
    };
    for (const node of nodes) {
      if (node.nodeType === 1 && (node.tagName === 'UL' || node.tagName === 'OL')) {
        flush();
        blocks.push({ type: node.tagName.toLowerCase(), align: alignment(node), items: [...node.children].filter(item => item.tagName === 'LI').map(runsFor) });
      } else if (node.nodeType === 1 && ['DIV', 'P'].includes(node.tagName)) {
        flush();
        const align = alignment(node);
        const hasNestedBlock = [...node.children].some(child => ['DIV', 'P', 'UL', 'OL'].includes(child.tagName));
        if (hasNestedBlock) appendNodes(node.childNodes, align);
        else blocks.push({ type: 'paragraph', align, runs: runsFor(node) });
      } else inline.push(node);
    }
    flush();
  };
  appendNodes(editor.childNodes);
  return normalizeRichDocument({ version: 1, blocks });
}

function fillEditor(editor, storedValue, doc) {
  const rich = parseRichStorage(storedValue);
  if (rich) { const rendered = renderBoardContent(storedValue, doc); editor.replaceChildren(...rendered.childNodes); }
  else if (storedValue) { const lines = String(storedValue).replace(/\r\n?/g, '\n').split('\n'); lines.forEach((line, index) => { if (index) editor.append(doc.createElement('br')); editor.append(doc.createTextNode(line)); }); }
}

export function createBoardRichEditor(storedValue = '', doc = document) {
  const wrap = doc.createElement('div'); wrap.className = 'board-rich-editor';
  const toolbar = doc.createElement('div'); toolbar.className = 'board-rich-toolbar'; toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', '본문 서식');
  const editor = doc.createElement('div'); editor.className = 'board-rich-input'; editor.contentEditable = 'true'; editor.setAttribute('role', 'textbox'); editor.setAttribute('aria-multiline', 'true'); editor.setAttribute('aria-label', '내용'); editor.dataset.richEditor = '';
  fillEditor(editor, storedValue, doc);
  const message = doc.createElement('p'); message.className = 'board-rich-message'; message.setAttribute('role', 'status');
  let savedRange = null;
  const remember = () => { const selection = doc.getSelection(); if (selection?.rangeCount && editor.contains(selection.anchorNode)) savedRange = selection.getRangeAt(0).cloneRange(); };
  for (const eventName of ['focus', 'mouseup', 'touchend', 'keyup', 'input']) editor.addEventListener(eventName, remember);
  const restore = () => { if (!savedRange) return false; const selection = doc.getSelection(); selection.removeAllRanges(); selection.addRange(savedRange); return true; };
  const command = (name, value = null) => { restore(); doc.execCommand(name, false, value); editor.focus(); remember(); };
  const select = (label, options, initialValue, action) => { const control = doc.createElement('select'); control.setAttribute('aria-label', label); for (const [value, text] of options) { const option = doc.createElement('option'); option.value = value; option.textContent = text; control.append(option); } control.value = initialValue; control.addEventListener('change', () => action(control.value)); toolbar.append(control); };
  const button = (text, label, action, className = '') => { const control = doc.createElement('button'); control.type = 'button'; control.textContent = text; control.title = label; control.setAttribute('aria-label', label); if (className) control.className = className; control.addEventListener('mousedown', event => event.preventDefault()); control.addEventListener('click', action); toolbar.append(control); };
  select('글자 크기', [...SIZES].map(value => [value, value]), '16px', value => {
    restore(); doc.execCommand('fontSize', false, '7');
    editor.querySelectorAll('font[size="7"]').forEach(font => { const span = doc.createElement('span'); span.style.fontSize = value; span.append(...font.childNodes); font.replaceWith(span); });
    editor.focus(); remember();
  });
  button('B', '굵게', () => command('bold'), 'is-bold'); button('I', '기울임', () => command('italic'), 'is-italic'); button('U', '밑줄', () => command('underline'), 'is-underline'); button('S', '취소선', () => command('strikeThrough'), 'is-strike');
  button('≡', '왼쪽 정렬', () => command('justifyLeft')); button('≡', '가운데 정렬', () => command('justifyCenter'), 'is-center'); button('≡', '오른쪽 정렬', () => command('justifyRight'), 'is-right');
  button('• 목록', '글머리 목록', () => command('insertUnorderedList')); button('1. 목록', '번호 목록', () => command('insertOrderedList'));
  const linkInput = doc.createElement('input'); linkInput.type = 'url'; linkInput.className = 'board-rich-link-input'; linkInput.placeholder = 'https://'; linkInput.setAttribute('aria-label', '링크 주소'); toolbar.append(linkInput);
  button('링크', '링크 삽입', () => { const href = safeRichHref(linkInput.value); if (!href) { message.textContent = 'http(s), mailto, tel 또는 사이트 내부 주소만 사용할 수 있습니다.'; return; } if (!restore() || doc.getSelection().isCollapsed) { message.textContent = '링크를 적용할 텍스트를 먼저 선택해주세요.'; return; } command('createLink', href); linkInput.value = ''; message.textContent = '링크를 적용했습니다.'; });
  button('해제', '링크 해제', () => { command('unlink'); message.textContent = '링크를 해제했습니다.'; });
  editor.addEventListener('paste', event => { event.preventDefault(); command('insertText', event.clipboardData?.getData('text/plain') || ''); });
  editor.addEventListener('drop', event => event.preventDefault());
  wrap.append(toolbar, editor, message);
  return { element: wrap, editor, isEmpty: () => !editor.textContent.trim(), focus: () => editor.focus(), serialize: () => { const rich = editorElementToDocument(editor); return rich ? `${BOARD_RICH_MARKER}\n${JSON.stringify(rich)}` : ''; } };
}
