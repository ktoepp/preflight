// Self-contained HTML report generator. Inline CSS, no CDN, no JS deps.
import fs from 'node:fs/promises';
import path from 'node:path';
import { summarize } from './terminal.js';
import { VERSION } from './util.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

const SEVERITY_LABEL = {
  fail: 'Fail',
  critical: 'Critical',
  serious: 'Serious',
  warn: 'Warn',
  moderate: 'Moderate',
  minor: 'Minor',
  info: 'Info',
};

// Map any finding severity to one of three visual buckets.
const bucket = (sev) => {
  if (sev === 'fail' || sev === 'critical' || sev === 'serious') return 'fail';
  if (sev === 'warn' || sev === 'moderate' || sev === 'minor') return 'warn';
  return 'info';
};

// Expandable "here's the exact element" section under a finding.
function evidenceBlock(f) {
  if (!f.evidence?.length) return '';
  const items = f.evidence
    .map(
      (e) => `
      <li class="ev">
        ${e.selector ? `<code class="ev-sel">${esc(e.selector)}</code>` : ''}
        ${e.snippet ? `<pre class="ev-snippet">${esc(e.snippet)}</pre>` : ''}
        ${e.note ? `<div class="ev-note">${nl2br(e.note)}</div>` : ''}
      </li>`
    )
    .join('');
  const n = f.evidence.length;
  return `
    <details class="evidence">
      <summary>Show source (${n} item${n === 1 ? '' : 's'})</summary>
      <ul class="ev-list">${items}</ul>
    </details>`;
}

function findingRow(f) {
  const b = bucket(f.severity);
  const detail = f.detail
    ? `<pre class="detail">${nl2br(f.detail)}</pre>`
    : '';
  const fixLink = f.helpUrl
    ? ` <a class="fix-link" href="${esc(f.helpUrl)}" target="_blank" rel="noopener">How to fix ↗</a>`
    : '';
  return `
    <li class="finding finding--${b}">
      <span class="chip chip--${b}">${SEVERITY_LABEL[f.severity] || f.severity}</span>
      <div class="finding-body">
        <p class="finding-msg">${esc(f.message)}${fixLink}</p>
        ${detail}
        ${evidenceBlock(f)}
      </div>
    </li>`;
}

function screenshotSection(result) {
  const shots = result.screenshots || [];
  if (!shots.length) return '';
  const cards = shots
    .map(
      (s) => `
      <figure class="shot">
        <figcaption>${esc(s.label)} · ${s.width}×${s.height}</figcaption>
        <a href="${esc(s.path)}" target="_blank" rel="noopener">
          <img src="${esc(s.path)}" alt="${esc(s.label)} screenshot" loading="lazy">
        </a>
      </figure>`
    )
    .join('');
  return `<div class="shots">${cards}</div>`;
}

function checkSection(result) {
  const cls = result.status;
  const shots = screenshotSection(result);
  const findings = result.findings.map(findingRow).join('');
  return `
    <section class="card" id="check-${esc(result.id || '')}">
      <header class="card-head status--${cls}">
        <h2>${esc(result.title)}</h2>
        <span class="status-pill status--${cls}">${cls}</span>
      </header>
      <ul class="findings">${findings}</ul>
      ${shots}
    </section>`;
}

export async function writeReport(audit, outDir, { backHref } = {}) {
  const s = summarize(audit.results);
  const generated = new Date().toLocaleString();
  const sections = audit.results.map(checkSection).join('');
  const backLink = backHref
    ? `<a class="back" href="${esc(backHref)}">← All pages</a>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preflight report — ${esc(audit.finalUrl)}</title>
<style>
  :root {
    --bg: #f5f6f8; --surface: #ffffff; --ink: #1a1d21; --muted: #6b7280;
    --line: #e6e8ec; --pass: #16a34a; --warn: #d97706; --fail: #dc2626;
    --pass-bg: #ecfdf3; --warn-bg: #fffbeb; --fail-bg: #fef2f2; --info: #64748b;
    --radius: 14px; --shadow: 0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 960px; margin: 0 auto; padding: 40px 24px 80px; }
  a { color: inherit; }

  header.top { margin-bottom: 28px; }
  .eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: 12px; font-weight: 600; color: var(--muted); }
  h1 { font-size: 26px; margin: 4px 0 6px; word-break: break-all; }
  .meta { color: var(--muted); font-size: 13px; }

  .banner {
    display: flex; gap: 14px; flex-wrap: wrap; margin: 24px 0 8px;
  }
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
    scroll-margin-top: 20px;
  }
  .card:target { outline: 2px solid #2563eb; outline-offset: 2px; }
  .card-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; border-bottom: 1px solid var(--line);
    border-left: 4px solid var(--line);
  }
  .card-head.status--pass { border-left-color: var(--pass); }
  .card-head.status--warn { border-left-color: var(--warn); }
  .card-head.status--fail { border-left-color: var(--fail); }
  .card-head h2 { font-size: 17px; margin: 0; }

  .status-pill {
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
    padding: 4px 10px; border-radius: 999px;
  }
  .status-pill.status--pass { background: var(--pass-bg); color: var(--pass); }
  .status-pill.status--warn { background: var(--warn-bg); color: var(--warn); }
  .status-pill.status--fail { background: var(--fail-bg); color: var(--fail); }

  ul.findings { list-style: none; margin: 0; padding: 6px 0; }
  .finding { display: flex; gap: 12px; padding: 12px 20px; border-top: 1px solid var(--line); }
  .finding:first-child { border-top: none; }
  .finding-body { min-width: 0; flex: 1; }
  .finding-msg { margin: 0; }
  .chip {
    flex: none; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
    padding: 3px 8px; border-radius: 6px; height: fit-content; margin-top: 1px;
  }
  .chip--fail { background: var(--fail-bg); color: var(--fail); }
  .chip--warn { background: var(--warn-bg); color: var(--warn); }
  .chip--info { background: #f1f5f9; color: var(--info); }
  pre.detail {
    margin: 8px 0 0; padding: 10px 12px; background: #f8fafc; border: 1px solid var(--line);
    border-radius: 8px; font-size: 12px; line-height: 1.5; color: #334155;
    white-space: pre-wrap; word-break: break-word; overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .fix-link { font-size: 12px; color: #2563eb; text-decoration: none; white-space: nowrap; }
  .fix-link:hover { text-decoration: underline; }
  details.evidence { margin-top: 8px; }
  details.evidence summary {
    cursor: pointer; font-size: 12px; font-weight: 600; color: #2563eb;
    user-select: none; list-style-position: inside;
  }
  details.evidence summary:hover { text-decoration: underline; }
  ul.ev-list { list-style: none; margin: 8px 0 0; padding: 0; }
  li.ev {
    padding: 10px 12px; margin-top: 6px; background: #f8fafc;
    border: 1px solid var(--line); border-radius: 8px;
  }
  code.ev-sel {
    display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 6px;
    background: #eef2ff; color: #4338ca; margin-bottom: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    word-break: break-all;
  }
  pre.ev-snippet {
    margin: 0; font-size: 12px; line-height: 1.5; color: #334155;
    white-space: pre-wrap; word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .ev-note { font-size: 12px; color: var(--muted); margin-top: 6px; }

  .shots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; padding: 18px 20px 22px; }
  .shot { margin: 0; }
  .shot figcaption { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  .shot img {
    width: 100%; height: 220px; object-fit: cover; object-position: top;
    border: 1px solid var(--line); border-radius: 10px; background: #fff; display: block;
  }
  @media (max-width: 640px) { .shots { grid-template-columns: 1fr; } .shot img { height: auto; } }

  footer { margin-top: 40px; color: var(--muted); font-size: 12px; text-align: center; }
  a.back { display: inline-block; font-size: 13px; color: var(--muted); text-decoration: none; margin-bottom: 10px; }
  a.back:hover { color: var(--ink); }
</style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      ${backLink}
      <div class="eyebrow">Preflight QA report</div>
      <h1>${esc(audit.finalUrl)}</h1>
      <div class="meta">
        HTTP ${audit.statusCode ?? 'n/a'} · ${audit.results.length} checks ·
        ${(audit.durationMs / 1000).toFixed(1)}s · generated ${esc(generated)}
        ${audit.navError ? `<br><em>Note: ${esc(audit.navError)}</em>` : ''}
      </div>
    </header>

    <div class="banner">
      <div class="stat pass"><div class="n">${s.pass}</div><div class="l">Passing</div></div>
      <div class="stat warn"><div class="n">${s.warn}</div><div class="l">Warnings</div></div>
      <div class="stat fail"><div class="n">${s.fail}</div><div class="l">Failing</div></div>
    </div>

    ${sections}

    <footer>Generated by Preflight v${VERSION} · ${esc(generated)}</footer>
  </div>
</body>
</html>`;

  const file = path.join(outDir, 'report.html');
  await fs.writeFile(file, html, 'utf8');
  return file;
}
