// Screenshots — full-page captures at mobile / tablet / desktop widths.
import path from 'node:path';

const VIEWPORTS = [
  { label: 'mobile', width: 375, height: 812 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'desktop', width: 1440, height: 900 },
];

const SCREENSHOTS_DIR = 'screenshots';

// NOTE: this check resizes the viewport, so the orchestrator runs it last.
export async function run({ page, outDir }) {
  const findings = [];
  const shots = [];

  for (const vp of VIEWPORTS) {
    const file = `${vp.label}-${vp.width}x${vp.height}.png`;
    const rel = path.join(SCREENSHOTS_DIR, file);
    const abs = path.join(outDir, rel);
    try {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      // Let responsive layouts settle after the resize.
      await page.waitForTimeout(400);
      await page.screenshot({ path: abs, fullPage: true });
      shots.push({ ...vp, path: rel });
      findings.push({
        severity: 'info',
        message: `${vp.label} (${vp.width}×${vp.height}) captured.`,
      });
    } catch (err) {
      findings.push({
        severity: 'warn',
        message: `Failed to capture ${vp.label}: ${err.message}`,
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
