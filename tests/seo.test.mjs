import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

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

test('sitemap contains only the canonical public homepage', async () => {
  const sitemap = await read('sitemap.xml');
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.deepEqual(locations, ['https://hsso.co.kr/']);
  assert.doesNotMatch(sitemap, /<lastmod>|#|\/api\/|\/survey\//);
  assert.doesNotMatch(sitemap, /<html/i);
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
