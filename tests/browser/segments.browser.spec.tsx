import React, { useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { type AnnotationDocument } from '@/core';
import { FetchDataSource } from './fixtures';
import { pauseOnEpisode } from './playback';
import {
  FIXTURE,
  type HostLog,
  expectSegmentUiAccessible,
  fields,
  press,
  seg,
  selectWithKeys,
  status,
  trackCount,
  viewerRoot,
  waitForSegments,
} from './segmentHarness';
import { Host } from './SegmentHost';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

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
    // Host copy replaces built-in messages; standalone-app copy cannot be replaced.
    // The segment list loads on demand: wait for it.
    await expect.poll(() => host.textContent, { timeout: 10_000 }).toContain('0 of 2 reviewed');
    expect(host.textContent).toContain('2 takes');
    expect(host.textContent).not.toContain('INTERNAL COPY');
    await selectWithKeys(host, 1);
    await press('1');
    await press('a');
    await expect.poll(() => host.textContent).toContain('1 of 2 reviewed');
    await expect
      .poll(() => log.value().episodes[0].segments[0].values)
      .toEqual({ outcome: 'success' });
    expect(log.changes.slice(0, 2)).toEqual([
      { op: 'update', episodeIndex: 0, id: 'a', patch: { values: { outcome: 'success' } } },
      { op: 'confirm', episodeIndex: 0, ids: ['a'] },
    ]);

    // A went on to #2, the next to review, at its start; S at its first frame is refused with a reason.
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

  it('an excluded proposal is never confirmed: Confirm and A refuse it, Shift+A confirms only the others', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        initial={{
          episodes: { 0: { segments: [seg('a', 0, 0, { excluded: true }), seg('b', 1, 2)] } },
        }}
      />,
    );
    await waitForSegments(host);
    await selectWithKeys(host, 1);
    const inspector = () => host.querySelector('[data-testid="lerobot-segment-inspector"]')!;
    const confirmButton = () =>
      inspector().querySelector<HTMLButtonElement>('button[title^="Confirm ("]')!;
    expect(inspector().textContent).toContain('Excluded');
    expect(inspector().textContent).not.toContain('To review');
    expect(confirmButton().disabled).toBe(true);
    await press('a');
    await expect.poll(() => status(host)).toContain('An excluded segment is not confirmed.');
    expect(log.changes).toEqual([]);
    // Confirm all counts and confirms the to-review segment only.
    await press('{Shift>}a{/Shift}');
    await expect.element(page.getByRole('dialog')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: /Confirm 1 segment$/ }));
    await expect.poll(() => log.changes.length).toBe(1);
    expect(log.changes[0]).toEqual({ op: 'confirm', episodeIndex: 0, ids: ['b'] });
    expect(log.value().episodes[0].segments.map((item) => item.review)).toEqual([
      'to_review',
      'confirmed',
    ]); // A on a segment that is already confirmed sends nothing either.
    viewerRoot(host).focus();
    await press('j');
    await expect.poll(() => inspector().textContent ?? '').toContain('#2');
    expect(confirmButton().disabled).toBe(true);
    await press('a');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(log.changes).toHaveLength(1);
  });

  it('Shift+A uses the filter in effect: a hidden Issues filter is All, and stays All', async () => {
    const warn = { severity: 'warn' as const, label: 'Check' };
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        initial={{
          episodes: { 0: { segments: [seg('a', 0, 0, { status: warn }), seg('b', 1, 2)] } },
        }}
      />,
    );
    await waitForSegments(host);
    await userEvent.click(page.getByRole('radio', { name: /Issues/ }));
    const checked = () =>
      host.querySelector('[data-testid="lerobot-segment-list"] [role="radio"][aria-checked="true"]')
        ?.textContent;
    await expect.poll(checked).toBe('Issues 1');
    // The issue goes away (another writer saved): Issues is no longer offered.
    log.setValue!({ episodes: { 0: { segments: [seg('a', 0, 0), seg('b', 1, 2)] } } });
    await expect.poll(checked).toBe('All 2');
    viewerRoot(host).focus();
    await press('{Shift>}a{/Shift}');
    await expect.element(page.getByRole('dialog')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: /Confirm 2 segments$/ }));
    await expect.poll(() => log.changes.length).toBe(1);
    expect(log.changes[0]).toEqual({ op: 'confirm', episodeIndex: 0, ids: ['a', 'b'] });
    // A new issue later does not bring the old Issues choice back by itself.
    log.setValue!({
      episodes: { 0: { segments: [seg('a', 0, 0, { status: warn }), seg('b', 1, 2)] } },
    });
    await expect
      .poll(() => host.querySelector('[data-testid="lerobot-segment-list"]')?.textContent ?? '')
      .toContain('Issues 1');
    expect(checked()).toBe('All 2');
  });

  it('a row keeps each badge on one line: Excluded, Suggested · 33% confidence, Check warnings 1 (s10 F-27)', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        initial={{
          episodes: {
            0: {
              segments: [
                seg('a', 0, 2, {
                  excluded: true,
                  origin: { kind: 'suggested', confidence: 0.33 },
                  status: { severity: 'warn', label: 'Check warnings', count: 1 },
                }),
              ],
            },
          },
        }}
      />,
    );
    await waitForSegments(host);
    const badges = () =>
      Array.from(
        host.querySelectorAll<HTMLElement>(
          '[data-testid="lerobot-segment-list"] li > button > span:last-child > *',
        ),
      ).filter((badge) => !badge.classList.contains('sr-only'));
    await expect.poll(() => badges().length).toBeGreaterThanOrEqual(3);
    const lineHeight = parseFloat(getComputedStyle(badges()[0]!).lineHeight) || 15;
    for (const badge of badges()) {
      // One line each: never "Suggested / 0.33" stacked in a column.
      expect(badge.getBoundingClientRect().height, badge.textContent ?? '').toBeLessThan(
        lineHeight * 1.5,
      );
    }
    expect(badges().map((badge) => badge.textContent)).toEqual([
      'Excluded',
      'Suggested · 33% confidence',
      'Check warnings 1',
    ]);
    // A badge never breaks inside, however narrow the row: whole badges wrap instead.
    for (const badge of badges()) {
      expect(getComputedStyle(badge).whiteSpace, badge.textContent ?? '').toBe('nowrap');
    }
    // The inspector's Excluded badge reads as a state, not as struck-out (deleted) text.
    await selectWithKeys(host, 1);
    const inspectorBadge = Array.from(
      host.querySelectorAll<HTMLElement>('[data-testid="lerobot-segment-inspector"] span'),
    ).find((span) => span.childElementCount === 0 && span.textContent === 'Excluded');
    expect(inspectorBadge).toBeDefined();
    expect(getComputedStyle(inspectorBadge!).textDecorationLine).not.toContain('line-through');
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
      .poll(() => host.querySelector('[aria-label="Select Episode 2"][aria-current="true"]'), {
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

  it('with the segment UI on, J / K never step episodes, even from <body> (s10 F-12)', async () => {
    const reports: Array<number | null> = [];
    const value: AnnotationDocument = {
      episodes: { 0: { segments: [seg('a', 0, 0), seg('b', 1, 2)] }, 1: { segments: [] } },
    };
    root.render(
      <LeRobotViewer
        dataSource={new FetchDataSource(FIXTURE)}
        language="en"
        annotation={{ value, onChange: () => undefined }}
        fields={fields}
        onSelectionChange={(selection) => reports.push(selection.episodeIndex)}
      />,
    );
    await waitForSegments(host);
    await expect.poll(() => reports.at(-1)).toBe(0);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(viewerRoot(host).contains(document.activeElement)).toBe(false);
    await press('j');
    await press('j');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(reports.at(-1)).toBe(0);
    await press('k');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(reports.at(-1)).toBe(0);
  });

  it('J / K step episodes in a viewer without segments, as ↓ / ↑ do (s10 F-12)', async () => {
    const reports: Array<number | null> = [];
    root.render(
      <LeRobotViewer
        dataSource={new FetchDataSource(FIXTURE)}
        language="en"
        onSelectionChange={(selection) => reports.push(selection.episodeIndex)}
      />,
    );
    await expect
      .poll(() => /\d+ episodes?/.test(host.textContent ?? ''), { timeout: 60_000 })
      .toBe(true);
    await expect.poll(() => reports.at(-1)).toBe(0);
    // Keys wait for the episode's frames (no step while it loads).
    await expect
      .poll(
        () => host.querySelector<HTMLButtonElement>('button[aria-label="Play/pause"]')?.disabled,
      )
      .toBe(false);
    viewerRoot(host).focus();
    await press('j');
    await expect.poll(() => reports.at(-1), { timeout: 20_000 }).toBe(1);
    await press('k');
    await expect.poll(() => reports.at(-1), { timeout: 20_000 }).toBe(0);
    // With a modifier, J is not an episode step.
    await press('{Control>}j{/Control}');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(reports.at(-1)).toBe(0);
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
    // The outcome reads as text, not as disabled toggles (s10 F-16).
    const inspector = host.querySelector('[data-testid="lerobot-segment-inspector"]')!;
    expect(inspector.querySelectorAll('[role="radio"], [role="radiogroup"]')).toHaveLength(0);
    expect(inspector.querySelector('[data-field-value="outcome"]')?.textContent).toBe(
      'OutcomeFailure',
    );
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
