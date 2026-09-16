const element = (tag, text = '', className = '') => Object.assign(document.createElement(tag), { textContent: text, className });
const colors = ['#4056a1', '#149080', '#b05a88', '#bf731b'];

function questionCard(question, index) {
  const card = element('section', '', 'risk-stat-card');
  card.dataset.questionId = question.id;
  card.append(element('h2', `${index == null ? '' : (index + 1) + '. '}${question.title}`));
  if (question.kind === 'unsupported') { card.append(element('p', question.note)); return card; }
  card.append(element('p', `응답 ${question.answered}개`, 'risk-stat-caption'));
  if (question.dimensions) { const dimensions=element('div','','risk-stat-dimensions');dimensions.append(...question.dimensions.map(q=>questionCard(q,null)));card.append(dimensions);return card; }
  if (question.kind === 'multiple') card.append(element('p', '복수 선택 · 비율은 이 문항 응답자 기준이며 합계가 100%를 넘을 수 있습니다.', 'risk-stat-caption'));
  if (question.kind === 'score') card.append(element('p', `발생가능성 × 중대성 (1~20점) · 평균 ${question.average ?? '—'}점${question.id === 'q7' ? ' · 개선 후 예상값' : ''}`, 'risk-stat-caption'));
  if (!question.answered) { card.append(element('p', '아직 이 문항에 대한 응답이 없습니다.')); return card; }
  if (question.kind === 'text') {
    const answers = element('ol', '', 'risk-stat-text');
    for (const answer of question.answers) answers.append(element('li', answer));
    card.append(answers); return card;
  }
  const distribution = question.distribution;
  const pie = question.kind === 'choice' && distribution.length <= 4 && distribution.every(item => item.label.length <= 16);
  const chart = element('div', '', pie ? 'risk-stat-chart risk-stat-pie-layout' : 'risk-stat-chart');
  if (pie) {
    const graphic = element('div', '', 'risk-stat-pie'); let angle = 0;
    const stops = distribution.map((item, i) => { const start = angle; angle += item.count / question.answered * 360; return `${colors[i]} ${start}deg ${angle}deg`; });
    graphic.style.background = `conic-gradient(${stops.join(',')})`;
    graphic.setAttribute('aria-hidden', 'true'); chart.append(graphic);
  }
  const list = element('ul', '', 'risk-stat-distribution');
  for (const [i, item] of distribution.entries()) {
    const row = element('li');
    const label = element('div', '', 'risk-stat-label');
    if (pie) { const swatch = element('span', '', 'risk-stat-swatch'); swatch.style.backgroundColor = colors[i]; swatch.setAttribute('aria-hidden', 'true'); label.append(swatch); }
    label.append(element('span', item.label), element('strong', `${item.count}명 (${item.percent}%)`)); row.append(label);
    if (!pie) {
      const track = element('div', '', 'risk-stat-track'), bar = element('div', '', 'risk-stat-bar');
      track.setAttribute('aria-hidden', 'true'); bar.style.width = `${Math.min(100, Math.max(0, item.percent))}%`; track.append(bar); row.append(track);
    }
    list.append(row);
  }
  chart.append(list); card.append(chart); return card;
}

export function mountRiskStatistics(container, { id, back, isCurrent, loginRequired }) {
  const root = element('section', '', 'risk-statistics'); root.dataset.surveyId = id;
  const backButton = element('button', '← 설문 관리로 돌아가기', 'secondary-button'); backButton.type = 'button'; backButton.addEventListener('click', back);
  const title = element('h1', '통계 보기'); title.tabIndex = -1;
  const total = element('p', '', 'risk-stat-total'); total.setAttribute('aria-live', 'polite');
  const controls = element('div', '', 'risk-stat-controls');
  const companyLabel = element('label', '회사명'), company = element('select'); company.id='risk-stat-company';company.append(new Option('전체 회사', '')); companyLabel.append(company);
  const departmentLabel = element('label', '부서'), department = element('select'); department.id = 'risk-stat-department'; department.append(new Option('전체 부서', '')); departmentLabel.append(department);
  const reset = element('button', '전체로 초기화', 'secondary-button'); reset.type = 'button';
  const download = element('button', 'Excel 다운로드', 'primary-button'); download.type = 'button'; download.disabled = true; download.id = 'risk-stat-download';
  controls.append(companyLabel, departmentLabel, reset, download);
  const notice = element('p', '익명·부서 미등록 응답은 전체 부서에서 확인할 수 있습니다. 이전 문항은 응답 당시 정의로 별도 표시합니다.', 'risk-stat-caption');
  const status = element('p'); status.setAttribute('role', 'status');
  const retry = element('button', '다시 시도', 'secondary-button'); retry.type = 'button'; retry.hidden = true;
  const cards = element('div', '', 'risk-stat-cards');
  root.append(backButton, title, total, controls, notice, status, retry, cards); container.append(root); title.focus({ preventScroll: true });
  let disposed = false, sequence = 0, controller, exportController, appliedQuery = null, objectUrl;
  const current = () => !disposed && isCurrent();
  const base = `/api/risk-surveys/${encodeURIComponent(id)}`;
  async function load() {
    const version = ++sequence;
    controller?.abort(); exportController?.abort(); controller = new AbortController();
    appliedQuery = null; download.disabled = true; retry.hidden = true; cards.replaceChildren();
    total.textContent = '응답 수를 계산하는 중입니다.';
    status.textContent = '통계를 불러오는 중입니다.'; root.setAttribute('aria-busy', 'true');
    const query = new URLSearchParams(); if (department.value) query.set('department', department.value);
    if(company.value)query.set('company',company.value);
    try {
      const response = await fetch(`${base}/statistics?${query}`, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal });
      if (!current() || version !== sequence) return;
      if (response.status === 401) { loginRequired('통계를 확인하려면 다시 로그인해주세요.'); return; }
      const data = await response.json();
      if (!current() || version !== sequence) return;
      if (!response.ok || !data.ok) throw new Error(response.status === 404 ? '설문을 찾을 수 없거나 접근 권한이 없습니다.' : '통계를 불러오지 못했습니다.');
      title.textContent = `${data.survey.title} · 통계 보기`; total.textContent = `총 응답 ${data.total}개`;
      company.replaceChildren(new Option(data.survey.companyName?'전체 회사':'회사 미등록',''));for(const name of data.availableFilters.companies)company.append(new Option(name,name));company.value=data.filters.company;company.disabled=!data.availableFilters.companies.length;
      department.replaceChildren(new Option('전체 부서', ''));
      for (const name of data.availableFilters.departments) department.append(new Option(name, name));
      department.value = data.filters.department;
      cards.replaceChildren(...data.questions.map(questionCard));
      status.textContent = data.total ? '' : '현재 조건에 해당하는 응답이 없습니다.';
      appliedQuery = query.toString(); download.disabled = false;
    } catch (error) {
      if (!current() || version !== sequence || error.name === 'AbortError') return;
      total.textContent = ''; status.textContent = error.message || '통계를 불러오지 못했습니다.'; retry.hidden = false;
    } finally { if (current() && version === sequence) root.removeAttribute('aria-busy'); }
  }
  department.addEventListener('change', load);
  company.addEventListener('change',load);
  reset.addEventListener('click', () => { department.value = ''; company.value='';load(); }); retry.addEventListener('click', load);
  download.addEventListener('click', async () => {
    if (appliedQuery === null || download.disabled) return;
    const version = sequence; download.disabled = true; exportController = new AbortController(); status.textContent = 'Excel 파일을 만드는 중입니다.';
    try {
      const response = await fetch(`${base}/responses.xlsx?${appliedQuery}`, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal: exportController.signal });
      if (!current() || version !== sequence) return;
      if (response.status === 401) { loginRequired('Excel을 다운로드하려면 다시 로그인해주세요.'); return; }
      if (!response.ok) throw new Error('Excel을 다운로드하지 못했습니다.');
      const blob = await response.blob(); if (!current() || version !== sequence) return;
      if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = URL.createObjectURL(blob);
      const link = element('a'); link.href = objectUrl;
      const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get('Content-Disposition') || '')?.[1];
      link.download = encodedName ? decodeURIComponent(encodedName) : '위험성평가_응답.xlsx';
      root.append(link); link.click(); link.remove(); status.textContent = 'Excel 파일을 다운로드했습니다.';
    } catch (error) { if (current() && version === sequence && error.name !== 'AbortError') status.textContent = error.message || 'Excel을 다운로드하지 못했습니다.'; }
    finally { if (current() && version === sequence && appliedQuery !== null) download.disabled = false; }
  });
  load();
  return () => { disposed = true; controller?.abort(); exportController?.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
}
