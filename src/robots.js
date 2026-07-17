// Minimal robots.txt support — enough to be a polite crawler without a dep.
// Semantics follow Google's documented rules: group matching by user-agent
// token, longest-path-match wins, Allow wins ties, * wildcard and $ anchor.
// `preflight check` deliberately ignores robots.txt (a single explicitly
// requested page is a user action, like opening it in a browser); crawl and
// map respect it unless --ignore-robots.
import { USER_AGENT } from './util.js';

const UA_TOKEN = 'preflight';
const FETCH_TIMEOUT_MS = 10000;
const MAX_CRAWL_DELAY_S = 10;

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasUA = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const directive = m[1].toLowerCase();
    const value = m[2].trim();

    if (directive === 'user-agent') {
      if (!lastWasUA) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasUA = true;
      continue;
    }
    lastWasUA = false;
    if (!current) continue;
    if (directive === 'disallow' || directive === 'allow') {
      current.rules.push({ allow: directive === 'allow', path: value });
    } else if (directive === 'crawl-delay') {
      const n = parseFloat(value);
      if (Number.isFinite(n) && n > 0) current.crawlDelay = Math.min(n, MAX_CRAWL_DELAY_S);
    }
  }
  return groups;
}

// Pick the most specific matching group: our own token beats *.
function selectGroup(groups) {
  let star = null;
  for (const g of groups) {
    if (g.agents.some((a) => a.includes(UA_TOKEN))) return g;
    if (!star && g.agents.includes('*')) star = g;
  }
  return star;
}

function ruleToRegex(path) {
  const anchored = path.endsWith('$');
  const p = anchored ? path.slice(0, -1) : path;
  const esc = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc}${anchored ? '$' : ''}`);
}

/**
 * Fetch and compile robots.txt for an origin.
 * Returns { found, isAllowed(url), crawlDelay, disallowsEverything }.
 * Unreachable/missing robots.txt (or a 5xx) → everything allowed, which is
 * the conventional fail-open behavior for 404; we accept it for 5xx too
 * rather than dead-ending an owner's audit.
 */
export async function fetchRobots(origin) {
  let text = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (res.ok) text = await res.text();
  } catch {
    // fail open
  } finally {
    clearTimeout(timer);
  }

  if (text == null) {
    return { found: false, isAllowed: () => true, crawlDelay: null, disallowsEverything: false };
  }

  const group = selectGroup(parseRobots(text));
  if (!group) {
    return { found: true, isAllowed: () => true, crawlDelay: null, disallowsEverything: false };
  }

  const rules = group.rules
    .filter((r) => r.path !== '') // empty Disallow means allow-all; drop it
    .map((r) => ({ ...r, re: ruleToRegex(r.path), len: r.path.length }));

  const isAllowed = (url) => {
    let target;
    try {
      const u = new URL(url);
      target = u.pathname + u.search;
    } catch {
      return false;
    }
    let best = null;
    for (const r of rules) {
      if (!r.re.test(target)) continue;
      if (!best || r.len > best.len || (r.len === best.len && r.allow && !best.allow)) {
        best = r;
      }
    }
    return best ? best.allow : true;
  };

  return {
    found: true,
    isAllowed,
    crawlDelay: group.crawlDelay,
    disallowsEverything: !isAllowed(`${origin}/`),
  };
}
