import assert from 'node:assert/strict';
import test from 'node:test';
import { BOARD_RICH_MARKER, normalizeRichDocument, parseRichStorage, safeRichHref, sanitizeStoredBoardContent } from '../assets/board-format.js';

const stored = document => `${BOARD_RICH_MARKER}\n${JSON.stringify(document)}`;

test('legacy plain text remains unchanged and empty content stays invalid', () => {
  const content = '기존 본문\n\n<script>alert(1)</script>';
  assert.equal(sanitizeStoredBoardContent(content), content);
  assert.equal(sanitizeStoredBoardContent('   '), null);
});

test('rich document retains only the explicit formatting allowlist', () => {
  const input = { version: 1, onclick: 'alert(1)', blocks: [
    { type: 'paragraph', align: 'center', style: 'background:url(javascript:1)', runs: [
      { text: '서식', bold: true, italic: true, underline: true, strike: true, font: 'serif', size: '18px', href: 'https://hsso.co.kr/', onclick: 'alert(1)' },
      { text: '위험 링크', href: 'javascript:alert(1)' }
    ] },
    { type: 'iframe', runs: [{ text: '삭제' }] },
    { type: 'ul', align: 'right', items: [[{ text: '목록' }]] }
  ] };
  assert.deepEqual(normalizeRichDocument(input), { version: 1, blocks: [
    { type: 'paragraph', align: 'center', runs: [
      { text: '서식', bold: true, italic: true, underline: true, strike: true, size: '18px', href: 'https://hsso.co.kr/' },
      { text: '위험 링크' }
    ] },
    { type: 'ul', align: 'right', items: [[{ text: '목록' }]] }
  ] });
  const sanitized = sanitizeStoredBoardContent(stored(input));
  assert.deepEqual(parseRichStorage(sanitized), normalizeRichDocument(input));
  assert.doesNotMatch(sanitized, /onclick|javascript:|iframe|style/);
});

test('links allow only safe schemes and internal destinations', () => {
  for (const href of ['https://hsso.co.kr/', 'http://example.com', 'mailto:help@example.com', 'tel:0212345678', '/guide/', '#section']) assert.equal(safeRichHref(href), href);
  for (const href of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', 'vbscript:x', '']) assert.equal(safeRichHref(href), null);
});
