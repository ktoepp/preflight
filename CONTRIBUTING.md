# Contributing to Preflight

Thanks for your interest! Preflight is a small, focused tool — this document explains how to work on it and what kinds of changes fit.

## Ground rules

- **Maintainer commits may land directly on `main`.** Everyone else: fork, branch, and open a pull request.
- Be kind and constructive in issues and reviews. Assume good intent; disagree with ideas, not people.
- Before building something substantial, open an issue first so we can agree on the approach — it protects your time.

## Project philosophy (read before proposing features)

These are deliberate constraints, not oversights — see [PLAN.md](PLAN.md) and [decisions.md](decisions.md) for the full rationale:

1. **Thin orchestrator.** Preflight composes best-in-class engines (Playwright, axe-core) and only hand-rolls what nobody covers (default-favicon detection, placeholder text, sitemap/robots plumbing). If a well-maintained engine does it better, we call it, not reimplement it.
2. **Local-first, no SaaS.** Nothing leaves the user's machine. No telemetry, no accounts, no uploads.
3. **Minimal dependencies.** Four runtime deps today. A new dependency needs to earn its place — prefer ~60 lines of tested code over a package (that's how robots.txt support works).
4. **Polite crawler.** robots.txt respect, identifiable user-agent, crawl-delay. Don't weaken these defaults; owner overrides must stay explicit (`--ignore-robots`).
5. **Self-contained reports.** Inline CSS, no CDNs, no JS frameworks, native HTML behaviors (`<details>`) over scripts. Reports must survive being zipped and emailed.
6. **No plugin architecture for now.** A simple async runner per URL is enough until there's a real plugin ecosystem.

## Getting set up

```sh
git clone https://github.com/ktoepp/preflight
cd preflight
npm install
npx playwright install chromium          # + firefox webkit if touching multi-browser code
```

Node ≥ 20 required. There's no build step — it's plain ESM JavaScript, no TypeScript.

## Project layout

```
bin/preflight.js      CLI (commander) — thin; real logic lives in src/
src/audit.js          per-page audit orchestrator (auditPage)
src/crawl.js          site crawl: BFS, robots, shared browser, link cache
src/map.js            discovery-only enumeration → urls.txt
src/sitemap.js        sitemap discovery chain (robots.txt directive → common paths)
src/robots.js         robots.txt parser + matcher (Google semantics)
src/checks/*.js       one module per check — see "Adding a check" below
src/report.js         per-page HTML report (+ shared CSS, print rules)
src/report-site.js    crawl index.html
src/pdf.js            --pdf export via Chromium's print engine
src/terminal.js       colored CLI output
src/util.js           shared helpers (VERSION, URL normalization, scoping)
```

## Adding or changing a check

A check module exports `run(ctx)` and returns:

```js
{
  id: 'mycheck',            // stable slug (used for report anchors + site-matrix columns)
  title: 'Human title',
  status: 'pass' | 'warn' | 'fail',   // use statusFromFindings(findings)
  findings: [{
    severity: 'fail' | 'warn' | 'info' | <axe impacts>,
    message: 'one-line, actionable',
    detail: 'optional preformatted text',
    evidence: [{ selector, snippet, note }],  // optional — powers "Show source"
    helpUrl: 'optional how-to-fix link',
  }],
}
```

Rules of thumb:

- **Every non-info finding should carry evidence** — the report's promise is that users can click through to the source of a flag.
- Never throw for a page-content problem; return findings. (The orchestrator wraps checks in `safeRun`, but a crash still degrades the report.)
- Cap evidence lists (existing checks cap at 3–10 items) so a messy page can't balloon the report.
- False positives are worse than misses: when an external service blocks bots (LinkedIn's 999), warn — don't fail.
- Wire new checks into `DOM_CHECKS` in src/audit.js and `CHECK_COLUMNS` in src/report-site.js.

## Testing your change

There's no automated test suite yet (contributions welcome!). Minimum manual verification before a PR:

```sh
node --check <changed files>
node bin/preflight.js check example.com          # single page
node bin/preflight.js crawl <a JS-heavy site> --max-pages 3
open reports/<newest>/index.html                 # eyeball the report
```

If you touched crawling/discovery, test against at least one site-builder site (Wix/Framer/Squarespace) — their client-side-rendered navigation is the whole reason Preflight uses a real browser. If you touched robots/sitemap parsing, include the mocked-fetch spot checks in your PR description (see git history for examples).

## Housekeeping that PRs are expected to include

- **decisions.md** — if your change embodies a non-obvious choice (a default, a trade-off, a rejected alternative), add a dated entry. This log is why the codebase stays legible.
- **QUICKSTART.md** — update the flag table and examples when CLI flags change.
- **PLAN.md** — only the maintainer updates milestones; don't bump these in PRs.
- **Versioning** — `VERSION` in src/util.js and `version` in package.json move together; the maintainer bumps them at merge/release time, so leave them alone in PRs.

## Commit and PR style

- Present-tense, imperative subject lines ("Add X", "Fix Y"), body explains *why*.
- One logical change per PR. Small PRs merge fast; grab-bags stall.
- PR description: what changed, why, how you verified it (commands + which site you tested against).

## Reporting bugs

Include: the exact command, the target URL (or a description of the site type if private), expected vs. actual behavior, and the terminal output. Preflight's own report folder for the run is often the most useful attachment — but scrub it if the site is a private client's.

## Security

Found a vulnerability (e.g., something that could exfiltrate storage-state credentials or execute injected page content)? Please **don't** open a public issue — email the maintainer (see package.json author) and allow a reasonable window for a fix.
