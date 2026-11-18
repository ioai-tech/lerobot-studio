import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import {
  classifyLeRobotVersion,
  type AnnotationChange,
  type EpisodeMetadata,
  type NumericalColumnMap,
} from '@/core';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { BatchTrimDialog } from '@/components/dialogs/BatchTrimDialog';
import { useEpisodeView } from '@/contexts/useEpisodeView';
import { useSegmentAnnotation, type SegmentAnnotationState } from '@/contexts/useSegmentAnnotation';
import { I18nProvider } from '@/i18n/core';
import {
  LeRobotDataContext,
  LeRobotSelectionContext,
  LeRobotPlaybackContext,
  LeRobotUiContext,
  LeRobotSegmentContext,
  type LeRobotDataContextType,
  type LeRobotSelectionContextType,
  type LeRobotPlaybackContextType,
  type LeRobotUiContextType,
} from '@/contexts/LeRobotContext';
import { FetchDataSource } from './fixtures';
import { pauseOnEpisode } from './playback';
import { expectNoBlockingA11yViolations } from './a11y';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

it('suggests segments through the real sidebar, previews without adding, and adds them as one undo step', async () => {
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
      .poll(() => host.querySelector<HTMLButtonElement>('[title="Edit episodes"]')?.disabled, {
        timeout: 60_000,
      })
      .toBe(false);
    await pauseOnEpisode(host, 0);
    await userEvent.click(page.getByRole('button', { name: 'Select', exact: true }));
    for (const index of [0, 1])
      await userEvent.click(
        page.getByRole('button', { name: `Select Episode ${index}`, exact: true }),
      );
    await userEvent.click(page.getByRole('button', { name: 'Suggest segments', exact: true }));
    await expect.element(page.getByRole('dialog')).toBeVisible();
    await userEvent.click(
      page.getByRole('button', { name: 'Remove fixed durations', exact: true }),
    );
    await page.getByRole('spinbutton', { name: 'Remove from start (seconds)' }).fill('0.1');
    await userEvent.click(page.getByRole('button', { name: 'Calculate ranges' }));
    await expect
      .element(page.getByRole('button', { name: 'Add as segments to review' }))
      .toBeEnabled();
    await userEvent.click(page.getByRole('button', { name: 'Preview Episode 1', exact: true }));
    await expect.poll(() => host.querySelector('[data-slot="dialog-content"]')).toBeNull();
    await expect.element(page.getByRole('button', { name: 'Return to suggestions' })).toBeVisible();
    // Previewing adds nothing.
    expect(host.querySelector('[data-testid="lerobot-segment-track"]')).toBeNull();
    await page.getByRole('spinbutton', { name: 'Start frame', exact: true }).fill('2');
    await expect
      .element(page.getByText('3 → 1 frames · keep 0.20–0.30 s', { exact: true }))
      .toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Return to suggestions' }));
    await new Promise((resolve) => setTimeout(resolve, 250)); // Let the dialog entrance animation finish.
    await expectNoBlockingA11yViolations(
      document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!,
    );
    await userEvent.click(page.getByRole('button', { name: 'Add as segments to review' }));
    await expect
      .element(
        page
          .getByRole('dialog')
          .getByText('Added 2 suggested segments to review.', { exact: false }),
      )
      .toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Remove these suggestions' }));
    await expect
      .element(
        page.getByRole('dialog').getByText('Removed 2 suggested segments.', { exact: false }),
      )
      .toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Add as segments to review' }));
    await userEvent.click(page.getByRole('button', { name: 'Close', exact: true }).first());
    // Two to-review segments; the adjusted one of episode 1 covers frame 2 only.
    await expect
      .poll(() => host.querySelector('[data-testid="lerobot-segment-track"]'))
      .not.toBeNull();
    await expect.element(page.getByText('0 / 2 confirmed', { exact: true })).toBeVisible();
    await expect.element(page.getByText('0:00.20–0:00.30', { exact: false })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Suggest segments', exact: true }));
    await userEvent.click(page.getByRole('button', { name: 'Calculate ranges' }));
    await expect.poll(() => document.querySelectorAll('tbody tr').length).toBe(2);
    await expect
      .element(page.getByRole('button', { name: 'Add as segments to review' }))
      .toBeDisabled();
    expect(document.body.textContent).toContain('Skipped: has segments');
  } finally {
    root.unmount();
    host.remove();
  }
});

it('analyzes each episode independently, skips segmented/deleted/invalid data, and ignores cancelled results', async () => {
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
  const versionCapability = classifyLeRobotVersion('v3.0');
  let segments: SegmentAnnotationState;
  const ranges = () =>
    new Map(
      Object.entries(segments.doc.episodes).flatMap(([index, entry]) =>
        entry.segments.map(
          (segment) =>
            [
              Number(index),
              { startFrame: segment.startFrame, endFrame: segment.endFrame },
            ] as const,
        ),
      ),
    );
  const create = (
    episodeIndex: number,
    startFrame: number,
    endFrame: number,
  ): AnnotationChange => ({
    op: 'create',
    episodeIndex,
    segment: {
      id: `manual-${episodeIndex}-${startFrame}`,
      startFrame,
      endFrame,
      task: null,
      subtasks: [],
      values: {},
      review: 'confirmed',
      origin: { kind: 'manual' },
    },
  });
  function Harness() {
    const selection = useEpisodeView({ episodes, versionCapability });
    segments = useSegmentAnnotation({
      episodes,
      selectedEpisodeIndex: null,
      versionCapability,
      episodeEditMode: true,
      sourceSubtasks: [],
      getFrameIndex: () => 0,
      setFrameIndex,
      selectEpisode: async () => true,
    });
    const [open, setOpen] = useState(false);
    const [suggestion, setSuggestion] = useState(null);
    return (
      <I18nProvider forcedLanguage="en">
        <LeRobotDataContext.Provider
          value={
            {
              dataLoader: loader,
              subtasks: {},
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
                    setTrimPreviewHandlers: () => undefined,
                  } as unknown as LeRobotUiContextType
                }
              >
                <LeRobotSegmentContext.Provider value={segments}>
                  <button
                    onClick={() => {
                      segments.dispatch([create(2, 60, 600)]);
                      selection.deleteEpisode(3);
                      setOpen(true);
                    }}
                  >
                    Open test batch
                  </button>
                  {open && <BatchTrimDialog episodes={episodes} onClose={() => setOpen(false)} />}
                </LeRobotSegmentContext.Provider>
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
    expect(ranges().size).toBe(1);
    expect(document.body.textContent).toContain('No reliable suggestion');
    expect(document.body.textContent).toContain('Skipped: deleted');
    expect(document.body.textContent).toContain('Skipped: has segments');
    // A batch is all or nothing: a bad change drops the valid ones before it.
    expect(segments!.dispatch([create(0, 0, 20), create(1, 4, 900)])).toBe(false);
    expect(ranges().size).toBe(1);
    await userEvent.click(page.getByRole('button', { name: 'Add as segments to review' }));
    await expect.poll(() => ranges().size).toBe(3);
    expect(ranges().get(0)!.startFrame / 30).toBeGreaterThan(6);
    expect(ranges().get(0)!.endFrame / 30).toBeLessThan(22);
    expect(ranges().get(2)).toEqual({ startFrame: 60, endFrame: 600 });
    expect(segments!.doc.episodes[0].segments[0]).toMatchObject({
      review: 'to_review',
      origin: { kind: 'suggested' },
    });
    await userEvent.click(page.getByRole('button', { name: 'Remove these suggestions' }));
    await expect.poll(() => ranges().size).toBe(1);
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
    await expect.element(page.getByText('Analysis cancelled. Nothing added.')).toBeVisible();
    expect(ranges().size).toBe(1);
    expect(document.querySelectorAll('tbody tr').length).toBe(0);
    // Missing feature data is a skipped suggestion, not a destructive range.
    load.mockResolvedValue({});
    await userEvent.click(page.getByRole('button', { name: 'Calculate ranges' }));
    await expect.poll(() => document.querySelectorAll('tbody tr').length).toBe(5);
    await expect
      .element(page.getByRole('button', { name: 'Add as segments to review' }))
      .toBeDisabled();
    await userEvent.click(
      page.getByRole('button', { name: 'Remove fixed durations', exact: true }),
    );
    await page.getByRole('spinbutton', { name: 'Remove from start (seconds)' }).fill('1');
    await userEvent.click(
      page.getByRole('checkbox', {
        name: 'Replace existing segments (otherwise skip episodes that have them)',
      }),
    );
    await userEvent.click(page.getByRole('button', { name: 'Calculate ranges' }));
    await expect
      .element(page.getByRole('button', { name: 'Add as segments to review' }))
      .toBeEnabled();
    await userEvent.click(page.getByRole('checkbox', { name: 'Include Episode 4', exact: true }));
    await userEvent.click(page.getByRole('button', { name: 'Add as segments to review' }));
    await expect.poll(() => ranges().size).toBe(3);
    expect(ranges().get(2)).toEqual({ startFrame: 30, endFrame: 899 });
    // A later edit is never undone by the dialog's undo.
    expect(segments!.dispatch([create(4, 0, 10)])).toBe(true);
    await expect.poll(() => ranges().get(4)).toEqual({ startFrame: 0, endFrame: 10 });
    await userEvent.click(page.getByRole('button', { name: 'Remove these suggestions' }));
    expect(ranges().size).toBe(4);
    expect(ranges().get(4)).toEqual({ startFrame: 0, endFrame: 10 });
    expect(ranges().get(2)).toEqual({ startFrame: 30, endFrame: 899 });
  } finally {
    root.unmount();
    host.remove();
  }
});
