#!/usr/bin/env node
// Preflight CLI. Thin layer over src/audit.js so a future `crawl`
// command can reuse the same per-page audit.
import path from 'node:path';
import { Command } from 'commander';

import fs from 'node:fs/promises';

import { auditPage } from '../src/audit.js';
import { crawlSite } from '../src/crawl.js';
import { mapSite, writeUrlList } from '../src/map.js';
import { writeCheckPdf, writeCrawlPdf } from '../src/pdf.js';
import { writeReport } from '../src/report.js';
import { writeSiteReport } from '../src/report-site.js';
import {
  printSummary,
  printCrawlProgress,
  printSiteSummary,
  printMapProgress,
  printMapSummary,
  summarize,
} from '../src/terminal.js';
import { normalizeUrl, safeHost, timestamp, c, VERSION, compileScope } from '../src/util.js';

const program = new Command();

// Shared --basic-auth parsing.
function parseBasicAuth(value) {
  if (!value) return undefined;
  const idx = value.indexOf(':');
  if (idx === -1) {
    console.error(c.red('Error: --basic-auth must be in the form user:pass'));
    process.exit(2);
  }
  return { username: value.slice(0, idx), password: value.slice(idx + 1) };
}

// Parse --browsers "firefox,webkit" → ['chromium', 'firefox', 'webkit'].
// Chromium is always included: it runs the audit checks; extra engines only
// capture the screenshot matrix.
const VALID_ENGINES = ['chromium', 'firefox', 'webkit'];
function parseBrowsers(value) {
  if (!value) return ['chromium'];
  const requested = value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const b of requested) {
    if (!VALID_ENGINES.includes(b)) {
      console.error(c.red(`Error: unknown browser "${b}" (valid: ${VALID_ENGINES.join(', ')})`));
      process.exit(2);
    }
  }
  return [...new Set(['chromium', ...requested])];
}

// Repeatable, comma-separable list flags: --include /work --include /blog,/about
const collectList = (value, previous = []) => [
  ...previous,
  ...value.split(',').map((s) => s.trim()).filter(Boolean),
];

// Read a urls.txt written by `preflight map` (or hand-made): one URL per
// line, blank lines and #-comments ignored.
async function readUrlList(file) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    console.error(c.red(`Error: could not read --urls file: ${err.message}`));
    process.exit(2);
  }
  const urls = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(normalizeUrl);
  if (urls.length === 0) {
    console.error(c.red(`Error: --urls file has no URLs: ${file}`));
    process.exit(2);
  }
  return urls;
}

program
  .name('preflight')
  .description('Local website QA — accessibility, links, SEO, favicon, flags, screenshots.')
  .version(VERSION);

program
  .command('check')
  .description('Audit a single URL and write an HTML report.')
  .argument('<url>', 'the page URL to audit')
  .option('--out <dir>', 'output directory for reports', 'reports')
  .option('--timeout <ms>', 'navigation timeout in milliseconds', (v) => parseInt(v, 10), 30000)
  .option('--browsers <list>', 'extra screenshot engines, comma-separated: firefox,webkit')
  .option('--pdf', 'also export the report as report.pdf')
  .option('--basic-auth <user:pass>', 'HTTP basic auth credentials')
  .option('--storage-state <path>', 'Playwright storage-state JSON (saved login)')
  .action(async (rawUrl, opts) => {
    const url = normalizeUrl(rawUrl);

    const httpCredentials = parseBasicAuth(opts.basicAuth);
    const outDir = path.resolve(opts.out, `${safeHost(url)}-${timestamp()}`);

    console.log(c.dim(`Auditing ${url} …`));
    let audit;
    try {
      audit = await auditPage(url, {
        outDir,
        timeout: opts.timeout,
        httpCredentials,
        storageState: opts.storageState,
        engines: parseBrowsers(opts.browsers),
      });
    } catch (err) {
      console.error(c.red(`\nAudit failed: ${err.message}`));
      process.exit(1);
    }

    const reportPath = await writeReport(audit, outDir);
    printSummary(audit, reportPath);
    if (opts.pdf) {
      console.log(c.dim('  Exporting PDF …'));
      const pdfPath = await writeCheckPdf(reportPath, outDir);
      console.log(`  ${c.bold('PDF:')}     ${c.cyan(pdfPath)}\n`);
    }

    // Exit non-zero when any check failed — handy in CI / pre-release hooks.
    const anyFail = audit.results.some((r) => r.status === 'fail');
    process.exit(anyFail ? 1 : 0);
  });

program
  .command('map')
  .description('Enumerate a site\'s pages (no audits) and write a reviewable urls.txt for crawl --urls.')
  .argument('<url>', 'the site URL to start from')
  .option('--out <dir>', 'output directory', 'reports')
  .option('--max-pages <n>', 'visit at most this many pages', (v) => parseInt(v, 10), 200)
  .option('--timeout <ms>', 'per-page navigation timeout in milliseconds', (v) => parseInt(v, 10), 15000)
  .option('--include <patterns>', 'only follow paths matching (repeatable, comma-separable, globs ok)', collectList)
  .option('--exclude <patterns>', 'skip paths matching (repeatable, comma-separable, globs ok)', collectList)
  .option('--ignore-robots', 'audit pages even if robots.txt disallows crawling (only on sites you own)')
  .option('--basic-auth <user:pass>', 'HTTP basic auth credentials')
  .option('--storage-state <path>', 'Playwright storage-state JSON (saved login)')
  .action(async (rawUrl, opts) => {
    const url = normalizeUrl(rawUrl);
    const outDir = path.resolve(opts.out, `${safeHost(url)}-map-${timestamp()}`);

    console.log(c.dim(`Mapping ${url} (up to ${opts.maxPages} pages) …`));
    let map;
    try {
      map = await mapSite(url, {
        maxPages: opts.maxPages,
        timeout: opts.timeout,
        scope: compileScope(opts.include, opts.exclude),
        ignoreRobots: opts.ignoreRobots,
        httpCredentials: parseBasicAuth(opts.basicAuth),
        storageState: opts.storageState,
        onEvent: printMapProgress,
      });
    } catch (err) {
      console.error(c.red(`\nMap failed: ${err.message}`));
      process.exit(1);
    }

    const urlsPath = await writeUrlList(map, outDir);
    printMapSummary(map, urlsPath);
    process.exit(0);
  });

program
  .command('crawl')
  .description('Crawl a whole site (sitemap + rendered-DOM links) and audit every page.')
  .argument('<url>', 'the site URL to start from')
  .option('--out <dir>', 'output directory for reports', 'reports')
  .option('--max-pages <n>', 'audit at most this many pages', (v) => parseInt(v, 10), 25)
  .option('--timeout <ms>', 'per-page navigation timeout in milliseconds', (v) => parseInt(v, 10), 30000)
  .option('--browsers <list>', 'extra screenshot engines, comma-separated: firefox,webkit')
  .option('--include <patterns>', 'only audit paths matching (repeatable, comma-separable, globs ok)', collectList)
  .option('--exclude <patterns>', 'skip paths matching (repeatable, comma-separable, globs ok)', collectList)
  .option('--urls <file>', 'audit exactly the URLs in this file (from `preflight map`); skips discovery')
  .option('--pdf', 'also export a single combined report.pdf for the whole crawl')
  .option('--ignore-robots', 'audit pages even if robots.txt disallows crawling (only on sites you own)')
  .option('--basic-auth <user:pass>', 'HTTP basic auth credentials')
  .option('--storage-state <path>', 'Playwright storage-state JSON (saved login)')
  .action(async (rawUrl, opts, cmd) => {
    const url = normalizeUrl(rawUrl);
    const httpCredentials = parseBasicAuth(opts.basicAuth);
    const outDir = path.resolve(opts.out, `${safeHost(url)}-${timestamp()}`);
    const urlList = opts.urls ? await readUrlList(opts.urls) : undefined;
    // A curated list is already scoped — audit all of it unless --max-pages
    // was given explicitly.
    if (urlList && cmd.getOptionValueSource('maxPages') === 'default') {
      opts.maxPages = urlList.length;
    }

    console.log(
      c.dim(
        urlList
          ? `Auditing ${urlList.length} URLs from ${opts.urls} …`
          : `Crawling ${url} (up to ${opts.maxPages} pages) …`
      )
    );
    let crawl;
    try {
      crawl = await crawlSite(url, {
        outDir,
        maxPages: opts.maxPages,
        timeout: opts.timeout,
        httpCredentials,
        storageState: opts.storageState,
        engines: parseBrowsers(opts.browsers),
        scope: compileScope(opts.include, opts.exclude),
        urlList,
        ignoreRobots: opts.ignoreRobots,
        onEvent: printCrawlProgress,
      });
    } catch (err) {
      console.error(c.red(`\nCrawl failed: ${err.message}`));
      process.exit(1);
    }

    // Per-page drill-down reports, then the site index.
    for (const page of crawl.pages) {
      await writeReport(page, page.dir, { backHref: '../../index.html' });
    }
    const reportPath = await writeSiteReport(crawl, outDir);
    printSiteSummary(crawl, reportPath);
    if (opts.pdf) {
      console.log(c.dim('  Exporting combined PDF …'));
      const pdfPath = await writeCrawlPdf(crawl, outDir);
      console.log(`  ${c.bold('PDF:')}     ${c.cyan(pdfPath)}\n`);
    }

    const anyFail = crawl.pages.some((p) => summarize(p.results).fail > 0);
    process.exit(anyFail ? 1 : 0);
  });

program.parseAsync(process.argv);
