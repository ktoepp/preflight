// Site crawl orchestrator. Seeds from sitemap.xml + the start URL, then
// follows same-origin links discovered by the links check on each rendered
// page (JS-heavy Wix/Framer/Squarespace sites need the rendered DOM — a
// plain-HTTP crawler would miss hydrated navigation).
import path from 'node:path';
import { chromium } from 'playwright';

import { auditPage, ENGINES } from './audit.js';
import { USER_AGENT, inScope } from './util.js';
import { fetchRobots } from './robots.js';

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

export function isAuditablePage(url, origin) {
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
export async function resolveStart(url) {
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
 * @param {string[]} [opts.engines]  browser engines for the screenshot matrix
 * @param {object} [opts.scope]      compiled include/exclude scope (compileScope)
 * @param {string[]} [opts.urlList]  audit exactly these URLs (skips discovery)
 * @param {boolean} [opts.ignoreRobots] skip robots.txt checks (owner override)
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
  const engines = opts.engines?.length ? opts.engines : ['chromium'];
  const { scope } = opts;
  // List mode: audit exactly the given URLs — no sitemap, no discovery.
  const listMode = Boolean(opts.urlList?.length);

  const startedAt = new Date();
  // Resolve redirects first (apex → www is near-universal on Wix/Squarespace/
  // Framer); otherwise every "internal" link looks cross-origin.
  const start = normalizePageUrl(await resolveStart(normalizePageUrl(startUrl)));
  const origin = new URL(start).origin;

  // Respect robots.txt unless the owner explicitly overrides.
  const robots = opts.ignoreRobots ? null : await fetchRobots(origin);
  if (robots) {
    onEvent({ type: 'robots', found: robots.found, crawlDelay: robots.crawlDelay });
    if (robots.found && !robots.isAllowed(start)) {
      throw new Error(
        'robots.txt disallows crawling this site. If you own it, re-run with --ignore-robots.'
      );
    }
  }
  let robotsBlocked = 0;
  const robotsAllows = (url) => {
    if (!robots || robots.isAllowed(url)) return true;
    robotsBlocked++;
    return false;
  };

  let sitemap = { found: false, urls: [] };
  if (!listMode) {
    onEvent({ type: 'sitemap' });
    sitemap = await fetchSitemapUrls(origin);
    onEvent({ type: 'sitemap-done', found: sitemap.found, count: sitemap.urls.length });
  }

  // The start URL is always audited, even outside the scope patterns.
  const admit = (url) => url === start || inScope(url, scope);

  // BFS queue: start URL first, then sitemap pages, then discovered links —
  // or, in list mode, exactly the curated list.
  const queue = (listMode
    ? [...new Set(opts.urlList.map((u) => normalizePageUrl(u)))].filter(admit)
    : [start, ...sitemap.urls.filter((u) => u !== start && admit(u))]
  ).filter((u) => u === start || robotsAllows(u));
  const enqueued = new Set(queue);
  const visited = new Set();
  const slugs = new Set();
  const linkCache = new Map();
  const pages = [];

  const browser = await chromium.launch();
  // Launch one shared browser per extra engine up front — a missing engine
  // should fail the whole crawl immediately, not warn on every page.
  const enginePool = {};
  for (const engine of engines.filter((e) => e !== 'chromium')) {
    try {
      enginePool[engine] = await ENGINES[engine].launch();
    } catch (err) {
      await browser.close().catch(() => {});
      await Promise.all(Object.values(enginePool).map((b) => b.close().catch(() => {})));
      if (/executable doesn't exist/i.test(err.message)) {
        throw new Error(`${engine} is not installed — run: npx playwright install ${engine}`);
      }
      throw err;
    }
  }

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
        engines,
        enginePool,
      });
      pages.push({ ...audit, slug, dir: pageDir });
      onEvent({ type: 'page-done', audit, slug });

      // Honor Crawl-delay between page visits (capped in robots.js).
      if (robots?.crawlDelay && queue.length > 0 && pages.length < maxPages) {
        await new Promise((r) => setTimeout(r, robots.crawlDelay * 1000));
      }

      // Mark the redirect target visited too, so /old-page → / doesn't get
      // the same page audited twice under two slugs.
      try {
        visited.add(normalizePageUrl(audit.finalUrl));
      } catch {
        // about:blank etc. on failed navigations — nothing to dedupe
      }

      // Discover new same-origin pages from this page's link check
      // (skipped in list mode — the list is the whole job).
      if (listMode) continue;
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
        if (!admit(norm)) continue;
        if (!robotsAllows(norm)) continue;
        enqueued.add(norm);
        queue.push(norm);
      }
    }
  } finally {
    await browser.close();
    await Promise.all(Object.values(enginePool).map((b) => b.close().catch(() => {})));
  }

  return {
    startUrl: start,
    origin,
    mode: listMode ? 'list' : 'discover',
    robotsFound: robots ? robots.found : null,
    robotsBlocked,
    sitemapFound: sitemap.found,
    sitemapCount: sitemap.urls.length,
    pages,
    // Discovered but over the page limit (redirect-dedupe can leave visited
    // URLs in the queue — don't count those).
    skipped: queue.filter((u) => !visited.has(u)).length,
    startedAt,
    durationMs: Date.now() - startedAt.getTime(),
  };
}
