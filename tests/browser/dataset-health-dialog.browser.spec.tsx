import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import type { ValidationReport } from '@/core';
import { DatasetHealthDialog } from '@/components/DatasetHealthDialog';
import { I18nProvider } from '@/i18n/core';
import '../../src/react/index.css';

function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
      } else if (performance.now() - startedAt > timeoutMs) {
        reject(new Error('waitFor timeout'));
      } else {
        requestAnimationFrame(tick);
      }
    };
    tick();
  });
}

const report: ValidationReport = {
  hasError: true,
  hasWarning: true,
  items: [
    {
      level: 'error',
      category: 'file_structure',
      field: 'broken.json',
      current: 'missing',
      expected: 'present',
      message: 'Required file is missing',
    },
    {
      level: 'warning',
      category: 'meta_info',
      field: 'fps',
      current: '0',
      expected: 'positive number',
      message: 'Frame rate is invalid',
    },
    {
      level: 'info',
      category: 'episodes',
      field: 'episodes',
      current: '10',
      expected: '10',
      message: 'Episode count matches',
    },
  ],
};

describe('browser: dataset health dialog', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await page.viewport(1_280, 720);
    host = document.createElement('div');
    host.id = 'lerobot-root';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    host.remove();
    document.querySelectorAll('[data-slot="dialog-portal"]').forEach((node) => node.remove());
  });

  it('filters checks by clicking a summary count and restores all checks on a second click', async () => {
    root.render(
      <I18nProvider forcedLanguage="en">
        <DatasetHealthDialog open onOpenChange={() => undefined} report={report} />
      </I18nProvider>,
    );

    await waitFor(() => document.body.textContent?.includes('broken.json') ?? false);
    const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!;
    await waitFor(
      () => dialog.getBoundingClientRect().width >= document.documentElement.clientWidth * 0.79,
    );
    expect(dialog.getBoundingClientRect().width).toBeGreaterThanOrEqual(
      document.documentElement.clientWidth * 0.79,
    );
    expect(dialog.textContent).toContain('broken.json');
    expect(dialog.textContent).toContain('fps');
    expect(dialog.textContent).toContain('episodes');

    const errorsButton = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.getAttribute('aria-label') === 'Show only 1 error(s)',
    )!;
    errorsButton.click();

    await waitFor(
      () => !dialog.textContent?.includes('fps') && !dialog.textContent?.includes('episodes'),
    );
    expect(errorsButton.getAttribute('aria-pressed')).toBe('true');
    expect(dialog.textContent).toContain('broken.json');

    errorsButton.click();
    await waitFor(
      () => dialog.textContent?.includes('fps') && dialog.textContent?.includes('episodes'),
    );
    expect(errorsButton.getAttribute('aria-pressed')).toBe('false');
  });
});
