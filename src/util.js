// Small shared helpers — no external deps.
import crypto from 'node:crypto';

// Single place to bump the version string used in UA headers and reports.
export const VERSION = '0.3.0';
export const USER_AGENT = `Preflight/${VERSION} (+https://github.com/preflight)`;

// --- Terminal colors (minimal ANSI, respects NO_COLOR) ---
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  cyan: wrap('36'),
  gray: wrap('90'),
};

// Status → color helper for the terminal.
export const statusColor = { pass: c.green, warn: c.yellow, fail: c.red };

// sha256 hex of a Buffer/Uint8Array.
export function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// Roll findings up into a single status. A 'fail' finding => fail,
// a 'warn' finding => warn, otherwise pass.
export function statusFromFindings(findings) {
  if (findings.some((f) => f.severity === 'fail' || f.severity === 'critical' || f.severity === 'serious')) {
    return 'fail';
  }
  if (findings.some((f) => f.severity === 'warn' || f.severity === 'moderate' || f.severity === 'minor')) {
    return 'warn';
  }
  return 'pass';
}

// A safe filesystem-friendly slug for a hostname.
export function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_') || 'site';
  } catch {
    return 'site';
  }
}

// Compact ISO-ish timestamp for folder names: 2026-07-16_142530
export function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

// Normalize a user-supplied URL (add https:// if no scheme).
export function normalizeUrl(input) {
  if (!/^https?:\/\//i.test(input)) return `https://${input}`;
  return input;
}
