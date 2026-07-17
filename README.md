# Preflight

A lightweight, local-first QA tool for web designers. Point it at a staging or live URL before release and it checks the things that eat QA time:

- **Accessibility / WCAG** — automated axe-core rule checks, missing alt text, contrast, landmarks
- **Responsiveness** — full-page screenshots at mobile / tablet / desktop viewports
- **Links** — broken internal and external links, redirect chains (bot-blocked externals like LinkedIn are flagged as warnings, not failures)
- **SEO basics** — titles, meta descriptions, headings, canonical, robots, sitemap, og tags
- **Release flags** — missing or default favicons, placeholder text, mixed content, console errors
- **Cross-browser rendering** — opt-in Firefox / WebKit screenshot matrix alongside Chromium (`--browsers firefox,webkit`)

Built for designers working in Figma, Framer, Wix, Squarespace, WordPress and similar — you control the published URL, not necessarily the code, so everything runs against the rendered site.

**Status:** v0.4 — single-page audits, whole-site crawls, scoped crawls (`map` → review → `crawl --urls`, or `--include`/`--exclude` patterns), and the multi-browser screenshot matrix all work. See [QUICKSTART.md](QUICKSTART.md) for CLI usage, [PLAN.md](PLAN.md) for the roadmap, and [decisions.md](decisions.md) for why things are the way they are.

## Usage

```sh
npm install
npx playwright install chromium

# Audit one page → reports/<host>-<timestamp>/report.html
node bin/preflight.js check example.com

# Crawl the whole site (sitemap.xml + rendered-DOM link discovery)
# → reports/<host>-<timestamp>/index.html with per-page drill-down
node bin/preflight.js crawl example.com --max-pages 25

# Scope it: enumerate fast (no audits), trim urls.txt, audit the survivors
node bin/preflight.js map example.com
node bin/preflight.js crawl example.com --urls reports/example.com-map-<ts>/urls.txt

# Add Firefox/WebKit to the screenshot matrix (audit checks still run in Chromium)
npx playwright install firefox webkit   # one-time, ~200 MB
node bin/preflight.js check example.com --browsers firefox,webkit
```

Options (both commands): `--out <dir>`, `--timeout <ms>`, `--browsers firefox,webkit`, `--basic-auth user:pass`, `--storage-state state.json` (for password-protected staging sites — log in once with Playwright, save the state, crawl). Exit code is non-zero when any check fails, so it slots into CI or a pre-release hook.

## Goals

1. Cut pre-release QA from hours to minutes
2. Run 100% locally — no SaaS account, no uploading client sites anywhere
3. Produce a client-ready report (shareable HTML/PDF)
4. Eventually shareable with other creators as an installable CLI/app

## License

MIT © Katie Toepp
