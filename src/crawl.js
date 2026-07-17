// Site crawl orchestrator. Seeds from sitemap.xml + the start URL, then
// follows same-origin links discovered by the links check on each rendered
// page (JS-heavy Wix/Framer/Squarespace sites need the rendered DOM — a
// plain-HTTP crawler would miss hydrated navigation).
import path from 'node:path';
import { chromium } from 'playwright';

import { auditPage } from './audit.js';

const USER_AGENT = 'Preflight/0.2 (+https://github.com/preflight)';
const SITEMAP_TIMEOUT_MS = 10000;
const MAX_CHILD_SITEMAPS = 10;

// File extensions that are never HTML pages worth auditing.
const NON_PAGE_RE =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|json|xml|txt|pdf|zip|gz|mp4|webm|mov|mp3|wav|woff2?|ttf|otf|eot)$/i;

// Canonical form for visited-set membership: drop hash, drop default ports,
// collapse trailing slash (except root).
export function normalizePageUrl(input, base) {
  const u = new URL(input, base);
  u.hash = '';
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.href;
}

function isAuditablePage(url, origin) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.origin !== origin) return false;
  if (NON_PAGE_RE.test(u.pathname)) return false;
  return true;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SITEMAP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Follow redirects on the start URL so the crawl origin matches the site's
// canonical host. Falls back to the given URL on any error (Playwright will
// surface the real problem during the first page audit).
async function resolveStart(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SITEMAP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    return res.url || url;
  } catch {
    return url;
  } finally {
    clearTimeout(timer);
  }
}

const locsOf = (xml) =>
  [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]);

/**
 * Fetch and parse sitemap.xml (following a sitemap index one level deep).
 * Returns { urls, found } where urls are same-origin page URLs.
 */
export async function fetchSitemapUrls(origin) {
  const xml = await fetchText(`${origin}/sitemap.xml`);
  if (!xml) return { urls: [], found: false };

  let pageLocs;
  if (/<sitemapindex/i.test(xml)) {
    const children = locsOf(xml).slice(0, MAX_CHILD_SITEMAPS);
    const nested = await Promise.all(children.map(fetchText));
    pageLocs = nested.filter(Boolean).flatMap(locsOf);
  } else {
    pageLocs = locsOf(xml);
  }

  const urls = [];
  const seen = new Set();
  for (const loc of pageLocs) {
    let norm;
    try {
      norm = normalizePageUrl(loc);
    } catch {
      continue;
    }
    if (!isAuditablePage(norm, origin) || seen.has(norm)) continue;
    seen.add(norm);
    urls.push(norm);
  }
  return { urls, found: true };
}

// Short filesystem slug for a page path: '/' → 'home', '/about/team' → 'about-team'.
export function pageSlug(url, taken) {
  const { pathname } = new URL(url);
  let slug =
    pathname
      .replace(/^\/|\/$/g, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'home';
  if (taken.has(slug)) {
    let i = 2;
    while (taken.has(`${slug}-${i}`)) i++;
    slug = `${slug}-${i}`;
  }
  taken.add(slug);
  return slug;
}

/**
 * Crawl a site: audit up to maxPages same-origin pages.
 * @param {string} startUrl
 * @param {object} opts
 * @param {string} opts.outDir       run directory (page output goes in pages/<slug>/)
 * @param {number} [opts.maxPages]   audit at most this many pages (default 25)
 * @param {number} [opts.timeout]    per-page navigation timeout
 * @param {{username,password}} [opts.httpCredentials]
 * @param {string} [opts.storageState]
 * @param {(ev: object) => void} [opts.onEvent]  progress callback
 * @returns {Promise<{startUrl, origin, sitemapFound, pages, skipped, startedAt, durationMs}>}
 */
export async function crawlSite(startUrl, opts = {}) {
  const {
    outDir,
    maxPages = 25,
    timeout,
    httpCredentials,
    storageState,
    onEvent = () => {},
  } = opts;

  const startedAt = new Date();
  // Resolve redirects first (apex → www is near-universal on Wix/Squarespace/
  // Framer); otherwise every "internal" link looks cross-origin.
  const start = normalizePageUrl(await resolveStart(normalizePageUrl(startUrl)));
  const origin = new URL(start).origin;

  onEvent({ type: 'sitemap' });
  const sitemap = await fetchSitemapUrls(origin);
  onEvent({ type: 'sitemap-done', found: sitemap.found, count: sitemap.urls.length });

  // BFS queue: start URL first, then sitemap pages, then discovered links.
  const queue = [start, ...sitemap.urls.filter((u) => u !== start)];
  const enqueued = new Set(queue);
  const visited = new Set();
  const slugs = new Set();
  const linkCache = new Map();
  const pages = [];

  const browser = await chromium.launch();
  try {
    while (queue.length > 0 && pages.length < maxPages) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);

      const slug = pageSlug(url, slugs);
      const pageDir = path.join(outDir, 'pages', slug);
      onEvent({ type: 'page-start', url, index: pages.length + 1, max: maxPages });

      const audit = await auditPage(url, {
        outDir: pageDir,
        timeout,
        httpCredentials,
        storageState,
        browser,
        linkCache,
      });
      pages.push({ ...audit, slug, dir: pageDir });
      onEvent({ type: 'page-done', audit, slug });

      // Discover new same-origin pages from this page's link check.
      const linkResult = audit.results.find((r) => r.id === 'links');
      for (const l of linkResult?.internal || []) {
        if (l.status != null && l.status >= 400) continue; // broken — already flagged
        let norm;
        try {
          norm = normalizePageUrl(l.url);
        } catch {
          continue;
        }
        if (!isAuditablePage(norm, origin)) continue;
        if (visited.has(norm) || enqueued.has(norm)) continue;
        enqueued.add(norm);
        queue.push(norm);
      }
    }
  } finally {
    await browser.close();
  }

  return {
    startUrl: start,
    origin,
    sitemapFound: sitemap.found,
    sitemapCount: sitemap.urls.length,
    pages,
    skipped: queue.length, // discovered but over the page limit
    startedAt,
    durationMs: Date.now() - startedAt.getTime(),
  };
}
