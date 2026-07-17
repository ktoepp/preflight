// Concise colored terminal summary of an audit.
import { c, statusColor } from './util.js';

const ICON = { pass: '✓', warn: '!', fail: '✗' };

// Count how many findings of each severity matter for the headline.
export function summarize(results) {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  for (const r of results) {
    if (r.status === 'fail') fail++;
    else if (r.status === 'warn') warn++;
    else pass++;
  }
  return { pass, warn, fail, total: results.length };
}

// One line per page during a crawl: "  [3/25] ✓ /about — clean (4.1s)"
export function printCrawlProgress(ev) {
  if (ev.type === 'sitemap') {
    process.stdout.write(c.dim('Fetching sitemap.xml … '));
  } else if (ev.type === 'sitemap-done') {
    console.log(
      ev.found ? c.dim(`found, ${ev.count} URLs`) : c.dim('not found (link discovery only)')
    );
  } else if (ev.type === 'page-start') {
    const label = new URL(ev.url).pathname || '/';
    process.stdout.write(c.gray(`  [${ev.index}/${ev.max}] `) + label + c.dim(' … '));
  } else if (ev.type === 'page-done') {
    const s = summarize(ev.audit.results);
    const color = s.fail ? c.red : s.warn ? c.yellow : c.green;
    const icon = color(ICON[s.fail ? 'fail' : s.warn ? 'warn' : 'pass']);
    const detail = s.fail || s.warn
      ? [s.fail && `${s.fail} fail`, s.warn && `${s.warn} warn`].filter(Boolean).join(', ')
      : 'clean';
    console.log(`${icon} ${color(detail)} ${c.gray(`(${(ev.audit.durationMs / 1000).toFixed(1)}s)`)}`);
  }
}

export function printSiteSummary(crawl, reportPath) {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  for (const p of crawl.pages) {
    const s = summarize(p.results);
    if (s.fail) fail++;
    else if (s.warn) warn++;
    else pass++;
  }

  console.log('');
  console.log(c.bold(`Preflight — ${crawl.origin} (${crawl.pages.length} pages)`));
  if (crawl.skipped) {
    console.log(c.gray(`  ${crawl.skipped} more page(s) discovered beyond the limit — raise --max-pages to include them.`));
  }
  const banner = [
    c.green(`${pass} pages pass`),
    c.yellow(`${warn} with warnings`),
    c.red(`${fail} failing`),
  ].join(c.gray(' · '));
  console.log(`  ${c.bold('Summary:')} ${banner} ${c.gray(`(${(crawl.durationMs / 1000).toFixed(0)}s)`)}`);
  console.log(`  ${c.bold('Report:')}  ${c.cyan(reportPath)}`);
  console.log('');
}

export function printSummary(audit, reportPath) {
  const { results, finalUrl, statusCode, durationMs, navError } = audit;
  const s = summarize(results);

  console.log('');
  console.log(c.bold(`Preflight — ${finalUrl}`));
  console.log(
    c.gray(
      `HTTP ${statusCode ?? 'n/a'} · ${results.length} checks · ${(durationMs / 1000).toFixed(1)}s`
    )
  );
  if (navError) console.log(c.yellow(`  note: ${navError}`));
  console.log('');

  for (const r of results) {
    const color = statusColor[r.status] || c.gray;
    const icon = color(ICON[r.status] || '?');
    console.log(`  ${icon} ${c.bold(r.title)} ${color(`[${r.status}]`)}`);
    // Show the meaningful findings (skip pure info lines unless it's all we have).
    const meaningful = r.findings.filter((f) => f.severity !== 'info');
    const show = meaningful.length ? meaningful : r.findings;
    for (const f of show.slice(0, 5)) {
      const fc =
        f.severity === 'fail' || f.severity === 'critical' || f.severity === 'serious'
          ? c.red
          : f.severity === 'info'
            ? c.gray
            : c.yellow;
      console.log(`      ${fc('•')} ${f.message}`);
    }
    if (show.length > 5) console.log(c.gray(`      … and ${show.length - 5} more`));
  }

  console.log('');
  const banner = [
    c.green(`${s.pass} pass`),
    c.yellow(`${s.warn} warn`),
    c.red(`${s.fail} fail`),
  ].join(c.gray(' · '));
  console.log(`  ${c.bold('Summary:')} ${banner}`);
  console.log(`  ${c.bold('Report:')}  ${c.cyan(reportPath)}`);
  console.log('');
}
