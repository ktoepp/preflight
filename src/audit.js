// Per-page audit orchestrator. Kept independent of the CLI so a future
// `crawl` command can call auditPage() once per discovered URL.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

import { USER_AGENT } from './util.js';
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

// Playwright engine launchers by name. Audit checks always run in chromium;
// extra engines only capture the screenshot matrix (see decisions.md).
export const ENGINES = { chromium, firefox, webkit };

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
 * @param {string[]} [opts.engines] browser engines for the screenshot matrix (default ['chromium'])
 * @param {Object<string, import('playwright').Browser>} [opts.enginePool] shared extra-engine browsers (crawl)
 * @returns {Promise<{url,finalUrl,statusCode,results,startedAt,durationMs,navError}>}
 */
export async function auditPage(url, opts = {}) {
  const { outDir, timeout = 30000, httpCredentials, storageState, linkCache } = opts;
  const engines = opts.engines?.length ? opts.engines : ['chromium'];
  const multiEngine = engines.length > 1;
  const startedAt = new Date();

  await fs.mkdir(path.join(outDir, 'screenshots'), { recursive: true });

  const ownsBrowser = !opts.browser;
  const browser = opts.browser || (await chromium.launch());
  let context;
  try {
    context = await browser.newContext({
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
    // Screenshots last — it resizes the viewport. Tag with the engine name
    // only on multi-engine runs so single-engine captions stay clean.
    const shotResult = await safeRun(screenshots, {
      ...ctx,
      engine: multiEngine ? 'chromium' : undefined,
    });

    // Extra engines: navigate and capture the same viewport matrix, merging
    // into the one screenshots result.
    for (const engine of engines.filter((e) => e !== 'chromium')) {
      const extra = await engineScreenshots(engine, finalUrl, {
        outDir,
        timeout,
        httpCredentials,
        storageState,
        pooledBrowser: opts.enginePool?.[engine],
      });
      shotResult.findings.push(...extra.findings);
      if (extra.screenshots) {
        (shotResult.screenshots ||= []).push(...extra.screenshots);
      }
      if (extra.status === 'warn' && shotResult.status === 'pass') {
        shotResult.status = 'warn';
      }
    }
    results.push(shotResult);

    return {
      url,
      finalUrl,
      statusCode: response ? response.status() : null,
      navError,
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      results,
    };
  } finally {
    // Close the browser we own, or just our context on a shared (crawl)
    // browser — even when a check or navigation throws.
    if (ownsBrowser) await browser.close().catch(() => {});
    else await context?.close().catch(() => {});
  }
}

// Navigate a non-chromium engine to the final URL and capture the viewport
// matrix. Failures (engine not installed, nav timeout) become warnings —
// they never sink the audit.
async function engineScreenshots(engine, finalUrl, opts) {
  const { outDir, timeout, httpCredentials, storageState, pooledBrowser } = opts;
  const ownsBrowser = !pooledBrowser;

  let browser;
  try {
    browser = pooledBrowser || (await ENGINES[engine].launch());
  } catch (err) {
    const hint = /executable doesn't exist/i.test(err.message)
      ? ` — run: npx playwright install ${engine}`
      : '';
    return {
      status: 'warn',
      findings: [
        { severity: 'warn', message: `${engine}: could not launch${hint}`, detail: err.message.split('\n')[0] },
      ],
    };
  }

  let context;
  try {
    context = await browser.newContext({
      viewport: DEFAULT_VIEWPORT,
      userAgent: USER_AGENT,
      ignoreHTTPSErrors: true,
      ...(httpCredentials ? { httpCredentials } : {}),
      ...(storageState ? { storageState } : {}),
    });
    const page = await context.newPage();
    // domcontentloaded is enough here — the chromium pass already validated
    // full load; this pass only needs pixels.
    await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForTimeout(600);
    return await screenshots.run({ page, outDir, engine });
  } catch (err) {
    return {
      status: 'warn',
      findings: [
        { severity: 'warn', message: `${engine}: screenshots failed — ${err.message.split('\n')[0]}` },
      ],
    };
  } finally {
    if (ownsBrowser) await browser.close().catch(() => {});
    else await context?.close().catch(() => {});
  }
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
