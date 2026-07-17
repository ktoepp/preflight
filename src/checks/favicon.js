// Favicon check — locates the icon, verifies it loads, hashes its bytes.
import { sha256, statusFromFindings, USER_AGENT } from '../util.js';

const REQUEST_TIMEOUT_MS = 12000;

// TODO(v0.2): populate with sha256 hashes of known platform-default favicons
// (Wix, Squarespace, Framer, WordPress template placeholders) so we can flag
// "you shipped the template's default favicon". Empty for now.
// Shape: { '<sha256hex>': 'Wix default', ... }
const KNOWN_DEFAULT_HASHES = {};

async function fetchIcon(iconUrl) {
  // An empty data: URI (e.g. href="data:,") is the classic "suppress the
  // favicon request" trick — treat it as a deliberate no-icon, not a real one.
  if (/^data:/i.test(iconUrl)) {
    const body = iconUrl.split(',')[1] || '';
    return { url: iconUrl, dataUri: true, empty: body.length === 0, ok: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(iconUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return { url: iconUrl, status: res.status, ok: false };
    const buf = Buffer.from(await res.arrayBuffer());
    return { url: iconUrl, status: res.status, ok: true, bytes: buf.length, hash: sha256(buf) };
  } catch (err) {
    return { url: iconUrl, ok: false, error: err.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function run({ page, url }) {
  const findings = [];

  // Declared icons in the DOM.
  const declared = await page.$$eval(
    'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
    (links) => links.map((l) => ({ rel: l.getAttribute('rel'), href: l.getAttribute('href') }))
  );

  // Resolve candidate icon URLs; fall back to /favicon.ico when nothing declared.
  let candidates = declared
    .map((d) => {
      try {
        return new URL(d.href, url).href;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const usedFallback = candidates.length === 0;
  if (usedFallback) {
    candidates = [new URL('/favicon.ico', url).href];
    findings.push({
      severity: 'warn',
      message: 'No <link rel="icon"> declared — falling back to /favicon.ico.',
    });
  }

  // Fetch each unique candidate.
  const unique = [...new Set(candidates)];
  const results = await Promise.all(unique.map(fetchIcon));

  const anyOk = results.some((r) => r.ok);
  for (const r of results) {
    if (r.dataUri) {
      findings.push({
        severity: 'warn',
        message: r.empty
          ? 'Favicon declared as an empty data: URI — no real icon is served.'
          : 'Favicon is an inline data: URI (cannot verify against known defaults).',
        detail: r.url.slice(0, 120),
      });
      continue;
    }
    if (!r.ok) {
      findings.push({
        severity: usedFallback ? 'fail' : 'warn',
        message: r.status
          ? `Favicon returned ${r.status} — ${r.url}`
          : `Favicon unreachable — ${r.url}`,
        detail: r.error || undefined,
      });
      continue;
    }

    // Check the hash against known platform defaults.
    const match = KNOWN_DEFAULT_HASHES[r.hash];
    if (match) {
      findings.push({
        severity: 'warn',
        message: `Favicon matches a known default (${match}) — likely not replaced.`,
        detail: `${r.url}\nsha256: ${r.hash}`,
      });
    } else {
      findings.push({
        severity: 'info',
        message: `Favicon OK — ${r.url} (${r.bytes} bytes)`,
        detail: `sha256: ${r.hash}`,
      });
    }
  }

  if (usedFallback && !anyOk) {
    // Already recorded the fail above; nothing to add.
  }

  return {
    id: 'favicon',
    title: 'Favicon',
    status: statusFromFindings(findings),
    findings,
  };
}
