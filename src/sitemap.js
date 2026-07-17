// Sitemap discovery — tries the standard mechanisms in order of authority:
//   1. Sitemap: directives in robots.txt (how real crawlers find them)
//   2. /sitemap.xml
//   3. common alternates: /sitemap_index.xml (Yoast), /wp-sitemap.xml
//      (WordPress core), /sitemap-index.xml
// Memoized per origin so the crawl, the mapper, and the per-page SEO check
// all share one discovery pass per process.
import { USER_AGENT, normalizePageUrl, isAuditablePage } from './util.js';
import { fetchRobots } from './robots.js';

const FETCH_TIMEOUT_MS = 10000;
const MAX_CHILD_SITEMAPS = 10;

const FALLBACK_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml', '/sitemap-index.xml'];

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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

const locsOf = (xml) =>
  [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]);

// Fetch one sitemap URL, expanding a sitemap index one level deep.
async function fetchOneSitemap(url) {
  const xml = await fetchText(url);
  if (xml == null) return null;
  if (/<sitemapindex/i.test(xml)) {
    const children = locsOf(xml).slice(0, MAX_CHILD_SITEMAPS);
    const nested = await Promise.all(children.map(fetchText));
    return nested.filter(Boolean).flatMap(locsOf);
  }
  return locsOf(xml);
}

const sitemapCache = new Map();

/**
 * Discover a site's sitemap and return its same-origin page URLs.
 * @returns {Promise<{found: boolean, urls: string[], source: string|null}>}
 *   source is 'robots.txt' or the path that worked (e.g. '/wp-sitemap.xml').
 */
export function discoverSitemap(origin) {
  if (!sitemapCache.has(origin)) sitemapCache.set(origin, discoverUncached(origin));
  return sitemapCache.get(origin);
}

async function discoverUncached(origin) {
  // 1. robots.txt Sitemap: directives — fetch all declared, merge.
  const robots = await fetchRobots(origin);
  if (robots.sitemaps.length > 0) {
    const batches = await Promise.all(
      robots.sitemaps.slice(0, MAX_CHILD_SITEMAPS).map(fetchOneSitemap)
    );
    const locs = batches.filter(Boolean).flat();
    if (locs.length > 0) {
      return { found: true, urls: dedupe(locs, origin), source: 'robots.txt' };
    }
  }

  // 2–3. Conventional paths, first hit wins.
  for (const path of FALLBACK_PATHS) {
    const locs = await fetchOneSitemap(`${origin}${path}`);
    if (locs != null) {
      return { found: true, urls: dedupe(locs, origin), source: path };
    }
  }

  return { found: false, urls: [], source: null };
}

function dedupe(locs, origin) {
  const urls = [];
  const seen = new Set();
  for (const loc of locs) {
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
  return urls;
}
