#!/usr/bin/env node
// Preflight CLI. Thin layer over src/audit.js so a future `crawl`
// command can reuse the same per-page audit.
import path from 'node:path';
import { Command } from 'commander';

import { auditPage } from '../src/audit.js';
import { writeReport } from '../src/report.js';
import { printSummary } from '../src/terminal.js';
import { normalizeUrl, safeHost, timestamp, c } from '../src/util.js';

const program = new Command();

program
  .name('preflight')
  .description('Local website QA — accessibility, links, SEO, favicon, flags, screenshots.')
  .version('0.1.0');

program
  .command('check')
  .description('Audit a single URL and write an HTML report.')
  .argument('<url>', 'the page URL to audit')
  .option('--out <dir>', 'output directory for reports', 'reports')
  .option('--timeout <ms>', 'navigation timeout in milliseconds', (v) => parseInt(v, 10), 30000)
  .option('--basic-auth <user:pass>', 'HTTP basic auth credentials')
  .option('--storage-state <path>', 'Playwright storage-state JSON (saved login)')
  .action(async (rawUrl, opts) => {
    const url = normalizeUrl(rawUrl);

    // Parse --basic-auth user:pass into Playwright httpCredentials.
    let httpCredentials;
    if (opts.basicAuth) {
      const idx = opts.basicAuth.indexOf(':');
      if (idx === -1) {
        console.error(c.red('Error: --basic-auth must be in the form user:pass'));
        process.exit(2);
      }
      httpCredentials = {
        username: opts.basicAuth.slice(0, idx),
        password: opts.basicAuth.slice(idx + 1),
      };
    }

    const outDir = path.resolve(opts.out, `${safeHost(url)}-${timestamp()}`);

    console.log(c.dim(`Auditing ${url} …`));
    let audit;
    try {
      audit = await auditPage(url, {
        outDir,
        timeout: opts.timeout,
        httpCredentials,
        storageState: opts.storageState,
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

program.parseAsync(process.argv);
