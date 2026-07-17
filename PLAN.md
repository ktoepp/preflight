# Preflight — Plan

*Drafted 2026-07-16 from a research pass over existing OSS/commercial tools. Updated 2026-07-17 (v0.4). See [decisions.md](decisions.md) for the running rationale log and [QUICKSTART.md](QUICKSTART.md) for CLI usage.*

## The decision: build (thin), don't fork

No single open-source project covers the full checklist (a11y/WCAG, broken links, SEO basics, favicon flags, responsive viewports, cross-browser rendering). The closest candidates each cover ~4 of 6:

| Candidate | Covers well | Missing |
|---|---|---|
| [SiteOne Crawler](https://github.com/janreges/siteone-crawler) (MIT, single binary) | site crawl, SEO, links, a11y, screenshots | favicon check, Firefox/WebKit, viewport comparison |
| [Unlighthouse](https://github.com/harlan-zw/unlighthouse) (MIT, 4.6k★) | site-wide Lighthouse (a11y/SEO/perf), great dashboard | Chromium-only, no link report, no favicon, no multi-browser |
| [sitespeed.io](https://www.sitespeed.io/) (plugin-based) | true cross-browser, video/screenshots, perf | thin SEO/links, heavier setup |

Every real path is a composition of 2–4 tools. Rather than fork one and fight its scope, **Preflight is a thin Node.js CLI that orchestrates best-in-class engines** — Playwright for rendering (Chromium/Firefox/WebKit + any viewport, one API), axe-core for accessibility — plus small custom checks for the gaps nobody covers (default-favicon detection, platform-aware flags).

**Notable gap we fill:** no OSS tool detects missing/*default* favicons. Wix/Squarespace/Framer templates ship placeholder favicons that freelancers forget to replace — we hard-code known default-favicon hashes for those platforms as a heuristic. Same story for placeholder text ("Lorem ipsum", template copy).

**Commercial context:** the market splits into enterprise governance suites (Silktide, Siteimprove — overkill/expensive for freelancers) and point tools (Polypane for live preview, Percy for visual regression, SortSite as the closest one-report analog but a legacy desktop app). A lightweight, local, designer-focused pre-release checker is a genuine gap — good news for eventually sharing it with other creators.

## Stack

- **Node.js CLI** (`npx preflight <url>`), Commander for args
- **Playwright** — rendering, screenshots, multi-browser. *Chromium-only by default*; Firefox/WebKit opt-in flags (full 3-browser install is ~1.2 GB — the biggest UX friction for shared users). Note: Playwright's WebKit tracks WebKit trunk, a proxy for Safari, not identical.
- **@axe-core/playwright** — WCAG 2.x rules (`wcag2a`/`wcag2aa`/`wcag21aa` tags), best-maintained a11y engine
- **Crawl**: sitemap.xml seed + same-origin `<a href>` extraction from the *rendered* DOM (Wix/Framer/Squarespace are JS-heavy; plain-HTTP crawlers miss hydrated content — this is why we don't just use linkinator)
- **Link check**: crawl-native — validate every rendered-DOM href with a concurrency-limited HEAD/GET pool (`p-queue`), reusing the authenticated session
- **Report**: `report.html` (inline CSS/JS, no external deps) + `screenshots/` folder — client-shareable, avoids base64 bloat across pages × viewports × browsers

## Checks (v1 scope)

Per page, in one Playwright pass:
1. **Accessibility** — axe-core violations grouped by impact; explicit missing-alt-text section (designers' most common miss)
2. **Links** — broken internal/external (4xx/5xx), redirect chains
3. **SEO** — title, meta description, single H1/heading order, canonical, robots meta, og/twitter tags, sitemap presence
4. **Favicon** — missing `<link rel="icon">`, 404ing icon, hash-match against known Wix/Squarespace/Framer defaults
5. **Screenshots** — mobile (375), tablet (768), desktop (1440) viewports; per extra browser engine when enabled
6. **Flags** — placeholder/lorem text, mixed content, console errors, noindex left on (the "oops it's still blocked from Google" release-day classic)

## Auth & etiquette (matters for these platforms)

- Wix/Squarespace password protection and Framer's Protected Staging (Oct 2025) block crawlers by design → support `--basic-auth user:pass` and `--storage-state state.json` (Playwright handles both simultaneously); document the "log in once, save state, crawl" flow
- Identifiable User-Agent (`Preflight/x.y`), respect robots.txt by default with an owner-override flag, conservative crawl rate, back off on 429
- Flag Framer pages that fall back to client-side-only rendering (silent SSR bailout hurts SEO)

## Milestones

- ✅ **v0.1** *(shipped 2026-07-17)* — single-page audit: `preflight check <url>` runs all 6 checks on one page, prints terminal summary, writes report.html
- ✅ **v0.2** *(shipped 2026-07-17)* — site crawl: sitemap + link discovery, page limit flag, whole-site report with per-page drill-down
- ✅ **v0.3** *(shipped 2026-07-17)* — multi-browser screenshot matrix (`--browsers firefox,webkit`; audit checks stay Chromium-only — see decisions.md), missing-engine handling
- ✅ **v0.4** *(shipped 2026-07-17)* — scoped site coverage: `preflight map` (fast discovery-only enumeration → reviewable urls.txt, orphan/unlisted-page insights), `--include`/`--exclude` path patterns on map and crawl, `crawl --urls` for curated lists. Workflow: map → review/trim urls.txt → crawl the survivors. Deliberately no XML sitemap output — site builders generate those themselves; the value is the reviewable inventory.
- ✅ **v0.5** *(shipped 2026-07-17)* — evidence drill-down: every finding carries its source (offending element's selector + HTML + axe failure summary, anchor text for broken links, placeholder-text location) as expandable blocks in the page report; axe findings are per-rule with "How to fix" links; site-report status dots deep-link to the specific check card
- **Next candidates**
  - populate `KNOWN_DEFAULT_HASHES` in the favicon check (the headline differentiator — currently an empty map)
  - report polish: client-ready branding/logo option, print/PDF-friendly styles
  - robots.txt respect + owner override (required before sharing beyond own sites)
  - `preflight ui` localhost dashboard (Unlighthouse's pattern — right step before any Electron/Tauri app)
  - npm publish for other creators; config file for per-client presets
- **Skip for v1** — plugin/message-bus architecture (sitespeed.io-style): over-engineering until there's a plugin ecosystem; a simple async runner per URL is enough
