// Site crawl report — index.html linking to per-page reports.
// Same self-contained approach as report.js: inline CSS, no external deps.
import fs from 'node:fs/promises';
import path from 'node:path';
import { VERSION } from './util.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Check columns shown in the page table, in display order.
const CHECK_COLUMNS = [
  { id: 'a11y', label: 'A11y' },
  { id: 'links', label: 'Links' },
  { id: 'seo', label: 'SEO' },
  { id: 'favicon', label: 'Favicon' },
  { id: 'flags', label: 'Flags' },
  { id: 'screenshots', label: 'Shots' },
];

const ICON = { pass: '✓', warn: '!', fail: '✗' };

function issueCount(audit) {
  let fail = 0;
  let warn = 0;
  for (const r of audit.results) {
    for (const f of r.findings) {
      if (['fail', 'critical', 'serious'].includes(f.severity)) fail++;
      else if (['warn', 'moderate', 'minor'].includes(f.severity)) warn++;
    }
  }
  return { fail, warn };
}

function pageStatus(audit) {
  if (audit.results.some((r) => r.status === 'fail')) return 'fail';
  if (audit.results.some((r) => r.status === 'warn')) return 'warn';
  return 'pass';
}

function pageRow(page) {
  // Failed navigations leave finalUrl as about:blank — label with the
  // requested URL's path instead.
  let label;
  try {
    const u = new URL(page.finalUrl.startsWith('http') ? page.finalUrl : page.url);
    label = u.pathname + u.search || '/';
  } catch {
    label = page.url;
  }
  const overall = pageStatus(page);
  const { fail, warn } = issueCount(page);
  const href = `pages/${page.slug}/report.html`;

  // Each dot deep-links to that check's card on the page report.
  const cells = CHECK_COLUMNS.map((col) => {
    const r = page.results.find((x) => x.id === col.id);
    if (!r) return '<td class="cell">–</td>';
    return `<td class="cell"><a class="dot dot--${r.status}" href="${esc(href)}#check-${col.id}" title="${esc(col.label)}: ${r.status} — click for details">${ICON[r.status] || '?'}</a></td>`;
  }).join('');

  const issues =
    fail || warn
      ? [fail ? `${fail} fail` : '', warn ? `${warn} warn` : ''].filter(Boolean).join(', ')
      : 'clean';

  return `
    <tr class="row row--${overall}">
      <td class="page"><a href="${esc(href)}">${esc(label)}</a>
        ${page.navError ? '<span class="nav-note" title="' + esc(page.navError) + '">⚠ nav</span>' : ''}
      </td>
      <td class="http">${page.statusCode ?? '–'}</td>
      ${cells}
      <td class="issues issues--${fail ? 'fail' : warn ? 'warn' : 'pass'}">${esc(issues)}</td>
      <td class="dur">${(page.durationMs / 1000).toFixed(1)}s</td>
    </tr>`;
}

export async function writeSiteReport(crawl, outDir) {
  const generated = new Date().toLocaleString();
  const totals = { pass: 0, warn: 0, fail: 0 };
  let issueFail = 0;
  let issueWarn = 0;
  for (const p of crawl.pages) {
    totals[pageStatus(p)]++;
    const { fail, warn } = issueCount(p);
    issueFail += fail;
    issueWarn += warn;
  }

  const rows = crawl.pages.map(pageRow).join('');
  const colHead = CHECK_COLUMNS.map((c) => `<th class="cell">${esc(c.label)}</th>`).join('');

  const sitemapNote =
    crawl.mode === 'list'
      ? 'audited from a curated URL list'
      : crawl.sitemapFound
        ? `sitemap.xml found (${crawl.sitemapCount} URLs)`
        : 'no sitemap.xml — crawled from links only';
  const robotsNote = crawl.robotsBlocked
    ? ` · ${crawl.robotsBlocked} URL${crawl.robotsBlocked === 1 ? '' : 's'} skipped per robots.txt`
    : '';
  const skippedNote = crawl.skipped
    ? ` · ${crawl.skipped} discovered page${crawl.skipped === 1 ? '' : 's'} beyond the limit not audited`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preflight site report — ${esc(crawl.origin)}</title>
<style>
  :root {
    --bg: #f5f6f8; --surface: #ffffff; --ink: #1a1d21; --muted: #6b7280;
    --line: #e6e8ec; --pass: #16a34a; --warn: #d97706; --fail: #dc2626;
    --pass-bg: #ecfdf3; --warn-bg: #fffbeb; --fail-bg: #fef2f2;
    --radius: 14px; --shadow: 0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 40px 24px 80px; }
  a { color: inherit; }

  header.top { margin-bottom: 28px; }
  .eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: 12px; font-weight: 600; color: var(--muted); }
  h1 { font-size: 26px; margin: 4px 0 6px; word-break: break-all; }
  .meta { color: var(--muted); font-size: 13px; }

  .banner { display: flex; gap: 14px; flex-wrap: wrap; margin: 24px 0 8px; }
  .stat {
    flex: 1 1 150px; background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 16px 18px; box-shadow: var(--shadow);
  }
  .stat .n { font-size: 30px; font-weight: 700; line-height: 1; }
  .stat .l { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-top: 6px; }
  .stat.pass .n { color: var(--pass); } .stat.warn .n { color: var(--warn); } .stat.fail .n { color: var(--fail); }

  .card {
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
    box-shadow: var(--shadow); margin-top: 20px; overflow: hidden;
  }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 10px 12px; text-align: left; }
  thead th {
    font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted);
    border-bottom: 1px solid var(--line); background: #fafbfc;
  }
  tbody tr { border-top: 1px solid var(--line); }
  tbody tr:first-child { border-top: none; }
  td.page { max-width: 320px; overflow-wrap: anywhere; font-weight: 500; }
  td.page a { text-decoration: none; border-bottom: 1px dotted var(--muted); }
  td.page a:hover { border-bottom-style: solid; }
  .nav-note { font-size: 11px; color: var(--warn); margin-left: 6px; cursor: help; }
  td.http, td.dur { color: var(--muted); font-variant-numeric: tabular-nums; }
  th.cell, td.cell { text-align: center; width: 56px; }
  .dot {
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: 999px; font-size: 12px; font-weight: 700;
    text-decoration: none;
  }
  a.dot:hover { outline: 2px solid currentColor; outline-offset: 1px; }
  .dot--pass { background: var(--pass-bg); color: var(--pass); }
  .dot--warn { background: var(--warn-bg); color: var(--warn); }
  .dot--fail { background: var(--fail-bg); color: var(--fail); }
  td.issues { font-size: 13px; white-space: nowrap; }
  .issues--fail { color: var(--fail); } .issues--warn { color: var(--warn); } .issues--pass { color: var(--pass); }

  footer { margin-top: 40px; color: var(--muted); font-size: 12px; text-align: center; }
  @media (max-width: 720px) {
    th.cell, td.cell, td.dur { display: none; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <div class="eyebrow">Preflight site report</div>
      <h1>${esc(crawl.origin)}</h1>
      <div class="meta">
        ${crawl.pages.length} pages audited · ${(crawl.durationMs / 1000).toFixed(0)}s ·
        ${esc(sitemapNote)}${esc(robotsNote)}${esc(skippedNote)} · generated ${esc(generated)}
      </div>
    </header>

    <div class="banner">
      <div class="stat pass"><div class="n">${totals.pass}</div><div class="l">Pages passing</div></div>
      <div class="stat warn"><div class="n">${totals.warn}</div><div class="l">Pages w/ warnings</div></div>
      <div class="stat fail"><div class="n">${totals.fail}</div><div class="l">Pages failing</div></div>
      <div class="stat"><div class="n">${issueFail + issueWarn}</div><div class="l">Total findings</div></div>
    </div>

    <section class="card">
      <table>
        <thead>
          <tr>
            <th>Page</th><th>HTTP</th>${colHead}<th>Issues</th><th>Time</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>

    <footer>Generated by Preflight v${VERSION} · ${esc(generated)}</footer>
  </div>
</body>
</html>`;

  const file = path.join(outDir, 'index.html');
  await fs.writeFile(file, html, 'utf8');
  return file;
}
