// Release flags — placeholder text, mixed content, console errors.
import { statusFromFindings } from '../util.js';

const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/i,
  /dolor sit amet/i,
  /your text here/i,
  /your name here/i,
  /your (company|business|brand) (name|here)/i,
  /insert (text|content|image) here/i,
  /placeholder text/i,
  /sample text/i,
  /dummy text/i,
  /replace this text/i,
  /add your (content|text)/i,
  /coming soon/i,
];

export async function run({ page, url, consoleErrors = [], requests = [] }) {
  const findings = [];
  const isHttps = new URL(url).protocol === 'https:';

  // --- Placeholder text ---
  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  const hits = [];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const m = bodyText.match(pattern);
    if (m) hits.push(m[0]);
  }
  if (hits.length) {
    findings.push({
      severity: 'warn',
      message: `Placeholder text found: ${[...new Set(hits)].join(', ')}.`,
    });
  }

  // --- Mixed content (http subresources on an https page) ---
  if (isHttps) {
    // From the rendered DOM.
    const domMixed = await page.evaluate(() => {
      const out = [];
      const attrs = [
        ['img', 'src'],
        ['script', 'src'],
        ['iframe', 'src'],
        ['audio', 'src'],
        ['video', 'src'],
        ['source', 'src'],
        ['link[rel="stylesheet"]', 'href'],
      ];
      for (const [sel, attr] of attrs) {
        for (const el of document.querySelectorAll(sel)) {
          const v = el.getAttribute(attr);
          if (v && /^http:\/\//i.test(v)) out.push(v);
        }
      }
      return out;
    });
    // From the network log captured during load.
    const netMixed = requests.filter((r) => /^http:\/\//i.test(r));
    const allMixed = [...new Set([...domMixed, ...netMixed])];
    if (allMixed.length) {
      findings.push({
        severity: 'fail',
        message: `${allMixed.length} mixed-content (http://) subresource${allMixed.length === 1 ? '' : 's'} on an https page.`,
        detail: allMixed.slice(0, 20).join('\n'),
      });
    }
  }

  // --- Console errors collected during load ---
  if (consoleErrors.length) {
    findings.push({
      severity: 'warn',
      message: `${consoleErrors.length} console error${consoleErrors.length === 1 ? '' : 's'} during load.`,
      detail: consoleErrors.slice(0, 20).join('\n'),
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: 'info',
      message: 'No placeholder text, mixed content, or console errors detected.',
    });
  }

  return {
    id: 'flags',
    title: 'Release flags',
    status: statusFromFindings(findings),
    findings,
  };
}
