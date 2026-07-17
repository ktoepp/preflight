// Accessibility check — runs axe-core against the rendered page.
import { AxeBuilder } from '@axe-core/playwright';
import { statusFromFindings } from '../util.js';

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor'];
// Map an axe impact to our finding severity.
const impactSeverity = (impact) =>
  impact === 'critical' || impact === 'serious' ? 'fail' : 'warn';

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

  const violations = results.violations || [];

  // Explicitly call out missing alt text — a designer's most common miss.
  const altRules = ['image-alt', 'input-image-alt', 'area-alt', 'role-img-alt'];
  const altViolations = violations.filter((v) => altRules.includes(v.id));
  const altNodeCount = altViolations.reduce((n, v) => n + v.nodes.length, 0);
  if (altNodeCount > 0) {
    findings.push({
      severity: 'fail',
      message: `Missing alt text on ${altNodeCount} element${altNodeCount === 1 ? '' : 's'}`,
      detail: altViolations
        .flatMap((v) => v.nodes.map((n) => n.target.join(' ')))
        .slice(0, 20)
        .join('\n'),
    });
  }

  // Group the remaining violations by impact.
  const byImpact = {};
  for (const v of violations) {
    const impact = v.impact || 'minor';
    (byImpact[impact] ||= []).push(v);
  }

  for (const impact of IMPACT_ORDER) {
    const group = byImpact[impact];
    if (!group || !group.length) continue;
    const nodeCount = group.reduce((n, v) => n + v.nodes.length, 0);
    findings.push({
      severity: impactSeverity(impact),
      message: `${impact}: ${group.length} rule${group.length === 1 ? '' : 's'} violated across ${nodeCount} element${nodeCount === 1 ? '' : 's'}`,
      detail: group
        .map((v) => `• [${v.id}] ${v.help} (${v.nodes.length}) — ${v.helpUrl}`)
        .join('\n'),
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
