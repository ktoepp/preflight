# Decisions

Running log of non-obvious choices and their reasons. One entry per decision, newest last. Keep this updated whenever a decision would surprise a future reader of the code.

## 2026-07-16 — Build thin, don't fork
No OSS tool covers the full checklist (each candidate covers ~4 of 6 checks), so Preflight is a thin Node CLI orchestrating best-in-class engines (Playwright + axe-core) plus small custom checks for the gaps (default favicons, placeholder text). Full research table in [PLAN.md](PLAN.md).

## 2026-07-16 — Chromium-only by default
The full 3-browser Playwright install is ~1.2 GB — the biggest friction for eventually sharing the tool. Firefox/WebKit are opt-in flags (v0.3).

## 2026-07-16 — Crawl the rendered DOM, not raw HTML
Wix/Framer/Squarespace hydrate navigation client-side; plain-HTTP crawlers (linkinator et al.) miss it. Link discovery reads `<a href>` from the Playwright-rendered page.

## 2026-07-17 — Self-contained HTML reports, screenshots as files
`report.html` inlines all CSS/JS but references screenshots as files in `screenshots/` rather than base64 — base64 across pages × viewports would bloat the report past what email/Slack handles. Trade-off: the report folder must be shared whole (zip).

## 2026-07-17 — Resolve start-URL redirects before crawling
Apex → www redirects are near-universal on site builders. Without resolving first, every "internal" link looks cross-origin and the crawl dies at one page (bit us on katietoepp.com).

## 2026-07-17 — Bot-block statuses (999/403/429) on external links are warnings, not failures
LinkedIn answers link checkers with 999; some CDNs 403/429 automated requests while serving browsers fine. Treating those as hard failures made every page of a real site "fail". They're reported as warn with a "verify manually" note. Internal links are never excused this way.

## 2026-07-17 — Crawl seeds: sitemap first, links second; BFS; default 25-page cap
Sitemap gives the site's own inventory (and catches orphan pages); rendered-DOM links catch what the sitemap omits. BFS from the start URL keeps the most important pages inside the cap. `--max-pages` defaults to 25 — enough for typical portfolio/small-business sites without turning a mistake into a 500-page crawl.

## 2026-07-17 — One shared browser + cross-page link cache per crawl
Header/footer links repeat on every page; probing them once per crawl (Map of url → probe promise) cuts crawl time and is politer to the target. Each page still gets a fresh browser context so state doesn't leak between pages.

## 2026-07-17 — Skip robots.txt handling until the tool is shared
PLAN.md calls for robots.txt respect with an owner override. Deferred: current users audit their own sites, where the owner override would always be on. Becomes required before npm publish.

## 2026-07-17 — Per-page audits run only in Chromium; extra engines capture screenshots only (v0.3)
axe-core results, SEO tags, favicon, and link statuses don't meaningfully differ per engine — re-running all checks in Firefox/WebKit would triple crawl time for near-identical findings. Cross-browser value is rendering, so extra engines only navigate and screenshot the viewport matrix.

## 2026-07-17 — Scoping is map → review urls.txt → crawl --urls, not just filters (v0.4)
`--include`/`--exclude` path patterns exist on both commands, but the primary scoping workflow is a human review step: `preflight map` enumerates fast (no audits, one reused page, ~1s/page), writes a plain-text urls.txt, and the user deletes lines before `crawl --urls` audits the survivors. Rationale: patterns can't express "skip these 4 specific pages", and multi-engine screenshots make wasted audits expensive. Map doubles as a QA artifact — it reports orphans (in sitemap.xml, linked from nowhere) and pages missing from the sitemap.

## 2026-07-17 — No XML sitemap generation
Wix/Squarespace/Framer all generate sitemap.xml themselves; emitting one would solve a non-problem. The map output is a reviewable plain-text inventory instead.

## 2026-07-17 — Scope patterns match pathnames; bare paths are prefixes; start URL always in scope
`/work` matches `/work` and `/work/x` (segment-boundary prefix); `*` stays within a segment, `**` crosses segments. The start URL bypasses scope so a crawl can't exclude its own entry point into nothing.
