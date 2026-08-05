import { describe, expect, it } from 'vitest';
import { formatErrorForDisplay } from '../src/react/components/errorDetails';

describe('error details disclosure', () => {
  const sensitivePath = '/Users/private/project/src/secret.ts';
  const error = Object.assign(new Error('Dataset failed to load'), {
    stack: `Error: Dataset failed to load\n    at openDataset (${sensitivePath}:12:3)`,
  });

  it('keeps stack traces available in development diagnostics', () => {
    const details = formatErrorForDisplay(error, true);

    expect(details).toContain(error.message);
    expect(details).toContain(sensitivePath);
  });

  it('shows only the safe message in production diagnostics', () => {
    const details = formatErrorForDisplay(error, false);

    expect(details).toBe(error.message);
    expect(details).not.toContain(sensitivePath);
    expect(details).not.toContain('openDataset');
  });
});
