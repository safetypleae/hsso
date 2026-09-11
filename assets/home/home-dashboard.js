const menuButton = document.querySelector('#portal-menu-button');
const menu = document.querySelector('#portal-menu');
const overlay = document.querySelector('#portal-overlay');
const closeButton = document.querySelector('#portal-menu-close');
const headerSession = document.querySelector('#header-session');
const recentRoot = document.querySelector('#home-recent-documents');
const dashboardRoot = document.querySelector('#home-personal-dashboard');
let menuWasOpenedBy;
let dashboardVersion = 0;

const home = document.querySelector('#home');
const portalPanels = [...home.querySelectorAll(':scope > .portal-screen')];
const portalUp = document.querySelector('#portal-page-up');
const portalDown = document.querySelector('#portal-page-down');
const portalIndicator = document.querySelector('#portal-page-indicator');
const portalDesktop = window.matchMedia('(min-width: 1001px)');
let portalPage = 0;
let portalTransitionLocked = false;

function setPortalPage(nextPage, { focus = false } = {}) {
  if (!portalDesktop.matches) return;
  const page = Math.max(0, Math.min(1, nextPage));
  if (page === portalPage || portalTransitionLocked) return;
  portalTransitionLocked = true;
  portalPage = page;
  home.classList.toggle('portal-page-two', page === 1);
  portalUp.disabled = page === 0;
  portalDown.disabled = page === 1;
  portalIndicator.textContent = `${page + 1} / 2`;
  portalPanels.forEach((panel, index) => { panel.inert = index !== page; panel.setAttribute('aria-hidden', String(index !== page)); });
  if (focus) (page ? portalUp : portalDown).focus({ preventScroll: true });
  setTimeout(() => { portalTransitionLocked = false; }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 20 : 620);
}

function resetPortalMode() {
  if (portalDesktop.matches) {
    portalPanels.forEach((panel, index) => { panel.inert = index !== portalPage; panel.setAttribute('aria-hidden', String(index !== portalPage)); });
  } else {
    home.classList.remove('portal-page-two');
    portalPage = 0;
    portalTransitionLocked = false;
    portalPanels.forEach(panel => { panel.inert = false; panel.removeAttribute('aria-hidden'); });
  }
  portalUp.disabled = portalPage === 0;
  portalDown.disabled = portalPage === 1;
  portalIndicator.textContent = `${portalPage + 1} / 2`;
}

portalUp.addEventListener('click', () => setPortalPage(0, { focus: true }));
portalDown.addEventListener('click', () => setPortalPage(1, { focus: true }));
portalDesktop.addEventListener('change', resetPortalMode);
resetPortalMode();

document.addEventListener('click', event => {
  if (!portalDesktop.matches) return;
  const aboutLink = event.target.closest('[data-home-section="home-about"]');
  if (aboutLink && !home.contains(event.target)) { setTimeout(() => setPortalPage(1), 0); return; }
  if (!home.contains(event.target)) return;
  if (event.target.closest('[data-home-tools]')) { event.preventDefault(); event.stopImmediatePropagation(); setPortalPage(1); }
  else if (aboutLink) { event.preventDefault(); event.stopImmediatePropagation(); closeMenu(false); setPortalPage(1); }
}, true);

window.addEventListener('wheel', event => {
  if (!portalDesktop.matches || home.hidden || portalTransitionLocked || Math.abs(event.deltaY) < 18) return;
  if (portalPage === 0 && event.deltaY > 0 && window.scrollY < 4) { event.preventDefault(); setPortalPage(1); }
  else if (portalPage === 1 && event.deltaY < 0 && window.scrollY < 4) { event.preventDefault(); setPortalPage(0); }
}, { passive: false });

function openMenu() {
  menuWasOpenedBy = document.activeElement;
  menu.hidden = false;
  overlay.hidden = false;
  document.body.classList.add('portal-menu-open');
  requestAnimationFrame(() => menu.setAttribute('aria-hidden', 'false'));
  menuButton.setAttribute('aria-expanded', 'true');
  closeButton.focus();
}

function closeMenu(restoreFocus = true) {
  menu.setAttribute('aria-hidden', 'true');
  menuButton.setAttribute('aria-expanded', 'false');
  overlay.hidden = true;
  document.body.classList.remove('portal-menu-open');
  setTimeout(() => { if (menu.getAttribute('aria-hidden') === 'true') menu.hidden = true; }, 230);
  if (restoreFocus && menuWasOpenedBy?.isConnected) menuWasOpenedBy.focus();
}

menuButton.addEventListener('click', openMenu);
closeButton.addEventListener('click', () => closeMenu());
overlay.addEventListener('click', () => closeMenu());
menu.addEventListener('click', event => { if (event.target.closest('a, button:not(#portal-menu-close)')) closeMenu(false); });
document.addEventListener('keydown', event => {
  if (menu.hidden) return;
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
  if (event.key !== 'Tab') return;
  const focusable = [...menu.querySelectorAll('a[href], button:not(:disabled)')];
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

menu.querySelectorAll('[data-home-my-section]').forEach(button => button.addEventListener('click', () => {
  document.querySelector('[data-view-link="mypage"]').click();
  let attempts = 0;
  const openSection = () => {
    const target = document.querySelector(`#my-nav [data-my-section="${button.dataset.homeMySection}"]`);
    if (target && !document.querySelector('#my-nav').hidden) target.click();
    else if (++attempts < 40) setTimeout(openSection, 50);
  };
  openSection();
}));

function node(tag, text, className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function empty(root, message) {
  root.replaceChildren(node('p', message, 'portal-empty'));
}

function renderRecent(documents) {
  if (!documents.length) { empty(recentRoot, '최근 사용한 양식이 없습니다.'); return; }
  const list = node('div', '', 'portal-document-list');
  const names = { warning_label: '경고표지', process_guide: '관리요령' };
  for (const doc of documents.slice(0, 4)) {
    const link = document.createElement('a'); link.href = '#mypage'; link.dataset.viewLink = 'mypage';
    link.append(node('span', names[doc.documentType] || '문서'), node('strong', doc.title), node('span', new Date(doc.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })));
    link.addEventListener('click', event => { event.preventDefault(); document.querySelector('.header-account [data-view-link="mypage"]')?.click(); });
    list.append(link);
  }
  recentRoot.replaceChildren(list);
}

function fieldList(user) {
  const list = node('dl', '', 'portal-user-fields');
  for (const [label, value] of [['회사', user.companyName], ['부서', user.departmentName], ['직급', user.position]]) {
    const wrap = document.createElement('div'); wrap.append(node('dt', label), node('dd', value || '—')); list.append(wrap);
  }
  return list;
}

function renderDashboard(user, documents, risk) {
  const wrap = node('div', '', 'portal-user-summary');
  wrap.append(node('h3', `${user.name}님`), node('p', [user.companyName, user.departmentName].filter(Boolean).join(' · ')), fieldList(user));
  const stats = node('div', '', 'portal-work-stats');
  const documentCount = Number(documents.summary.warning_label || 0) + Number(documents.summary.process_guide || 0);
  for (const [label, value] of [['저장된 문서', `${documentCount}건`], ['최근 문서', `${documents.documents.length}건`], ['진행 중 설문', risk ? `${risk.summary.active}개` : '확인 불가'], ['전체 응답', risk ? `${risk.summary.responses}건` : '확인 불가']]) {
    const item = document.createElement('div'); item.append(node('span', label), node('strong', value)); stats.append(item);
  }
  wrap.append(stats);
  if (!risk) wrap.append(node('p', '위험성평가 현황을 불러오지 못했습니다. 다른 홈 기능은 계속 사용할 수 있습니다.', 'portal-risk-unavailable'));
  dashboardRoot.replaceChildren(wrap);
}

function renderHeroMetrics(documents, risk) {
  const root = document.querySelector('#home-portal-metrics');
  const documentCount = Number(documents.summary.warning_label || 0) + Number(documents.summary.process_guide || 0);
  const values = [['최근 저장 문서', `${documentCount}건`]];
  if (risk) values.push(['진행 중 위험성평가', `${risk.summary.active}건`]);
  values.push(['안전 포인트', '준비 중']);
  root.replaceChildren();
  for (const [label, value] of values) { const item = document.createElement('span'); item.append(node('small', label), node('strong', value)); root.append(item); }
  root.hidden = false;
}

async function request(path) {
  const response = await fetch(path, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) throw Object.assign(new Error('Request failed'), { status: response.status });
  return data;
}

function renderBoardWidget(selector, type, posts) {
  document.querySelectorAll(selector).forEach(widget => {
    [...widget.children].filter(child => child.tagName !== 'HEADER').forEach(child => child.remove());
    if (!posts.length) { widget.append(node('p', type === 'notice' ? '등록된 공지사항이 없습니다.' : '등록된 게시글이 없습니다.', 'portal-empty')); return; }
    const list = node('ul', '', 'portal-board-list');
    for (const post of posts.slice(0, 4)) {
      const item = document.createElement('li'), open = node('button', post.title); open.type = 'button';
      open.addEventListener('click', () => document.querySelector(`[data-board-open="${type}"]`)?.click());
      item.append(open, node('time', new Date(post.createdAt).toLocaleDateString('ko-KR', { timeZone:'Asia/Seoul' }))); list.append(item);
    }
    widget.append(list);
  });
}

async function refreshHomeBoards() {
  const [notices, freePosts] = await Promise.all([
    request('/api/boards?type=notice&limit=4&offset=0').catch(() => null),
    request('/api/boards?type=free&limit=4&offset=0').catch(() => null)
  ]);
  if (notices) renderBoardWidget('[data-board="notice"]', 'notice', notices.posts);
  if (freePosts) renderBoardWidget('[data-board="community"]', 'free', freePosts.posts);
}

async function refreshHomeDashboard() {
  const version = ++dashboardVersion;
  let session;
  try { session = await request('/api/auth/me'); }
  catch { if (version === dashboardVersion) { empty(recentRoot, '로그인하면 최근 사용 양식을 확인할 수 있습니다.'); dashboardRoot.replaceChildren(node('p', '로그인하면 개인 대시보드를 사용할 수 있습니다.', 'portal-empty')); } return; }
  if (version !== dashboardVersion) return;
  const user = session.user;
  document.querySelector('#home-welcome').textContent = `${user.name}님, 오늘도 안전한 하루 보내세요.`;
  document.querySelector('#header-user-name').textContent = user.name;
  document.querySelector('#header-user-org').textContent = [user.companyName, user.departmentName].filter(Boolean).join(' · ');
  const documentsPromise = request('/api/documents?period=90&limit=5');
  const riskPromise = request('/api/risk-surveys').catch(() => null);
  let documents;
  try { documents = await documentsPromise; }
  catch { if (version === dashboardVersion) { empty(recentRoot, '최근 사용 양식을 불러오지 못했습니다.'); empty(dashboardRoot, '개인 업무 정보를 불러오지 못했습니다.'); } return; }
  const risk = await riskPromise;
  if (version !== dashboardVersion) return;
  renderRecent(documents.documents);
  renderDashboard(user, documents, risk);
  renderHeroMetrics(documents, risk);
}

const sessionObserver = new MutationObserver(() => {
  if (headerSession.hidden) {
    ++dashboardVersion;
    document.querySelector('#header-user-name').textContent = '마이페이지';
    document.querySelector('#header-user-org').textContent = '';
    document.querySelector('#home-welcome').textContent = '오늘도 안전한 하루 보내세요.';
    document.querySelector('#home-portal-metrics').hidden = true;
    empty(recentRoot, '로그인하면 최근 사용 양식을 확인할 수 있습니다.');
    dashboardRoot.replaceChildren(node('p', '로그인하면 개인 대시보드를 사용할 수 있습니다.', 'portal-empty'));
    const login = node('button', '로그인', 'portal-login-link'); login.type = 'button'; login.addEventListener('click', () => document.querySelector('#header-login').click()); dashboardRoot.append(login);
  } else refreshHomeDashboard();
});
sessionObserver.observe(headerSession, { attributes: true, attributeFilter: ['hidden'] });
refreshHomeDashboard();
refreshHomeBoards();
window.addEventListener('hsso:boards-changed', refreshHomeBoards);
