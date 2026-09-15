const element = (tag, text = '', className = '') => Object.assign(document.createElement(tag), { textContent: text, className });
let activeDialog;

export function surveyQrUrl(token, current = window.location) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw new Error('공개 설문 링크를 확인해주세요.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(current.hostname);
  return `${local ? current.origin : 'https://hsso.co.kr'}/survey/${token}`;
}

export function qrFilename(title) {
  const name = String(title || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/g, '').slice(0, 80);
  return `${name || '위험성평가'}_설문_QR.png`;
}

export async function drawSurveyQr(canvas, token, current = window.location) {
  const { default: qrcode } = await import('./vendor/qrcode-generator.js');
  const url = surveyQrUrl(token, current), qr = qrcode(0, 'M');
  qr.addData(url, 'Byte'); qr.make();
  const count = qr.getModuleCount(), quiet = 4, scale = 8;
  canvas.width = canvas.height = (count + quiet * 2) * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('이 브라우저에서 QR 이미지를 만들 수 없습니다.');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) {
    if (qr.isDark(row, col)) context.fillRect((col + quiet) * scale, (row + quiet) * scale, scale, scale);
  }
  return url;
}

export function createSurveyQrButton({ publicToken, title }) {
  const trigger = element('button', 'QR코드', 'secondary-button'); trigger.type = 'button';
  trigger.addEventListener('click', async () => {
    if (trigger.disabled) return;
    activeDialog?.close();
    const dialog = element('dialog', '', 'risk-qr-dialog'); activeDialog = dialog;
    dialog.setAttribute('aria-labelledby', 'risk-qr-title');
    const heading = element('h2', `${title || '위험성평가'} · QR코드`); heading.id = 'risk-qr-title';
    const canvas = element('canvas'); canvas.hidden = true; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', '공개 설문으로 연결하는 QR코드');
    const link = element('a', '', 'risk-qr-url'); link.hidden = true; link.target = '_blank'; link.rel = 'noopener';
    const status = element('p', 'QR코드를 만드는 중입니다.'); status.setAttribute('role', 'status');
    const actions = element('div', '', 'risk-qr-actions');
    const download = element('button', 'PNG 다운로드', 'primary-button'); download.type = 'button'; download.disabled = true;
    const close = element('button', '닫기', 'secondary-button'); close.type = 'button'; close.addEventListener('click', () => dialog.close());
    actions.append(download, close); dialog.append(heading, canvas, link, status, actions);
    document.body.append(dialog); dialog.showModal(); trigger.disabled = true;
    let objectUrl;
    dialog.addEventListener('close', () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (activeDialog === dialog) activeDialog = null;
      dialog.remove(); trigger.disabled = false; if (trigger.isConnected) trigger.focus();
    }, { once: true });
    try {
      const url = await drawSurveyQr(canvas, publicToken);
      if (!dialog.open) return;
      canvas.hidden = link.hidden = false; link.href = url; link.textContent = url; download.disabled = false;
      status.textContent = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
        ? '로컬 주소입니다. 휴대폰의 localhost는 이 PC를 가리키지 않습니다. 운영 사이트에서 만든 QR로 휴대폰 접속을 확인하세요.'
        : '휴대폰 카메라로 스캔하면 이 설문이 열립니다.';
    } catch (error) { if (dialog.open) status.textContent = error.message || 'QR코드를 만들지 못했습니다.'; }
    download.addEventListener('click', () => {
      if (download.disabled) return; download.disabled = true;
      canvas.toBlob(blob => {
        if (!dialog.open) return;
        download.disabled = false;
        if (!blob) { status.textContent = 'PNG를 만들지 못했습니다. 다시 시도해주세요.'; return; }
        if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = URL.createObjectURL(blob);
        const anchor = element('a'); anchor.href = objectUrl; anchor.download = qrFilename(title);
        dialog.append(anchor); anchor.click(); anchor.remove();
      }, 'image/png');
    });
  });
  return trigger;
}
