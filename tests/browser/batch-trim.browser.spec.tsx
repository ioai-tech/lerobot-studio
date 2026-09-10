import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { classifyLeRobotVersion, type EpisodeMetadata, type NumericalColumnMap } from '@/core';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { BatchTrimDialog } from '@/components/dialogs/BatchTrimDialog';
import { useEpisodeView } from '@/contexts/useEpisodeView';
import { I18nProvider } from '@/i18n/core';
import {
  LeRobotDataContext,
  LeRobotSelectionContext,
  LeRobotPlaybackContext,
  LeRobotUiContext,
  type LeRobotDataContextType,
  type LeRobotSelectionContextType,
  type LeRobotPlaybackContextType,
  type LeRobotUiContextType,
} from '@/contexts/LeRobotContext';
import { FetchDataSource } from './fixtures';
import { expectNoBlockingA11yViolations } from './a11y';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

it('batch trims through the real sidebar, previews without applying, and preserves per-episode adjustments', async () => {
  await page.viewport(1280, 900);
  const host = document.createElement('div');
  host.style.cssText = 'width:1280px;height:900px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    root.render(
      <LeRobotViewer
        dataSource={new FetchDataSource('/tests/fixtures/datasets/lerobotv3')}
        language="en"
        showSidebar
        showPlaybackBar
      />,
    );
    await expect
      .poll(() => host.querySelector<HTMLButtonElement>('[title="Edit episodes"]')?.disabled)
      .toBe(false);
    await userEvent.click(page.getByRole('button', { name: 'Select', exact: true }));
    for (const index of [0, 1])
      await userEvent.click(
        page.getByRole('button', { name: `Select Episode ${index}`, exact: true }),
      );
    await userEvent.click(page.getByRole('button', { name: 'Batch trim', exact: true }));
    await page.getByRole('combobox', { name: 'Method', exact: true }).selectOptions('fixed');
    await page.getByRole('spinbutton', { name: 'Remove from start (seconds)' }).fill('0.1');
    await userEvent.click(page.getByRole('button', { name: 'Calculate ranges' }));
    await expect.element(page.getByRole('button', { name: 'Apply selected ranges' })).toBeEnabled();
    await userEvent.click(page.getByRole('button', { name: 'Preview Episode 1', exact: true }));
    await expect.poll(() => host.querySelector('[data-slot="dialog-content"]')).toBeNull();
    host.querySelector<HTMLButtonElement>('[title="Edit episodes"]')!.click();
    const trimPanel = host.querySelector<HTMLElement>('[aria-label="Trim episode"]')!;
    trimPanel.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    trimPanel.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(host.querySelector('[data-slot="dialog-content"]')).toBeNull();
    await page.getByRole('spinbutton', { name: 'Start frame', exact: true }).fill('2');
    await expect
      .element(page.getByText('3 → 1 frames · keep 0.20–0.30 s', { exact: true }))
      .toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Return to batch trim' }));
    await new Promise((resolve) => setTimeout(resolve, 250)); // Let the dialog entrance animation finish for visual/a11y inspection.
    await page.screenshot({ path: '../../temp/batch-trim.png' });
    await expectNoBlockingA11yViolations(
      document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!,
    );
    await userEvent.click(page.getByRole('button', { name: 'Apply selected ranges' }));
    await expect.element(page.getByText('Applied to 2 episodes.', { exact: false })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Undo this batch' }));
    await expect.element(page.getByText('Restored 2 trims.', { exact: false })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Apply selected ranges' }));
    await userEvent.click(page.getByRole('button', { name: 'Close', exact: true }).first());
    await expect
      .element(page.getByText('3 → 1 frames · keep 0.20–0.30 s', { exact: true }))
      .toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Batch trim', exact: true }));
    await userEvent.click(page.getByRole('button', { name: 'Calculate ranges' }));
    await expect.poll(() => document.querySelectorAll('tbody tr').length).toBe(2);
    await expect
      .element(page.getByRole('button', { name: 'Apply selected ranges' }))
      .toBeDisabled();
    expect(document.body.textContent).toContain('Skipped: existing trim');
  } finally {
    root.unmount();
    host.remove();
  }
});

it('analyzes each episode independently, skips existing/deleted/invalid data, and ignores cancelled results', async () => {
  const episodes: EpisodeMetadata[] = Array.from({ length: 5 }, (_, episode_index) => ({
    episode_index,
    length: 900,
    tasks: ['move'],
  }));
  const load = vi.fn(async (index: number): Promise<NumericalColumnMap> => ({
    'observation.state': {
      rows: 900,
      width: 1,
      values: Float64Array.from({ length: 900 }, (_, i) =>
        index === 1 ? 0 : Math.min(10, Math.max(0, i / 30 - 10)),
      ),
    },
  }));
  const loader = { loadAllNumericalData: load };
  const setPlaying = vi.fn();
  const setFrameIndex = vi.fn();
  let view: ReturnType<typeof useEpisodeView>;
  function Harness() {
    const selection = useEpisodeView({
      episodes,
      versionCapability: classifyLeRobotVersion('v3.0'),
    });
    view = selection;
    const [open, setOpen] = useState(false);
    const [suggestion, setSuggestion] = useState(null);
    return (
      <I18nProvider forcedLanguage="en">
        <LeRobotDataContext.Provider
          value={
            {
              dataLoader: loader,
              info: {
                fps: 30,
                features: {
                  'observation.state': { dtype: 'float32', shape: [1], names: ['joint'] },
                },
              },
            } as unknown as LeRobotDataContextType
          }
        >
          <LeRobotSelectionContext.Provider
            value={
              {
                ...selection,
                selectEpisode: async () => true,
              } as unknown as LeRobotSelectionContextType
            }
          >
            <LeRobotPlaybackContext.Provider
              value={
                {
                  setPlaying,
                  setFrameIndex,
                } as unknown as LeRobotPlaybackContextType
              }
            >
              <LeRobotUiContext.Provider
                value={
                  {
                    trimSuggestion: suggestion,
                    setTrimSuggestion: setSuggestion,
                  } as unknown as LeRobotUiContextType
                }
              >
                <button
                  onClick={() => {
                    selection.trimEpisode(2, { startFrame: 60, endFrame: 600 });
                    selection.deleteEpisode(3);
                    setOpen(true);
                  }}
                >
                  Open test batch
                </button>
                {open && <BatchTrimDialog episodes={episodes} onClose={() => setOpen(false)} />}
              </LeRobotUiContext.Provider>
            </LeRobotPlaybackContext.Provider>
          </LeRobotSelectionContext.Provider>
        </LeRobotDataContext.Provider>
      </I18nProvider>
    );
  }
  const host = document.createElement('div');
  host.className = 'lerobot-root';
  document.body.append(host);
  const root = createRoot(host);
  try {
    root.render(<Harness />);
    await userEvent.click(page.getByRole('button', { name: 'Open test batch' }));
    await page.getByRole('spinbutton', { name: 'Keep after motion (seconds)' }).fill('1');
    await userEvent.click(page.getByRole('button', { name: 'Calculate ranges' }));
    await expect.poll(() => document.querySelectorAll('tbody tr').length).toBe(5);
    expect(load.mock.calls.map(([index]) => index)).toEqual([0, 1, 4]);
    expect(view!.trimRanges.size).toBe(1);
    expect(document.body.textContent).toContain('No reliable suggestion');
    expect(document.body.textContent).toContain('Skipped: deleted');
    // An invalid batch must fail atomically, including ranges preceding the bad entry.
    expect(() =>
      view!.trimEpisodes(
        new Map([
          [0, { startFrame: 0, endFrame: 20 }],
          [1, { startFrame: 4, endFrame: 900 }],
        ]),
      ),
    ).toThrow();
    expect(view!.trimRanges.size).toBe(1);
    await userEvent.click(page.getByRole('button', { name: 'Apply selected ranges' }));
    await expect.poll(() => view!.trimRanges.size).toBe(3);
    expect(view!.trimRanges.get(0)!.startFrame / 30).toBeGreaterThan(6);
    expect(view!.trimRanges.get(0)!.endFrame / 30).toBeLessThan(22);
    expect(view!.trimRanges.get(2)).toEqual({ startFrame: 60, endFrame: 600 });
    await userEvent.click(page.getByRole('button', { name: 'Undo this batch' }));
    await expect.poll(() => view!.trimRanges.size).toBe(1);
    let resolveRead!: (value: NumericalColumnMap) => void;
    load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    await userEvent.click(page.getByRole('button', { name: 'Calculate ranges' }));
    await expect.poll(() => typeof resolveRead).toBe('function');
    await userEvent.click(page.getByRole('button', { name: 'Cancel', exact: true }));
    resolveRead({});
    await expect.element(page.getByText('Analysis cancelled. No trims applied.')).toBeVisible();
    expect(view!.trimRanges.size).toBe(1);
    expect(document.querySelectorAll('tbody tr').length).toBe(0);
    // Missing feature data is a skipped suggestion, not a destructive range.
    load.mockResolvedValue({});
    await userEvent.click(page.getByRole('button', { name: 'Calculate ranges' }));
    await expect.poll(() => document.querySelectorAll('tbody tr').length).toBe(5);
    await expect
      .element(page.getByRole('button', { name: 'Apply selected ranges' }))
      .toBeDisabled();
    await page.getByRole('combobox', { name: 'Method', exact: true }).selectOptions('fixed');
    await page.getByRole('spinbutton', { name: 'Remove from start (seconds)' }).fill('1');
    await userEvent.click(
      page.getByRole('checkbox', { name: 'Overwrite existing trims (otherwise skip them)' }),
    );
    await userEvent.click(page.getByRole('button', { name: 'Calculate ranges' }));
    await expect.element(page.getByRole('button', { name: 'Apply selected ranges' })).toBeEnabled();
    await userEvent.click(page.getByRole('checkbox', { name: 'Include Episode 4', exact: true }));
    await userEvent.click(page.getByRole('button', { name: 'Apply selected ranges' }));
    await expect.poll(() => view!.trimRanges.size).toBe(3);
    expect(view!.trimRanges.get(2)).toEqual({ startFrame: 30, endFrame: 899 });
    view!.trimEpisode(0, { startFrame: 90, endFrame: 800 });
    await expect.poll(() => view!.trimRanges.get(0)?.startFrame).toBe(90);
    await userEvent.click(page.getByRole('button', { name: 'Undo this batch' }));
    await expect.poll(() => view!.trimRanges.size).toBe(2);
    expect(view!.trimRanges.get(0)).toEqual({ startFrame: 90, endFrame: 800 });
    expect(view!.trimRanges.get(2)).toEqual({ startFrame: 60, endFrame: 600 });
  } finally {
    root.unmount();
    host.remove();
  }
});
