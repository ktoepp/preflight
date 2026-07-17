// Site mapper — discovery only, no audits, no screenshots. Enumerates every
// same-origin page (sitemap.xml + rendered-DOM links, same sources as crawl)
// in seconds so the inventory can be reviewed/scoped before the expensive
// audit pass. Writes urls.txt for `preflight crawl --urls`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { resolveStart } from './crawl.js';
import { discoverSitemap } from './sitemap.js';
import { USER_AGENT, inScope, normalizePageUrl, isAuditablePage } from './util.js';
import { fetchRobots } from './robots.js';

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
// Hydration settle after domcontentloaded — Framer/Wix render nav client-side.
const SETTLE_MS = 800;

/**
 * Map a site: enumerate pages without auditing them.
 * @param {string} startUrl
 * @param {object} opts
 * @param {number} [opts.maxPages]   visit at most this many pages (default 200)
 * @param {number} [opts.timeout]    per-page navigation timeout (default 15000)
 * @param {object} [opts.scope]      compiled include/exclude scope (compileScope)
 * @param {{username,password}} [opts.httpCredentials]
 * @param {string} [opts.storageState]
 * @param {(ev: object) => void} [opts.onEvent]
 * @returns {Promise<{startUrl, origin, sitemapFound, sitemapCount, pages, orphans, unlisted, skipped, outOfScope, durationMs}>}
 */
export async function mapSite(startUrl, opts = {}) {
  const {
    maxPages = 200,
    timeout = 15000,
    scope,
    httpCredentials,
    storageState,
    onEvent = () => {},
  } = opts;

  const startedAt = Date.now();
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

  onEvent({ type: 'sitemap' });
  const sitemap = await discoverSitemap(origin);
  onEvent({ type: 'sitemap-done', found: sitemap.found, count: sitemap.urls.length, source: sitemap.source });
  const sitemapSet = new Set(sitemap.urls);

  let outOfScope = 0;
  const admit = (url) => {
    // The start URL is always visited, even outside the scope patterns.
    if (url === start || inScope(url, scope)) return true;
    outOfScope++;
    return false;
  };

  const queue = [start, ...sitemap.urls.filter((u) => u !== start && admit(u) && robotsAllows(u))];
  const enqueued = new Set(queue);
  const visited = new Set();
  const sources = new Map(sitemap.urls.map((u) => [u, 'sitemap']));
  sources.set(start, 'start');
  const linkedTo = new Set(); // every internal URL seen as a link target
  const pages = [];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: DEFAULT_VIEWPORT,
      userAgent: USER_AGENT,
      ignoreHTTPSErrors: true,
      ...(httpCredentials ? { httpCredentials } : {}),
      ...(storageState ? { storageState } : {}),
    });
    // One page reused across navigations — this is what keeps map fast.
    const page = await context.newPage();

    while (queue.length > 0 && pages.length < maxPages) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);
      onEvent({ type: 'page-start', url, index: pages.length + 1, max: maxPages });

      let status = null;
      let navError = null;
      let hrefs = [];
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        await page.waitForTimeout(SETTLE_MS);
        status = response ? response.status() : null;
        hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
      } catch (err) {
        navError = err.message.split('\n')[0];
      }

      const finalUrl = page.url();
      try {
        visited.add(normalizePageUrl(finalUrl)); // redirect dedupe, as in crawl
      } catch {
        // about:blank on failed navigations
      }

      // Classify links: record internal targets, enqueue in-scope new pages.
      let internalCount = 0;
      for (const href of hrefs) {
        if (!href || /^(#|mailto:|tel:|javascript:|data:)/i.test(href.trim())) continue;
        let norm;
        try {
          norm = normalizePageUrl(href.trim(), finalUrl);
        } catch {
          continue;
        }
        if (!isAuditablePage(norm, origin)) continue;
        internalCount++;
        linkedTo.add(norm);
        if (visited.has(norm) || enqueued.has(norm)) continue;
        if (!admit(norm)) continue;
        if (!robotsAllows(norm)) continue;
        if (!sources.has(norm)) sources.set(norm, 'link');
        enqueued.add(norm);
        queue.push(norm);
      }

      const entry = {
        url,
        finalUrl,
        status,
        navError,
        internalLinks: internalCount,
        source: sources.get(url) || 'link',
        inSitemap: sitemapSet.has(url),
      };
      pages.push(entry);
      onEvent({ type: 'page-done', page: entry });

      // Honor Crawl-delay between visits (capped in robots.js).
      if (robots?.crawlDelay && queue.length > 0 && pages.length < maxPages) {
        await new Promise((r) => setTimeout(r, robots.crawlDelay * 1000));
      }
    }
  } finally {
    await browser.close();
  }

  // Sitemap-vs-links insights (only meaningful when a sitemap exists).
  const orphans = sitemap.found
    ? pages.filter((p) => p.inSitemap && p.url !== start && !linkedTo.has(p.url)).map((p) => p.url)
    : [];
  const unlisted = sitemap.found
    ? pages.filter((p) => !p.inSitemap && p.url !== start).map((p) => p.url)
    : [];

  return {
    startUrl: start,
    origin,
    robotsFound: robots ? robots.found : null,
    robotsBlocked,
    sitemapFound: sitemap.found,
    sitemapSource: sitemap.source,
    sitemapCount: sitemap.urls.length,
    pages,
    orphans,
    unlisted,
    skipped: queue.filter((u) => !visited.has(u)).length,
    outOfScope,
    durationMs: Date.now() - startedAt,
  };
}

// Write the reviewable URL list consumed by `preflight crawl --urls`.
export async function writeUrlList(map, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  const lines = [
    `# Preflight site map — ${map.origin}`,
    `# ${map.pages.length} pages. Delete lines you don't want audited, then run:`,
    `#   preflight crawl ${map.origin} --urls ${path.join(outDir, 'urls.txt')}`,
    '',
    ...map.pages.filter((p) => !p.navError && (p.status == null || p.status < 400)).map((p) => p.url),
  ];
  const file = path.join(outDir, 'urls.txt');
  await fs.writeFile(file, lines.join('\n') + '\n', 'utf8');
  return file;
}
