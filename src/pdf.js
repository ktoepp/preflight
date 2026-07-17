// PDF export — renders report HTML through Chromium's print engine
// (page.pdf), so the PDF matches the HTML report exactly and needs no
// extra dependencies. Crawls produce ONE combined document: summary +
// page matrix + every page's findings and screenshots.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

import { esc, checkSection, REPORT_CSS } from './report.js';
import { summarize } from './terminal.js';
import { VERSION } from './util.js';

// Print an HTML file to PDF. Evidence disclosures are forced open first —
// a client PDF must show the sources without anything to click.
export async function renderPdf(htmlPath, pdfPath) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      document.querySelectorAll('details').forEach((d) => (d.open = true));
    });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '10mm', right: '10mm' },
    });
  } finally {
    await browser.close();
  }
  return pdfPath;
}

// Single-page audit: the standalone report.html prints as-is.
export async function writeCheckPdf(reportHtmlPath, outDir) {
  return renderPdf(reportHtmlPath, path.join(outDir, 'report.pdf'));
}

function pageStatus(audit) {
  if (audit.results.some((r) => r.status === 'fail')) return 'fail';
  if (audit.results.some((r) => r.status === 'warn')) return 'warn';
  return 'pass';
}

function pageLabel(page) {
  try {
    const u = new URL(page.finalUrl.startsWith('http') ? page.finalUrl : page.url);
    return u.pathname + u.search || '/';
  } catch {
    return page.url;
  }
}

// Compose the combined crawl document: cover summary + matrix + one
// section per page. Written as print.html next to index.html, printed,
// then removed.
export async function writeCrawlPdf(crawl, outDir) {
  const generated = new Date().toLocaleString();
  const totals = { pass: 0, warn: 0, fail: 0 };
  for (const p of crawl.pages) totals[pageStatus(p)]++;

  const matrixRows = crawl.pages
    .map((p) => {
      const s = summarize(p.results);
      const st = pageStatus(p);
      const issues =
        s.fail || s.warn
          ? [s.fail ? `${s.fail} fail` : '', s.warn ? `${s.warn} warn` : ''].filter(Boolean).join(', ')
          : 'clean';
      return `<tr>
        <td>${esc(pageLabel(p))}</td>
        <td>${p.statusCode ?? '–'}</td>
        <td class="st st--${st}">${st}</td>
        <td>${esc(issues)}</td>
      </tr>`;
    })
    .join('');

  const pageSections = crawl.pages
    .map((p) => {
      const st = pageStatus(p);
      // Screenshot paths are relative to each page's own dir; print.html
      // sits at the run root, so prefix with pages/<slug>/.
      const sections = p.results
        .map((r) => checkSection(r, { shotBase: `pages/${p.slug}/` }))
        .join('');
      return `
      <section class="page-section">
        <header class="page-head">
          <div class="eyebrow">Page audit</div>
          <h1>${esc(pageLabel(p))}</h1>
          <div class="meta">
            ${esc(p.finalUrl)} · HTTP ${p.statusCode ?? 'n/a'} ·
            <span class="st st--${st}">${st}</span>
            ${p.navError ? `<br><em>Note: ${esc(p.navError)}</em>` : ''}
          </div>
        </header>
        ${sections}
      </section>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Preflight QA report — ${esc(crawl.origin)}</title>
<style>
${REPORT_CSS}
  table.matrix { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  table.matrix th, table.matrix td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  table.matrix th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .st { font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: .04em; }
  .st--pass { color: var(--pass); } .st--warn { color: var(--warn); } .st--fail { color: var(--fail); }
  .page-head { margin: 0 0 8px; }
  .cover { break-after: page; }
</style>
</head>
<body>
  <div class="wrap">
    <section class="cover">
      <header class="top">
        <div class="eyebrow">Preflight QA report</div>
        <h1>${esc(crawl.origin)}</h1>
        <div class="meta">${crawl.pages.length} pages audited · generated ${esc(generated)}</div>
      </header>
      <div class="banner">
        <div class="stat pass"><div class="n">${totals.pass}</div><div class="l">Pages passing</div></div>
        <div class="stat warn"><div class="n">${totals.warn}</div><div class="l">Pages w/ warnings</div></div>
        <div class="stat fail"><div class="n">${totals.fail}</div><div class="l">Pages failing</div></div>
      </div>
      <section class="card">
        <table class="matrix">
          <thead><tr><th>Page</th><th>HTTP</th><th>Status</th><th>Issues</th></tr></thead>
          <tbody>${matrixRows}</tbody>
        </table>
      </section>
    </section>
    ${pageSections}
    <footer>Generated by Preflight v${VERSION} · ${esc(generated)}</footer>
  </div>
</body>
</html>`;

  const printHtml = path.join(outDir, 'print.html');
  await fs.writeFile(printHtml, html, 'utf8');
  try {
    return await renderPdf(printHtml, path.join(outDir, 'report.pdf'));
  } finally {
    await fs.unlink(printHtml).catch(() => {});
  }
}
