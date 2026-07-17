// Accessibility check — runs axe-core against the rendered page.
import { AxeBuilder } from '@axe-core/playwright';
import { statusFromFindings } from '../util.js';

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor'];
// Map an axe impact to our finding severity.
const impactSeverity = (impact) =>
  impact === 'critical' || impact === 'serious' ? 'fail' : 'warn';

const MAX_EVIDENCE = 10;

export async function run({ page }) {
  const findings = [];

  let results;
  try {
    results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
  } catch (err) {
    return {
      id: 'a11y',
      title: 'Accessibility (WCAG 2.1 A/AA)',
      status: 'warn',
      findings: [{ severity: 'warn', message: `axe-core could not run: ${err.message}` }],
    };
  }

  const violations = (results.violations || []).slice().sort(
    (a, b) => IMPACT_ORDER.indexOf(a.impact || 'minor') - IMPACT_ORDER.indexOf(b.impact || 'minor')
  );

  // One finding per violated rule, carrying the offending elements as
  // evidence so the report can show exactly what to fix.
  for (const v of violations) {
    const impact = v.impact || 'minor';
    const evidence = v.nodes.slice(0, MAX_EVIDENCE).map((n) => ({
      selector: n.target.join(' '),
      snippet: n.html,
      note: n.failureSummary,
    }));
    if (v.nodes.length > MAX_EVIDENCE) {
      evidence.push({ note: `…and ${v.nodes.length - MAX_EVIDENCE} more element(s) with the same issue.` });
    }
    findings.push({
      severity: impactSeverity(impact),
      message: `[${impact}] ${v.help} — ${v.nodes.length} element${v.nodes.length === 1 ? '' : 's'}`,
      helpUrl: v.helpUrl,
      evidence,
    });
  }

  const passCount = (results.passes || []).length;
  if (findings.length === 0) {
    findings.push({
      severity: 'info',
      message: `No WCAG 2.1 A/AA violations detected (${passCount} checks passed).`,
    });
  }

  return {
    id: 'a11y',
    title: 'Accessibility (WCAG 2.1 A/AA)',
    status: statusFromFindings(findings),
    findings,
  };
}
