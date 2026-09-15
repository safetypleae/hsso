import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from './helpers/vendor/jsqr.cjs';
import { surveyQrUrl, qrFilename, drawSurveyQr } from '../assets/risk/qr.js';

const token = '0123456789abcdef'.repeat(4);
test('QR uses the existing token, canonical production domain and exact local origin', () => {
  for (const origin of ['http://localhost:8788', 'http://127.0.0.1:3000', 'http://[::1]:8080']) {
    assert.equal(surveyQrUrl(token, new URL(origin)), `${origin}/survey/${token}`);
  }
  for (const origin of ['https://hsso.co.kr', 'https://www.hsso.co.kr', 'http://hsso.co.kr', 'https://preview.pages.dev']) {
    assert.equal(surveyQrUrl(token, new URL(origin)), `https://hsso.co.kr/survey/${token}`);
  }
  for (const bad of ['', 'abc', token + '/', null]) assert.throws(() => surveyQrUrl(bad, new URL('https://hsso.co.kr')));
});

test('PNG filenames preserve Korean titles and remove filesystem separators', () => {
  assert.equal(qrFilename('2026 정기 위험성평가'), '2026 정기 위험성평가_설문_QR.png');
  assert.equal(qrFilename('공장/설문:1?'), '공장_설문_1__설문_QR.png');
  assert.equal(qrFilename(''), '위험성평가_설문_QR.png');
});

for (const origin of ['https://hsso.co.kr', 'http://localhost:8788', 'http://127.0.0.1:3000']) {
  test(`independent decoder reads locally rendered QR for ${origin}`, async () => {
    const canvas = { width: 0, height: 0, getContext() {
      const rgba = this.rgba = new Uint8ClampedArray(this.width * this.height * 4);
      const width = this.width;
      return { fillStyle: '#ffffff', fillRect(x, y, w, h) {
        const color = this.fillStyle === '#ffffff' ? 255 : 0;
        for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
          const p = (row * width + col) * 4; rgba[p] = rgba[p + 1] = rgba[p + 2] = color; rgba[p + 3] = 255;
        }
      } };
    } };
    const url = await drawSurveyQr(canvas, token, new URL(origin));
    const scanned = jsQR(canvas.rgba, canvas.width, canvas.height);
    assert.equal(scanned?.data, url); assert.equal(url, origin + '/survey/' + token);
    // Four complete white modules surround the code, at integer pixel scale.
    assert(canvas.rgba.slice(0, canvas.width * 32 * 4).every(value => value === 255));
  });
}
