# Preflight

A lightweight, local-first QA tool for web designers. Point it at a staging or live URL before release and it checks the things that eat QA time:

- **Accessibility / WCAG** — automated axe-style rule checks, missing alt text, contrast, landmarks
- **Responsiveness** — screenshots and layout checks across common device viewports
- **Cross-browser rendering** — Chromium / Firefox / WebKit comparisons
- **Links** — broken internal and external links, redirect chains
- **SEO basics** — titles, meta descriptions, headings, canonical, robots, sitemap, og tags
- **Release flags** — missing or default favicons, placeholder text, mixed content, console errors

Built for designers working in Figma, Framer, Wix, Squarespace, WordPress and similar — you control the published URL, not necessarily the code, so everything runs against the rendered site.

**Status:** planning. See [PLAN.md](PLAN.md).

## Goals

1. Cut pre-release QA from hours to minutes
2. Run 100% locally — no SaaS account, no uploading client sites anywhere
3. Produce a client-ready report (shareable HTML/PDF)
4. Eventually shareable with other creators as an installable CLI/app
