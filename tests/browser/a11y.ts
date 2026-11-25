import axe, { type AxeResults, type RunOptions } from 'axe-core';
import { expect } from 'vitest';

const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

function formatViolations(results: AxeResults): string {
  return results.violations
    .filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''))
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n${violation.nodes
          .map(
            (node) =>
              `  ${node.target.join(' ')}: ${node.failureSummary ?? 'No failure summary'}\n  ${node.html}`,
          )
          .join('\n')}`,
    )
    .join('\n\n');
}

/**
 * Rules held back, each with its reason and when it comes back.
 *
 * - `label-content-name-mismatch` (WCAG 2.5.3): axe-core 4.14 runs it by
 *   default. The episode rows ("Select Episode 1"), their batch-trim preview
 *   ("Preview Episode 1") and the segment rows ("Segment 1, 0:00.00–0:04.00,
 *   Confirmed") are named by an `aria-label` that leaves out part of their
 *   visible text. Those names are what hosts' end-to-end tests select by, so
 *   they change in a minor release with a migration note, not in a patch;
 *   enable the rule again with that change.
 */
const HELD_BACK_RULES: RunOptions['rules'] = {
  'label-content-name-mismatch': { enabled: false },
};

export async function expectNoBlockingA11yViolations(
  context: Element | Document = document,
  options?: RunOptions,
): Promise<AxeResults> {
  const results = await axe.run(context, {
    ...options,
    rules: { ...HELD_BACK_RULES, ...options?.rules },
  });
  const blocking = results.violations.filter((violation) =>
    BLOCKING_IMPACTS.has(violation.impact ?? ''),
  );

  expect(blocking, formatViolations(results)).toHaveLength(0);
  return results;
}
