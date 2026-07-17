#!/usr/bin/env node
// Preflight CLI. Thin layer over src/audit.js so a future `crawl`
// command can reuse the same per-page audit.
import path from 'node:path';
import { Command } from 'commander';

import { auditPage } from '../src/audit.js';
import { crawlSite } from '../src/crawl.js';
import { writeReport } from '../src/report.js';
import { writeSiteReport } from '../src/report-site.js';
import { printSummary, printCrawlProgress, printSiteSummary, summarize } from '../src/terminal.js';
import { normalizeUrl, safeHost, timestamp, c, VERSION } from '../src/util.js';

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

    // Exit non-zero when any check failed — handy in CI / pre-release hooks.
    const anyFail = audit.results.some((r) => r.status === 'fail');
    process.exit(anyFail ? 1 : 0);
  });

program
  .command('crawl')
  .description('Crawl a whole site (sitemap + rendered-DOM links) and audit every page.')
  .argument('<url>', 'the site URL to start from')
  .option('--out <dir>', 'output directory for reports', 'reports')
  .option('--max-pages <n>', 'audit at most this many pages', (v) => parseInt(v, 10), 25)
  .option('--timeout <ms>', 'per-page navigation timeout in milliseconds', (v) => parseInt(v, 10), 30000)
  .option('--browsers <list>', 'extra screenshot engines, comma-separated: firefox,webkit')
  .option('--basic-auth <user:pass>', 'HTTP basic auth credentials')
  .option('--storage-state <path>', 'Playwright storage-state JSON (saved login)')
  .action(async (rawUrl, opts) => {
    const url = normalizeUrl(rawUrl);
    const httpCredentials = parseBasicAuth(opts.basicAuth);
    const outDir = path.resolve(opts.out, `${safeHost(url)}-${timestamp()}`);

    console.log(c.dim(`Crawling ${url} (up to ${opts.maxPages} pages) …`));
    let crawl;
    try {
      crawl = await crawlSite(url, {
        outDir,
        maxPages: opts.maxPages,
        timeout: opts.timeout,
        httpCredentials,
        storageState: opts.storageState,
        engines: parseBrowsers(opts.browsers),
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

    const anyFail = crawl.pages.some((p) => summarize(p.results).fail > 0);
    process.exit(anyFail ? 1 : 0);
  });

program.parseAsync(process.argv);
