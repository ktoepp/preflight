// SEO basics — title, meta description, headings, canonical, robots, social tags.
import { statusFromFindings } from '../util.js';

const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESC_MIN = 50;
const DESC_MAX = 160;

export async function run({ page }) {
  const findings = [];

  // Gather everything we need in one DOM pass.
  const data = await page.evaluate(() => {
    const meta = (sel) => document.querySelector(sel)?.getAttribute('content')?.trim() || null;
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({
      level: Number(h.tagName[1]),
      text: h.textContent.trim().slice(0, 80),
    }));
    return {
      title: document.title?.trim() || null,
      description: meta('meta[name="description"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null,
      robots: meta('meta[name="robots"]'),
      ogTitle: meta('meta[property="og:title"]'),
      ogImage: meta('meta[property="og:image"]'),
      twitterCard: meta('meta[name="twitter:card"]'),
      headings,
    };
  });

  // Title
  if (!data.title) {
    findings.push({ severity: 'fail', message: 'Missing <title>.' });
  } else if (data.title.length < TITLE_MIN || data.title.length > TITLE_MAX) {
    findings.push({
      severity: 'warn',
      message: `Title length ${data.title.length} chars (recommend ${TITLE_MIN}-${TITLE_MAX}).`,
      detail: data.title,
    });
  }

  // Meta description
  if (!data.description) {
    findings.push({ severity: 'warn', message: 'Missing meta description.' });
  } else if (data.description.length < DESC_MIN || data.description.length > DESC_MAX) {
    findings.push({
      severity: 'warn',
      message: `Meta description length ${data.description.length} chars (recommend ${DESC_MIN}-${DESC_MAX}).`,
      detail: data.description,
    });
  }

  // Headings — exactly one h1 + no skipped levels.
  const h1s = data.headings.filter((h) => h.level === 1);
  if (h1s.length === 0) {
    findings.push({ severity: 'fail', message: 'No <h1> on the page.' });
  } else if (h1s.length > 1) {
    findings.push({
      severity: 'warn',
      message: `${h1s.length} <h1> elements (expected exactly one).`,
      detail: h1s.map((h) => h.text).join('\n'),
    });
  }
  // Heading order — flag jumps of more than one level.
  let prev = 0;
  const skips = [];
  for (const h of data.headings) {
    if (prev && h.level > prev + 1) {
      skips.push(`h${prev} → h${h.level}: "${h.text}"`);
    }
    prev = h.level;
  }
  if (skips.length) {
    findings.push({
      severity: 'warn',
      message: `Heading order skips ${skips.length} level${skips.length === 1 ? '' : 's'}.`,
      detail: skips.join('\n'),
    });
  }

  // Canonical
  if (!data.canonical) {
    findings.push({ severity: 'warn', message: 'No canonical link.' });
  }

  // Robots — noindex is a release-day classic; treat as FAIL.
  if (data.robots && /noindex/i.test(data.robots)) {
    findings.push({
      severity: 'fail',
      message: `robots meta contains "noindex" — page is blocked from search engines.`,
      detail: data.robots,
    });
  }

  // Social / Open Graph
  const missingSocial = [];
  if (!data.ogTitle) missingSocial.push('og:title');
  if (!data.ogImage) missingSocial.push('og:image');
  if (!data.twitterCard) missingSocial.push('twitter:card');
  if (missingSocial.length) {
    findings.push({
      severity: 'warn',
      message: `Missing social tags: ${missingSocial.join(', ')}.`,
    });
  }

  if (findings.length === 0) {
    findings.push({ severity: 'info', message: 'All SEO basics present and within recommended ranges.' });
  }

  return {
    id: 'seo',
    title: 'SEO basics',
    status: statusFromFindings(findings),
    findings,
  };
}
