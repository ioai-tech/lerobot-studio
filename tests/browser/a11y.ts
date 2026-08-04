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

export async function expectNoBlockingA11yViolations(
  context: Element | Document = document,
  options?: RunOptions,
): Promise<AxeResults> {
  const results = await axe.run(context, options);
  const blocking = results.violations.filter((violation) =>
    BLOCKING_IMPACTS.has(violation.impact ?? ''),
  );

  expect(blocking, formatViolations(results)).toHaveLength(0);
  return results;
}
