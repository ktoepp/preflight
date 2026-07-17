// Link check — validates every <a href> found in the rendered DOM.
import PQueue from 'p-queue';
import { statusFromFindings, USER_AGENT } from '../util.js';

const CONCURRENCY = 5;
const REQUEST_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;
const REDIRECT_CHAIN_WARN = 2; // report chains longer than this

// Follow redirects manually so we can count the chain length.
async function probe(url, method) {
  const chain = [];
  let current = url;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(current, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), current).href;
      chain.push({ from: current, to: next, status: res.status });
      current = next;
      continue;
    }
    return { status: res.status, finalUrl: current, chain };
  }
  return { status: null, finalUrl: current, chain, tooManyRedirects: true };
}

// HEAD first (cheap); fall back to GET when HEAD is unsupported or errors.
async function checkLink(url) {
  try {
    const head = await probe(url, 'HEAD');
    if (head.status === 405 || head.status === 501 || head.status === 403) {
      return await probe(url, 'GET');
    }
    return head;
  } catch (err) {
    try {
      return await probe(url, 'GET');
    } catch (err2) {
      return { status: null, error: err2.message || String(err2) };
    }
  }
}

export async function run({ page, url, linkCache }) {
  const pageOrigin = new URL(url).origin;

  // During a crawl the same header/footer links appear on every page.
  // linkCache (Map<url, Promise<result>>) memoizes probes across pages.
  const cachedCheck = (target) => {
    if (!linkCache) return checkLink(target);
    if (!linkCache.has(target)) linkCache.set(target, checkLink(target));
    return linkCache.get(target);
  };

  // Pull every anchor from the rendered DOM, keeping its visible text so a
  // broken URL can be traced back to the link the visitor actually sees.
  const rawAnchors = await page.$$eval('a[href]', (as) =>
    as.map((a) => ({
      href: a.getAttribute('href'),
      text:
        (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60) ||
        a.getAttribute('aria-label') ||
        (a.querySelector('img') ? `[image: ${a.querySelector('img').alt || 'no alt'}]` : ''),
    }))
  );

  // Resolve to absolute http(s) URLs, dropping fragments / mailto / tel / js.
  const seen = new Set();
  const links = [];
  const anchorTexts = new Map(); // url -> Set of anchor labels
  for (const { href, text } of rawAnchors) {
    if (!href) continue;
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^(mailto:|tel:|javascript:|data:)/i.test(trimmed)) continue;
    let abs;
    try {
      abs = new URL(trimmed, url);
    } catch {
      continue;
    }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
    abs.hash = '';
    const key = abs.href;
    if (text) {
      if (!anchorTexts.has(key)) anchorTexts.set(key, new Set());
      anchorTexts.get(key).add(text);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ url: key, internal: abs.origin === pageOrigin });
  }

  // Evidence pointing back at the visible anchor(s) for a URL.
  const anchorEvidence = (url) => {
    const texts = [...(anchorTexts.get(url) || [])].slice(0, 5);
    if (!texts.length) return undefined;
    return texts.map((t) => ({ note: `found in link: “${t}”` }));
  };

  const findings = [];
  if (links.length === 0) {
    return {
      id: 'links',
      title: 'Links',
      status: 'pass',
      findings: [{ severity: 'info', message: 'No links found on the page.' }],
      internal: [],
    };
  }

  const queue = new PQueue({ concurrency: CONCURRENCY });
  const results = await Promise.all(
    links.map((link) =>
      queue.add(async () => ({ ...link, ...(await cachedCheck(link.url)) }))
    )
  );

  const isBotBlocked = (r) => !r.internal && [999, 403, 429].includes(r.status);
  const allBad = results.filter((r) => r.status && r.status >= 400);
  const broken = allBad.filter((r) => !isBotBlocked(r));
  const botBlocked = allBad.filter(isBotBlocked);
  const errored = results.filter((r) => r.status == null);
  const longChains = results.filter((r) => r.chain && r.chain.length > REDIRECT_CHAIN_WARN);
  const okCount = results.filter((r) => r.status && r.status < 400).length;

  for (const r of broken) {
    findings.push({
      severity: r.status >= 500 || r.internal ? 'fail' : 'warn',
      message: `${r.status} ${r.internal ? 'internal' : 'external'} — ${r.url}`,
      evidence: anchorEvidence(r.url),
    });
  }
  // LinkedIn (999) and some CDNs (403/429) block automated checkers while
  // serving real browsers fine — report those as warnings, not failures.
  for (const r of botBlocked) {
    findings.push({
      severity: 'warn',
      message: `${r.status} external — ${r.url} (likely bot protection; verify manually in a browser)`,
      evidence: anchorEvidence(r.url),
    });
  }
  for (const r of errored) {
    findings.push({
      severity: r.internal ? 'fail' : 'warn',
      message: `${r.tooManyRedirects ? 'redirect loop' : 'unreachable'} — ${r.url}`,
      detail: r.error || undefined,
      evidence: anchorEvidence(r.url),
    });
  }
  for (const r of longChains) {
    findings.push({
      severity: 'warn',
      message: `redirect chain of ${r.chain.length} hops — ${r.url}`,
      detail: r.chain.map((h) => `${h.status} → ${h.to}`).join('\n'),
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: 'info',
      message: `All ${okCount} link${okCount === 1 ? '' : 's'} reachable (no 4xx/5xx, no long redirect chains).`,
    });
  } else {
    findings.unshift({
      severity: 'info',
      message:
        `Checked ${results.length} links — ${okCount} ok, ${broken.length} broken, ` +
        `${botBlocked.length} bot-blocked, ${errored.length} unreachable, ${longChains.length} long redirect chains.`,
    });
  }

  return {
    id: 'links',
    title: 'Links',
    status: statusFromFindings(findings),
    findings,
    // Extra payload the crawler uses for same-origin page discovery.
    internal: results
      .filter((r) => r.internal)
      .map((r) => ({ url: r.url, status: r.status ?? null })),
  };
}
