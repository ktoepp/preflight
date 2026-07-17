// Per-page audit orchestrator. Kept independent of the CLI so a future
// `crawl` command can call auditPage() once per discovered URL.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import * as a11y from './checks/a11y.js';
import * as links from './checks/links.js';
import * as seo from './checks/seo.js';
import * as favicon from './checks/favicon.js';
import * as flags from './checks/flags.js';
import * as screenshots from './checks/screenshots.js';

// Checks that read the page at its default viewport. Screenshots run last
// because it mutates the viewport size.
const DOM_CHECKS = [a11y, seo, favicon, flags, links];

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const USER_AGENT = 'Preflight/0.1 (+https://github.com/preflight)';

/**
 * Audit a single URL.
 * @param {string} url
 * @param {object} opts
 * @param {string} opts.outDir     directory to write screenshots into (must exist)
 * @param {number} [opts.timeout]  navigation timeout in ms
 * @param {{username:string,password:string}} [opts.httpCredentials]
 * @param {string} [opts.storageState] path to a Playwright storage-state file
 * @param {import('playwright').Browser} [opts.browser] shared browser (crawl); caller closes it
 * @param {Map} [opts.linkCache] shared link-probe cache (crawl)
 * @returns {Promise<{url,finalUrl,statusCode,results,startedAt,durationMs,navError}>}
 */
export async function auditPage(url, opts = {}) {
  const { outDir, timeout = 30000, httpCredentials, storageState, linkCache } = opts;
  const startedAt = new Date();

  await fs.mkdir(path.join(outDir, 'screenshots'), { recursive: true });

  const ownsBrowser = !opts.browser;
  const browser = opts.browser || (await chromium.launch());
  const context = await browser.newContext({
    viewport: DEFAULT_VIEWPORT,
    userAgent: USER_AGENT,
    ignoreHTTPSErrors: true,
    ...(httpCredentials ? { httpCredentials } : {}),
    ...(storageState ? { storageState } : {}),
  });
  const page = await context.newPage();

  // Collect signals during load for the flags check.
  const consoleErrors = [];
  const requests = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  page.on('request', (req) => requests.push(req.url()));

  let response = null;
  let navError = null;
  try {
    response = await page.goto(url, { waitUntil: 'networkidle', timeout });
  } catch (err) {
    // networkidle can time out on sites with long-polling / analytics beacons.
    // Fall back to domcontentloaded so the rest of the audit still runs.
    navError = err.message;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      navError = `networkidle timed out; audited after domcontentloaded (${err.message.split('\n')[0]})`;
    } catch (err2) {
      navError = err2.message;
    }
  }

  const finalUrl = page.url();
  const ctx = { page, url: finalUrl, response, outDir, consoleErrors, requests, linkCache };

  const results = [];
  for (const check of DOM_CHECKS) {
    results.push(await safeRun(check, ctx));
  }
  // Screenshots last — it resizes the viewport.
  results.push(await safeRun(screenshots, ctx));

  if (ownsBrowser) await browser.close();
  else await context.close();

  return {
    url,
    finalUrl,
    statusCode: response ? response.status() : null,
    navError,
    startedAt,
    durationMs: Date.now() - startedAt.getTime(),
    results,
  };
}

// Never let one failing check abort the whole audit.
async function safeRun(check, ctx) {
  try {
    return await check.run(ctx);
  } catch (err) {
    return {
      id: check.run?.name || 'unknown',
      title: 'Check errored',
      status: 'warn',
      findings: [{ severity: 'warn', message: `Check crashed: ${err.message}` }],
    };
  }
}
