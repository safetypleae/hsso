import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const guidePages = [
  {
    slug: 'risk-assessment',
    title: '위험성평가 작성·의견수렴·개선조치 관리 | HSSO',
    description: '근로자 의견수렴부터 위험성평가 항목 등록, 위험도 관리, 개선조치와 완료 확인까지 HSSO에서 한 흐름으로 관리하는 방법을 안내합니다.',
    heading: '위험성평가 업무를 한 흐름으로 관리하기',
    cta: '/#risk-assessment',
  },
  {
    slug: 'msds-management',
    title: '사업장 MSDS 및 화학제품 관리 | HSSO',
    description: '화학제품 기본정보, 최신 MSDS, 구성성분, 부서별 사용·보관 현황과 법정관리 대상 유해인자 포함 여부를 관리하는 HSSO 기능을 안내합니다.',
    heading: '사업장 화학제품과 MSDS를 체계적으로 관리하기',
    cta: '/#chemicals',
  },
  {
    slug: 'msds-ledger',
    title: 'MSDS 관리대장 Excel 다운로드 | HSSO',
    description: '사업장의 부서별 MSDS 사용제품 현황을 정리하고 검색·상태·부서 조건에 따라 Excel 관리대장으로 내려받는 HSSO 기능을 안내합니다.',
    heading: '부서별 MSDS 관리대장을 Excel로 정리하기',
    cta: '/#chemicals',
  },
  {
    slug: 'ghs-label',
    title: 'MSDS 기반 GHS 경고표지 만들기 | HSSO',
    description: 'MSDS PDF에서 제품명, 그림문자, 신호어, 유해·위험문구와 예방조치문구를 확인하고 수정해 GHS 경고표지 PDF를 만드는 방법을 안내합니다.',
    heading: 'MSDS PDF로 GHS 경고표지 만들기',
    cta: '/#maker',
  },
];

test('homepage exposes the canonical and social metadata', async () => {
  const html = await read('index.html');

  assert.match(html, /<link rel="canonical" href="https:\/\/hsso\.co\.kr\/">/);
  for (const property of ['type', 'title', 'description', 'url', 'site_name']) {
    assert.match(html, new RegExp(`<meta property="og:${property}" content="[^"]+">`));
  }
  for (const name of ['card', 'title', 'description']) {
    assert.match(html, new RegExp(`<meta name="twitter:${name}" content="[^"]+">`));
  }
  assert.doesNotMatch(html, /(?:og:image|twitter:image)/);
});

test('robots allows the public site, excludes APIs, and declares the sitemap', async () => {
  const robots = await read('robots.txt');

  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/hsso\.co\.kr\/sitemap\.xml$/m);
  assert.doesNotMatch(robots, /<html/i);
});

test('sitemap contains only the five canonical public pages', async () => {
  const sitemap = await read('sitemap.xml');
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.deepEqual(locations, [
    'https://hsso.co.kr/',
    ...guidePages.map(({ slug }) => `https://hsso.co.kr/guide/${slug}/`),
  ]);
  assert.doesNotMatch(sitemap, /<lastmod>|#|\/api\/|\/survey\//);
  assert.doesNotMatch(sitemap, /<html/i);
});

test('public guides have unique indexable metadata, headings, CTAs, and internal links', async () => {
  const titles = new Set();
  const descriptions = new Set();
  const headings = new Set();

  for (const guide of guidePages) {
    const html = await read(`guide/${guide.slug}/index.html`);
    const canonical = `https://hsso.co.kr/guide/${guide.slug}/`;

    assert.match(html, new RegExp(`<title>${guide.title}</title>`));
    assert.match(html, new RegExp(`<meta name="description" content="${guide.description}">`));
    assert.match(html, /<meta name="robots" content="index,follow">/);
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical}">`));
    assert.match(html, new RegExp(`<meta property="og:url" content="${canonical}">`));
    assert.match(html, /<meta property="og:type" content="website">/);
    assert.match(html, /<meta name="twitter:card" content="summary">/);
    assert.match(html, new RegExp(`<h1>${guide.heading}</h1>`));
    assert.match(html, new RegExp(`href="${guide.cta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.match(html, /href="\/"/);
    assert.match(html, /<section class="guide-section guide-howto"[^>]+aria-labelledby="[^"]+">/);
    assert.match(html, /<h2 id="[^"]+-howto-title">HSSO 사용방법<\/h2>/);
    assert.ok((html.match(/class="guide-step"/g) || []).length >= 3, `${guide.slug} needs at least three steps`);
    assert.doesNotMatch(html, /(?:og:image|twitter:image)/);

    for (const related of guidePages.filter(({ slug }) => slug !== guide.slug)) {
      assert.match(html, new RegExp(`href="/guide/${related.slug}/"`));
    }
    titles.add(guide.title);
    descriptions.add(guide.description);
    headings.add(guide.heading);
  }

  assert.equal(titles.size, guidePages.length);
  assert.equal(descriptions.size, guidePages.length);
  assert.equal(headings.size, guidePages.length);
});

test('homepage links to every public guide and guide layout includes mobile rules', async () => {
  const [homepage, styles] = await Promise.all([read('index.html'), read('assets/guide.css')]);

  for (const { slug } of guidePages) assert.match(homepage, new RegExp(`href="/guide/${slug}/"`));
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.guide-related \{ grid-template-columns: 1fr; \}/);
  assert.match(styles, /\.guide-final-cta \{ align-items: flex-start; flex-direction: column; \}/);
  assert.match(styles, /\.guide-steps \{ grid-template-columns: 1fr; \}/);
});

test('Pages keeps public surveys functional but marks them noindex', async () => {
  const [redirects, headers, notFound] = await Promise.all([
    read('_redirects'),
    read('_headers'),
    read('404.html'),
  ]);

  assert.match(redirects, /^\/survey\/\* \/ 200$/m);
  assert.match(headers, /^\/survey\/\*\r?\n\s+X-Robots-Tag: noindex, nofollow$/m);
  assert.match(notFound, /<meta name="robots" content="noindex">/);
  assert.match(notFound, /<a href="\/">/);
});
