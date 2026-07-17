# Preflight — CLI Quick Start

Pre-release QA for websites, run locally. Reports land in `reports/<host>-<timestamp>/` as self-contained HTML you can zip and send to a client.

## Setup (once)

```sh
npm install
npx playwright install chromium

# Optional, for cross-browser screenshots (~200 MB):
npx playwright install firefox webkit
```

## The three commands

### `check` — audit one page

```sh
node bin/preflight.js check example.com
```

Runs all six checks (accessibility, links, SEO, favicon, release flags, screenshots) on a single URL. Terminal summary + `report.html` with mobile/tablet/desktop screenshots.

### `crawl` — audit a whole site

```sh
node bin/preflight.js crawl example.com
node bin/preflight.js crawl example.com --max-pages 50
```

Discovers pages from `sitemap.xml` plus links on each rendered page, audits up to `--max-pages` (default 25), and writes `index.html` — a per-page status matrix that drills down into full per-page reports.

### `map` — scope before you audit

```sh
node bin/preflight.js map example.com
```

Discovery only — no checks, no screenshots, seconds instead of minutes. Prints every page it finds and flags:

- pages that error or 404
- **orphans** — in `sitemap.xml` but linked from nowhere
- pages linked on the site but **missing from `sitemap.xml`**

It writes `urls.txt`; delete the lines you don't care about, then audit exactly what's left:

```sh
node bin/preflight.js crawl example.com --urls reports/example.com-map-<timestamp>/urls.txt
```

## Scoping with path patterns

`--include` and `--exclude` work on both `map` and `crawl`. Repeatable or comma-separated. Bare paths match as prefixes; `*` matches within a path segment, `**` across segments.

```sh
# Only the portfolio section
node bin/preflight.js crawl example.com --include '/work/**'

# Everything except the shop and legal pages
node bin/preflight.js crawl example.com --exclude '/shop/**,/legal/**'

# Blog posts but not tag archives
node bin/preflight.js map example.com --include '/blog/**' --exclude '/blog/tag/**'
```

The start URL is always included, even outside the patterns.

## Cross-browser screenshots

```sh
node bin/preflight.js check example.com --browsers firefox,webkit
```

Adds Firefox/WebKit to the screenshot matrix (3 engines × 3 viewports = 9 shots per page). Audit checks always run in Chromium — the extra engines are for spotting rendering differences.

## Password-protected staging sites

```sh
# HTTP basic auth (Framer/Netlify-style)
node bin/preflight.js crawl staging.example.com --basic-auth user:secret

# Login-based protection (Wix/Squarespace): log in once with Playwright, save
# the session, then reuse it
npx playwright open --save-storage=state.json https://staging.example.com
node bin/preflight.js crawl staging.example.com --storage-state state.json
```

## Everything else

| Flag | Commands | Default | What it does |
|---|---|---|---|
| `--out <dir>` | all | `reports` | where report folders are created |
| `--max-pages <n>` | map, crawl | 200 / 25 | discovery/audit page cap (`--urls` mode defaults to the whole list) |
| `--timeout <ms>` | all | 15000 / 30000 | per-page navigation timeout |
| `--browsers <list>` | check, crawl | chromium | extra screenshot engines |
| `--include` / `--exclude` | map, crawl | — | path-pattern scoping |
| `--urls <file>` | crawl | — | audit exactly this list; skips discovery |

Exit code is non-zero when any check fails, so `check`/`crawl` slot straight into CI or a pre-release script.
