// Screenshots — full-page captures at mobile / tablet / desktop widths.
import path from 'node:path';

const VIEWPORTS = [
  { label: 'mobile', width: 375, height: 812 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'desktop', width: 1440, height: 900 },
];

const SCREENSHOTS_DIR = 'screenshots';

// NOTE: this check resizes the viewport, so the orchestrator runs it last.
// `engine` is set on multi-browser runs so filenames/captions distinguish
// chromium/firefox/webkit captures.
export async function run({ page, outDir, engine }) {
  const findings = [];
  const shots = [];
  const prefix = engine ? `${engine}-` : '';

  for (const vp of VIEWPORTS) {
    const file = `${prefix}${vp.label}-${vp.width}x${vp.height}.png`;
    const rel = path.join(SCREENSHOTS_DIR, file);
    const abs = path.join(outDir, rel);
    const caption = engine ? `${engine} · ${vp.label}` : vp.label;
    try {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      // Let responsive layouts settle after the resize.
      await page.waitForTimeout(400);
      await page.screenshot({ path: abs, fullPage: true });
      shots.push({ ...vp, path: rel, engine, label: caption });
      findings.push({
        severity: 'info',
        message: `${caption} (${vp.width}×${vp.height}) captured.`,
      });
    } catch (err) {
      findings.push({
        severity: 'warn',
        message: `Failed to capture ${caption}: ${err.message}`,
      });
    }
  }

  return {
    id: 'screenshots',
    title: 'Screenshots',
    status: findings.some((f) => f.severity === 'warn') ? 'warn' : 'pass',
    findings,
    // Extra payload the report uses to render <img> tags.
    screenshots: shots,
  };
}
