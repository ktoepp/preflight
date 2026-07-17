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
