import React, { useCallback, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import {
  applyChange,
  type AnnotationChange,
  type AnnotationDocument,
  type AnnotationField,
  type Segment,
} from '@/core';
import type { LeRobotAnnotationSaveState } from '@/contexts/annotationTypes';
import type { LeRobotMessages } from '@/i18n/messageKeys';
import { FetchDataSource } from './fixtures';
import { pauseOnEpisode } from './playback';
import { expectNoBlockingA11yViolations } from './a11y';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const FIXTURE = '/tests/fixtures/datasets/lerobotv3';
const LENGTHS = new Map([
  [0, 3],
  [1, 3],
]);
const ctx = { episodeLength: (index: number) => LENGTHS.get(index) };

const fields: AnnotationField[] = [
  {
    id: 'outcome',
    label: 'Outcome',
    kind: 'select',
    options: [
      { value: 'success', label: 'Success', key: '1' },
      { value: 'failure', label: 'Failure', key: '2' },
      { value: 'partial', label: 'Partial', key: '3' },
    ],
  },
  { id: 'tags', label: 'Tags', kind: 'tags', suggestions: ['clean'] },
];

function seg(
  id: string,
  startFrame: number,
  endFrame: number,
  extra: Partial<Segment> = {},
): Segment {
  return {
    id,
    startFrame,
    endFrame,
    task: null,
    subtasks: [],
    values: {},
    review: 'to_review',
    origin: { kind: 'suggested', confidence: 0.82 },
    ...extra,
  };
}

type HostLog = { changes: AnnotationChange[]; value: () => AnnotationDocument };

/**
 * A host that persists changes after `delayMs` (late answers) or refuses
 * every change when `refuse` is set.
 */
function Host({
  initial,
  log,
  delayMs = 0,
  refuse = false,
  readOnly = false,
  editable = true,
}: {
  initial: AnnotationDocument;
  log: HostLog;
  delayMs?: number;
  refuse?: boolean;
  readOnly?: boolean;
  editable?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [saveState, setSaveState] = useState<LeRobotAnnotationSaveState>({ kind: 'idle' });
  const valueRef = useRef(value);
  const next = useRef(0);
  log.value = () => valueRef.current;
  const onChange = useCallback(
    (change: AnnotationChange, meta: { changeId: string }) => {
      log.changes.push(change);
      if (refuse) {
        setSaveState({ kind: 'refused', message: 'Server says no', changeIds: [meta.changeId] });
        return;
      }
      setSaveState({ kind: 'saving' });
      const answer = () => {
        const result = applyChange(valueRef.current, change, ctx);
        if (!result.ok) {
          setSaveState({
            kind: 'refused',
            message: result.refusal.code,
            changeIds: [meta.changeId],
          });
          return;
        }
        valueRef.current = result.doc;
        setValue(result.doc);
        setSaveState({ kind: 'saved' });
      };
      if (delayMs > 0) setTimeout(answer, delayMs);
      else answer();
    },
    [delayMs, log, refuse],
  );
  const annotation = useMemo(
    () =>
      editable
        ? {
            value,
            onChange,
            saveState,
            createSegmentId: () => `new-${++next.current}`,
          }
        : { value },
    [editable, onChange, saveState, value],
  );
  return (
    <LeRobotViewer
      dataSource={useMemo(() => new FetchDataSource(FIXTURE), [])}
      language="en"
      annotation={annotation}
      readOnly={readOnly}
      fields={fields}
      messages={
        {
          'segments.progress': '{{confirmed}} of {{total}} reviewed',
          // Not a public key: ignored.
          'sidebar.episodesCount': 'INTERNAL COPY',
        } as LeRobotMessages
      }
    />
  );
}

/** Wait for the dataset and the segment UI, then stop autoplay so the playhead stays put. */
async function waitForSegments(host: HTMLElement) {
  await expect
    .poll(() => host.querySelector('[data-testid="lerobot-segment-track"]'), { timeout: 60_000 })
    .not.toBeNull();
  const playButton = () =>
    host.querySelector<HTMLButtonElement>(
      'button.rounded-full:has(> svg.lucide-play, > svg.lucide-pause)',
    );
  await expect.poll(() => playButton()?.disabled, { timeout: 60_000 }).toBe(false);
  await expect
    .poll(
      () => {
        if (playButton()?.querySelector('.lucide-pause')) playButton()!.click();
        return playButton()?.querySelector('.lucide-play') != null;
      },
      { timeout: 30_000, interval: 200 },
    )
    .toBe(true);
  // Autoplay may have moved the playhead before it stopped (a frame is 0.1 s
  // here); the key steps count segments from the start.
  viewerRoot(host).focus();
  await press('{Home}');
}

/** Select the segment `n` (1-based, current episode) with J from the start. */
async function selectWithKeys(host: HTMLElement, n: number) {
  viewerRoot(host).focus();
  for (let i = 0; i < n; i++) await press('j');
  await expect
    .poll(
      () => host.querySelector('[data-testid="lerobot-segment-inspector"]')?.textContent ?? '',
      {
        timeout: 10_000,
      },
    )
    .toContain(`#${n}`);
}

function viewerRoot(host: HTMLElement) {
  return host.querySelector<HTMLElement>('.lerobot-root')!;
}

async function press(keys: string) {
  await userEvent.keyboard(keys);
  await new Promise((resolve) => setTimeout(resolve, 30));
}

/** Axe on the segment UI this change adds (track, inspector, list). */
async function expectSegmentUiAccessible(host: HTMLElement) {
  for (const id of ['lerobot-segment-track', 'lerobot-segment-inspector', 'lerobot-segment-list']) {
    const element = host.querySelector(`[data-testid="${id}"]`);
    expect(element, id).not.toBeNull();
    await expectNoBlockingA11yViolations(element!);
  }
}

function trackCount(host: HTMLElement) {
  return () =>
    host.querySelectorAll('[data-testid="lerobot-segment-track"] [role="listitem"]').length;
}

function status(host: HTMLElement) {
  return host.querySelector('[data-testid="lerobot-segment-status"]')?.textContent ?? '';
}

describe('browser: segments, review and change ops', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await page.viewport(1280, 900);
    host = document.createElement('div');
    host.style.cssText = 'width:1280px;height:900px';
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    host.remove();
  });

  it('reviews by keys through a host that answers late; undo / redo emit inverse changes', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        delayMs={120}
        initial={{ episodes: { 0: { segments: [seg('a', 0, 0), seg('b', 1, 2)] } } }}
      />,
    );
    await waitForSegments(host);
    // Host copy replaces the built-in message; internal copy cannot be replaced.
    expect(host.textContent).toContain('0 of 2 reviewed');
    expect(host.textContent).not.toContain('INTERNAL COPY');
    await selectWithKeys(host, 1);
    await press('a');
    await press('1');
    await expect.poll(() => host.textContent).toContain('1 of 2 reviewed');
    await expect
      .poll(() => log.value().episodes[0].segments[0].values)
      .toEqual({ outcome: 'success' });
    expect(log.changes.slice(0, 2)).toEqual([
      { op: 'confirm', episodeIndex: 0, ids: ['a'] },
      { op: 'update', episodeIndex: 0, id: 'a', patch: { values: { outcome: 'success' } } },
    ]);

    // J selects #2 and seeks to its start; S at its first frame is refused with a reason.
    await press('j');
    await expect
      .poll(() => host.querySelector('[data-testid="lerobot-segment-inspector"]')?.textContent)
      .toContain('#2');
    await press('s');
    await expect.poll(() => status(host)).toContain('first frame');
    await press('{ArrowRight}');
    await press('s');
    await expect
      .poll(() => log.value().episodes[0].segments.map((item) => item.id))
      .toEqual(['a', 'b', 'new-1']);
    // Editing never confirms: both halves of a to-review proposal stay to review.
    expect(
      log
        .value()
        .episodes[0].segments.slice(1)
        .map((item) => item.review),
    ).toEqual(['to_review', 'to_review']);

    await press('{Control>}z{/Control}');
    await expect
      .poll(() => log.value().episodes[0].segments.map((item) => item.id))
      .toEqual(['a', 'b']);
    await press('{Control>}{Shift>}z{/Shift}{/Control}');
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(3);
    const splits = log.changes.filter((change) => change.op === 'split');
    expect(splits.map((change) => change.op === 'split' && change.newId)).toEqual([
      'new-1',
      'new-2',
    ]);
    expect(log.changes.find((change) => change.op === 'merge')).toEqual({
      op: 'merge',
      episodeIndex: 0,
      id: 'b',
      withId: 'new-1',
    });

    // Delete with Undo (restore).
    await press('k');
    await press('r');
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(2);
    await userEvent.click(page.getByRole('button', { name: 'Undo', exact: true }).first());
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(3);
    expect(log.changes.at(-1)?.op).toBe('restore');

    // Shift+A asks once, then confirms every to-review segment of the filter.
    await press('{Shift>}a{/Shift}');
    await expect.element(page.getByRole('dialog')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: /Confirm 2 segments/ }));
    await expect.poll(() => host.textContent).toContain('3 of 3 reviewed');
    await page.screenshot({ path: '../../temp/segments-host-light.png' });
    await expectSegmentUiAccessible(host);
    // Space never opens a pause-to-label dialog in a host-controlled viewer.
    viewerRoot(host).focus();
    await press(' ');
    await new Promise((resolve) => setTimeout(resolve, 150));
    await press(' ');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('a refusing host keeps its value: each refusal drops its change and its undo step', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        refuse
        initial={{ episodes: { 0: { segments: [seg('a', 0, 0), seg('b', 1, 2)] } } }}
      />,
    );
    await waitForSegments(host);
    await selectWithKeys(host, 1);
    await press('r');
    await expect.poll(() => log.changes).toEqual([{ op: 'delete', episodeIndex: 0, id: 'a' }]);
    await expect.poll(() => status(host)).toContain('Not saved · Server says no');
    // The segment is still shown: the host's value wins over the preview.
    await expect.poll(trackCount(host)).toBe(2);
    // A second refusal in a row is dropped too.
    await selectWithKeys(host, 2);
    await press('r');
    await expect.poll(() => log.changes).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(trackCount(host)()).toBe(2);
    // Nothing the host refused is left to undo.
    await press('{Control>}z{/Control}');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(log.changes).toHaveLength(2);
    expect(status(host)).toContain('Nothing to undo');
  });

  it('changes made faster than the host answers stay shown and stay undoable', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        delayMs={600}
        initial={{ episodes: { 0: { segments: [seg('a', 0, 0)] } } }}
      />,
    );
    await waitForSegments(host);
    await selectWithKeys(host, 1);
    // N at frame 1 creates new-1 (1–2); S at frame 2 splits it: both before any answer.
    await press('{ArrowRight}');
    await press('n');
    await press('{ArrowRight}');
    await press('s');
    expect(log.changes.map((change) => change.op)).toEqual(['create', 'split']);
    expect(trackCount(host)()).toBe(3);
    // The host answers the create only: the split stays shown.
    await expect.poll(() => log.value().episodes[0].segments.length, { timeout: 5_000 }).toBe(2);
    expect(trackCount(host)()).toBe(3);
    await expect.poll(() => log.value().episodes[0].segments.length, { timeout: 5_000 }).toBe(3);
    // The whole history survived both answers.
    await press('{Control>}z{/Control}');
    await press('{Control>}z{/Control}');
    expect(log.changes.slice(2)).toEqual([
      { op: 'merge', episodeIndex: 0, id: 'new-1', withId: 'new-2' },
      { op: 'delete', episodeIndex: 0, id: 'new-1' },
    ]);
    await expect.poll(() => log.value().episodes[0].segments.length, { timeout: 5_000 }).toBe(1);
    expect(trackCount(host)()).toBe(1);
  });

  it('a burst of nudges is one step whose undo restores clipped subtasks and whose redo applies', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        initial={{
          episodes: {
            0: {
              segments: [
                seg('a', 0, 1, { subtasks: [{ startFrame: 1, endFrame: 1, label: 'grasp' }] }),
              ],
            },
          },
        }}
      />,
    );
    await waitForSegments(host);
    await selectWithKeys(host, 1);
    await press('{ArrowRight}'); // playhead on the end edge
    await press('.'); // end 2
    await press(','); // end 1
    await press(','); // end 0: the subtask is clipped away
    await expect
      .poll(() => log.value().episodes[0].segments[0])
      .toMatchObject({
        endFrame: 0,
        subtasks: [],
      });
    await press('{Control>}z{/Control}');
    await expect
      .poll(() => log.value().episodes[0].segments[0])
      .toMatchObject({
        endFrame: 1,
        subtasks: [{ startFrame: 1, endFrame: 1, label: 'grasp' }],
      });
    await press('{Control>}{Shift>}z{/Shift}{/Control}');
    await expect
      .poll(() => log.value().episodes[0].segments[0])
      .toMatchObject({
        endFrame: 0,
        subtasks: [],
      });
    expect(status(host)).not.toContain('Not saved');
  });

  it('Escape in the task field reverts and sends nothing; arrows move between options', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(<Host log={log} initial={{ episodes: { 0: { segments: [seg('a', 0, 1)] } } }} />);
    await waitForSegments(host);
    await selectWithKeys(host, 1);
    const task = page.getByRole('textbox', { name: 'Task' });
    await userEvent.click(task);
    await userEvent.keyboard('hello');
    await press('{Escape}');
    await expect.element(task).toHaveValue('');
    expect(log.changes).toEqual([]);
    // Radio group: one tab stop, arrows choose.
    const success = page.getByRole('radio', { name: /^Success/ });
    await expect.element(success).toHaveAttribute('tabindex', '0');
    (success.element() as HTMLElement).focus();
    await press('{ArrowRight}');
    await expect
      .poll(() => log.changes.at(-1))
      .toEqual({
        op: 'update',
        episodeIndex: 0,
        id: 'a',
        patch: { values: { outcome: 'failure' } },
      });
    expect(document.activeElement?.textContent).toContain('Failure');
  });

  it('a host-controlled viewer plays through the episode end with no pause-to-label dialog', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(<Host log={log} initial={{ episodes: { 0: { segments: [seg('a', 0, 2)] } } }} />);
    await waitForSegments(host);
    await pauseOnEpisode(host, 0);
    host.querySelector<HTMLButtonElement>('button[aria-label="Play/pause"]')!.click();
    // Sequential playback leaves episode 0 instead of holding on its last frame.
    await expect
      .poll(() => host.querySelector('[aria-label="Select Episode 1"][aria-current="true"]'), {
        timeout: 30_000,
      })
      .not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(log.changes).toEqual([]);
  });

  it('a plain embedded viewer has no segment keys or UI', async () => {
    root.render(<LeRobotViewer dataSource={new FetchDataSource(FIXTURE)} language="en" />);
    await expect
      .poll(() => /\d+ episodes?/.test(host.textContent ?? ''), { timeout: 60_000 })
      .toBe(true);
    viewerRoot(host).focus();
    await press('?');
    await press('j');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[data-testid="lerobot-segment-track"]')).toBeNull();
    expect(host.querySelector('[data-testid="lerobot-segment-list"]')).toBeNull();
  });

  it('read-only shows segments, review and badges with no edit control and no edit key', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        readOnly
        editable={false}
        initial={{
          episodes: {
            0: {
              segments: [
                seg('a', 0, 0, { review: 'confirmed', values: { outcome: 'failure' } }),
                seg('b', 1, 2, { status: { severity: 'warn', label: 'Check', count: 2 } }),
              ],
            },
          },
        }}
      />,
    );
    await waitForSegments(host);
    expect(host.textContent).toContain('1 of 2 reviewed');
    expect(host.textContent).toContain('Check 2');
    await selectWithKeys(host, 1);
    await press('s');
    await press('r');
    await press('n');
    await press('{Control>}z{/Control}');
    expect(log.changes).toEqual([]);
    for (const name of ['Split', 'Delete', 'New', 'Confirm', 'Undo', 'Set in']) {
      expect(page.getByRole('button', { name, exact: true }).elements()).toHaveLength(0);
    }
    expect(host.querySelector('[data-testid^="segment-handle-"]')).toBeNull();
    expect(host.querySelector('[title="Edit episodes"]')).toBeNull();
    const failure = page.getByRole('radio', { name: 'Failure' });
    await expect.element(failure).toBeDisabled();
    await expect.element(failure).toHaveAttribute('aria-checked', 'true');
  });

  it('readOnly without annotation never edits (no uncontrolled editing)', async () => {
    root.render(<LeRobotViewer dataSource={new FetchDataSource(FIXTURE)} language="en" readOnly />);
    await expect
      .poll(() => /\d+ episodes?/.test(host.textContent ?? ''), { timeout: 60_000 })
      .toBe(true);
    expect(host.querySelector('[title="Edit episodes"]')).toBeNull();
    viewerRoot(host).focus();
    await press('n');
    expect(host.querySelector('[data-testid="lerobot-segment-track"]')).toBeNull();
  });

  it('keys act only with focus inside the viewer and never while typing', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    const outside = document.createElement('input');
    outside.setAttribute('aria-label', 'host search');
    document.body.prepend(outside);
    try {
      root.render(<Host log={log} initial={{ episodes: { 0: { segments: [seg('a', 0, 1)] } } }} />);
      await waitForSegments(host);
      await selectWithKeys(host, 1);
      // Focus in a host field outside the viewer: nothing happens.
      outside.focus();
      await press('r');
      // Typing in the inspector's task field: letters are text, not keys.
      const task = page.getByRole('textbox', { name: 'Task' });
      await userEvent.click(task);
      await press('srm');
      expect(log.changes).toEqual([]);
      await press('{Enter}');
      await expect
        .poll(() => log.changes)
        .toEqual([{ op: 'update', episodeIndex: 0, id: 'a', patch: { task: 'srm' } }]);
      // Back on a viewer control the same key acts.
      viewerRoot(host).focus();
      await press('r');
      await expect
        .poll(() => log.changes.at(-1))
        .toEqual({ op: 'delete', episodeIndex: 0, id: 'a' });
    } finally {
      outside.remove();
    }
  });

  it('In / Out fields select on focus, apply on Enter, and keep a refused value marked', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        initial={{ episodes: { 0: { segments: [seg('a', 0, 0), seg('b', 1, 2)] } } }}
      />,
    );
    await waitForSegments(host);
    await selectWithKeys(host, 1);
    const out = page.getByRole('textbox', { name: 'Out' });
    await userEvent.click(out);
    expect((document.activeElement as HTMLInputElement).selectionEnd).toBe(
      (document.activeElement as HTMLInputElement).value.length,
    );
    await userEvent.fill(out, '0:00.20');
    await press('{Enter}');
    await expect.element(out).toHaveAttribute('aria-invalid', 'true');
    await expect.element(out).toHaveValue('0:00.20');
    expect(host.textContent).toContain('Segments cannot overlap.');
    expect(log.changes).toEqual([]);
    await userEvent.fill(out, 'abc');
    await press('{Enter}');
    expect(host.textContent).toContain('Use m:ss.cc');
    await press('{Escape}');
    await expect.element(out).toHaveValue('0:00.10');
  });

  it('dark theme and Chinese copy render the same controls', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    function ZhHost() {
      const [value] = useState<AnnotationDocument>({
        episodes: { 0: { segments: [seg('a', 0, 0), seg('b', 1, 2, { review: 'confirmed' })] } },
      });
      return (
        <LeRobotViewer
          dataSource={useMemo(() => new FetchDataSource(FIXTURE), [])}
          language="zh"
          theme="dark"
          annotation={{ value, onChange: (change) => log.changes.push(change) }}
          fields={fields}
          messages={{ 'segments.title': '片段' }}
        />
      );
    }
    root.render(<ZhHost />);
    await waitForSegments(host);
    await selectWithKeys(host, 1);
    await expect.poll(() => host.textContent).toContain('已确认 1 / 2');
    expect(host.textContent).toContain('拆分');
    await page.screenshot({ path: '../../temp/segments-host-dark-zh.png' });
    await expectSegmentUiAccessible(host);
  });
});
