// Adapts saved final data to the existing renderers. No upload, parsing or inference.
export function createSavedDocumentPreview({ createPrintSheet, fitOutputLabels, layouts, processTemplate, renderProcess, downloadWarning, downloadProcess }) {
  const element = (tag, text = '', className = '') => Object.assign(document.createElement(tag), { textContent: text, className });
  return function mount(container, doc) {
    const data = structuredClone(doc.documentData);
    const warning = doc.documentType === 'warning_label';
    if (!warning && doc.documentType !== 'process_guide') throw new Error('Unsupported saved document');
    const controls = element('div', '', 'saved-preview-controls');
    const preview = element('div', '', 'saved-document-preview');
    preview.dataset.documentType = doc.documentType;
    preview.setAttribute('aria-label', warning ? '저장된 경고표지 Preview' : '저장된 작업공정별 관리요령 Preview');
    const stage = element('div', '', 'saved-preview-stage');
    preview.append(stage);
    const button = element('button', 'PDF 저장', 'primary-button'); button.type = 'button';
    button.dataset.savedPdf = doc.documentType;
    const message = element('p'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); message.hidden = true;
    const actions = element('div', '', 'my-actions'); actions.append(button);
    container.append(controls, preview, actions, message);
    let paper; let layout; let disposed = false; let busy = false;
    function scale() {
      if (disposed || !paper || !preview.isConnected) return;
      const width = paper.offsetWidth; const height = paper.offsetHeight;
      const style = getComputedStyle(preview);
      const available = preview.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const ratio = Math.max(0, Math.min(1, available / width));
      paper.style.transform = `scale(${ratio})`;
      stage.style.width = `${width * ratio}px`; stage.style.height = `${height * ratio}px`;
    }
    const observer = new ResizeObserver(scale); observer.observe(preview);
    if (warning) {
      const label = element('label', '출력 크기'); const select = element('select'); select.dataset.savedSize = '';
      for (const [value, text] of [...Object.entries(layouts).map(([name, item]) => [name, `${name} · ${item.description}`]), ['custom', '사용자 지정']]) {
        const option = element('option', text); option.value = value; select.append(option);
      }
      label.append(select); controls.append(label);
      const custom = element('div', '', 'saved-custom-size'); custom.hidden = true;
      function dimension(text) {
        const label = element('label', text); const input = element('input'); input.type = 'number'; input.min = '1'; input.step = 'any';
        label.append(input); custom.append(label); return input;
      }
      const width = dimension('너비 (mm)'); const height = dimension('높이 (mm)'); controls.append(custom);
      controls.append(element('p', '저장 당시 출력 크기는 보관되지 않습니다. 사용할 출력 크기를 선택해주세요.', 'my-secondary'));
      function render() {
        if (busy || disposed) return;
        custom.hidden = select.value !== 'custom';
        const w = Number(width.value); const h = Number(height.value);
        layout = select.value === 'custom'
          ? (Number.isFinite(w) && Number.isFinite(h) && w >= 1 && h >= 1 ? { name: '직접 입력', pageWidth: w, pageHeight: h, columns: 1, rows: 1, count: 1, margin: 0, gap: 0 } : null)
          : { name: select.value, ...layouts[select.value] };
        message.hidden = true;
        button.disabled = !layout;
        if (!layout) { paper = null; stage.replaceChildren(); stage.style.height = '0px'; return; }
        paper = createPrintSheet(data, layout, 'screen');
        paper.style.width = `${Math.round(layout.pageWidth / 25.4 * 96)}px`;
        paper.style.height = `${Math.round(layout.pageHeight / 25.4 * 96)}px`;
        stage.replaceChildren(paper); scale();
        requestAnimationFrame(() => {
          if (disposed || !paper?.isConnected) return;
          const fit = fitOutputLabels(paper); paper.classList.toggle('content-overflow', !fit.fits);
          if (!fit.fits) { message.textContent = '이 출력 크기에는 내용이 너무 많습니다. 더 큰 출력 크기를 선택해주세요.'; message.hidden = false; }
          scale();
        });
      }
      select.addEventListener('change', render); width.addEventListener('input', render); height.addEventListener('input', render); render();
    } else {
      // Clone only the existing form markup; renderer overwrites every data field.
      // Render while detached, then remove IDs to avoid touching the active editor.
      paper = processTemplate.cloneNode(true);
      const detached = element('div'); detached.append(paper); renderProcess(data, detached);
      paper.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      stage.append(paper); scale();
    }
    document.fonts?.ready.then(() => { if (!disposed) { if (warning && paper) fitOutputLabels(paper); scale(); } });
    button.addEventListener('click', async () => {
      if (busy || disposed || button.disabled) return;
      busy = true; button.disabled = true;
      controls.querySelectorAll('select, input').forEach(input => { input.disabled = true; });
      try {
        if (warning) await downloadWarning({ data, layout: { ...layout }, button, message });
        else await downloadProcess({ preview, productName: data.productName, button, message });
      } finally {
        busy = false;
        controls.querySelectorAll('select, input').forEach(input => { input.disabled = false; });
        button.disabled = warning && !layout;
      }
    });
    return () => { disposed = true; observer.disconnect(); };
  };
}
