import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { type HostLog, press, seg, viewerRoot, waitForSegments } from './segmentHarness';
import { Host } from './SegmentHost';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

/** 360 frames at 30 fps: room for five segments in one episode. */
const FRAME_CODED = '/tests/fixtures/static/frame-coded-v3';

/**
 * One focus-recovery rule (useFocusRecovery) for every path that removes or
 * disables the focused control. In the cross-browser smoke too: Chromium
 * recovers on focusout, Firefox only through the MutationObserver.
 */
describe('focus stays in the viewer when the focused control goes away (s10 F-01)', () => {
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

  const rows = () =>
    Array.from(
      host.querySelectorAll<HTMLButtonElement>('[data-testid="lerobot-segment-list"] li > button'),
    );
  const inspectorText = () =>
    host.querySelector('[data-testid="lerobot-segment-inspector"]')?.textContent ?? '';
  const inspectorButton = (label: string) =>
    host.querySelector<HTMLButtonElement>(
      `[data-testid="lerobot-segment-inspector"] button[title^="${label} ("]`,
    )!;
  const focusInViewer = () => viewerRoot(host).contains(document.activeElement);
  const three = () => ({
    episodes: {
      0: {
        segments: [
          seg('a', 0, 0, { review: 'confirmed', origin: { kind: 'manual' } }),
          seg('b', 1, 1, { review: 'confirmed', origin: { kind: 'manual' } }),
          seg('c', 2, 2, { review: 'confirmed', origin: { kind: 'manual' } }),
        ],
      },
    },
  });

  it('R on a clicked list row: focus moves to the next row; J and Ctrl+Z work at once', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(<Host log={log} initial={three()} />);
    await waitForSegments(host);
    await userEvent.click(rows()[0]!);
    await expect.poll(inspectorText).toContain('#1');
    await press('r');
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(2);
    // The next row (b, now #1) has focus, inside the viewer.
    await expect.poll(focusInViewer).toBe(true);
    expect(document.activeElement).toBe(rows()[0]);
    await press('j');
    await expect.poll(inspectorText).toContain('#2');
    await press('{Control>}z{/Control}');
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(3);
    expect(log.changes.at(-1)?.op).toBe('restore');
  });

  it('the last row deleted by the Delete button: focus goes to the previous row, then to the viewer', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(<Host log={log} initial={three()} />);
    await waitForSegments(host);
    // The last row: no next one, so the previous one takes focus.
    await userEvent.click(rows()[2]!);
    await expect.poll(inspectorText).toContain('#3');
    rows()[2]!.focus();
    await press('r');
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(2);
    await expect.poll(() => document.activeElement).toBe(rows()[1]);
    // The Delete button itself goes away with the last segment: the viewer root keeps focus.
    await press('r');
    await press('r');
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(0);
    expect(focusInViewer() || document.activeElement === viewerRoot(host)).toBe(true);
    await press('{Control>}z{/Control}');
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(1);
    // And through the button: select it, press Delete, keys still reach the viewer.
    await userEvent.click(rows()[0]!);
    await userEvent.click(inspectorButton('Delete'));
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(0);
    await expect
      .poll(() => document.activeElement === viewerRoot(host) || focusInViewer())
      .toBe(true);
    await press('{Control>}z{/Control}');
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(1);
  });

  it('a merge that removes the focused row keeps keys working; the Merge button keeps focus', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(<Host log={log} initial={three()} />);
    await waitForSegments(host);
    // Focus on row b, selection on a: M merges b into a and removes the focused row.
    await userEvent.click(rows()[1]!);
    await expect.poll(inspectorText).toContain('#2');
    await press('k');
    await expect.poll(inspectorText).toContain('#1');
    await press('m');
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(2);
    await expect.poll(() => document.activeElement).toBe(rows()[1]);
    await press('{Control>}z{/Control}');
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(3);
    expect(log.changes.at(-1)?.op).toBe('unmerge');
    // Merge with next by the button: the button stays, and so does focus.
    await userEvent.click(rows()[0]!);
    await userEvent.click(inspectorButton('Merge with next'));
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(2);
    expect(document.activeElement).toBe(inspectorButton('Merge with next'));
    await press('{Control>}z{/Control}');
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(3);
  });

  it('a host removal and an undo that remove the focused row keep focus on the list', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        initial={{
          episodes: {
            0: {
              segments: [
                seg('a', 0, 0, { review: 'confirmed', origin: { kind: 'manual' } }),
                seg('b', 1, 1, { review: 'confirmed', origin: { kind: 'manual' } }),
              ],
            },
          },
        }}
      />,
    );
    await waitForSegments(host);
    // G then N adds a segment on the uncovered frame; its row gets focus by a click.
    await press('g');
    await press('n');
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(3);
    await userEvent.click(rows()[2]!);
    // Undo removes the focused row: the previous row takes focus.
    await press('{Control>}z{/Control}');
    await expect.poll(() => log.value().episodes[0].segments.length).toBe(2);
    await expect.poll(() => document.activeElement).toBe(rows()[1]);
    // The host removes the focused segment (Exclude or delete from its own list).
    await userEvent.click(rows()[0]!);
    log.setValue!({
      episodes: {
        0: { segments: [seg('b', 1, 1, { review: 'confirmed', origin: { kind: 'manual' } })] },
      },
    });
    await expect.poll(() => rows().length).toBe(1);
    await expect.poll(() => document.activeElement).toBe(rows()[0]);
    // Keys reach the viewer at once: J selects the remaining segment.
    await press('j');
    await expect.poll(inspectorText).toContain('#1');
  });

  it('a button disabled under focus (Confirm once confirmed) leaves focus in the viewer', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        initial={{ episodes: { 0: { segments: [seg('a', 0, 0), seg('b', 1, 2)] } } }}
      />,
    );
    await waitForSegments(host);
    await userEvent.click(rows()[1]!);
    await expect.poll(inspectorText).toContain('#2');
    await userEvent.click(inspectorButton('Confirm'));
    await expect.poll(() => inspectorButton('Confirm').disabled).toBe(true);
    await expect.poll(focusInViewer).toBe(true);
    await press('k');
    await expect.poll(inspectorText).toContain('#1');
  });

  it('a person who left the viewer is never pulled back (focus row, outside control, both removed)', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    const outside = document.createElement('button');
    outside.textContent = 'Host control';
    document.body.append(outside);
    root.render(<Host log={log} initial={three()} />);
    await waitForSegments(host);
    await userEvent.click(rows()[0]!);
    // Focus leaves the viewer for a host control, which then goes away (focus on <body>).
    outside.focus();
    expect(document.activeElement).toBe(outside);
    outside.remove();
    expect(viewerRoot(host).contains(document.activeElement)).toBe(false);
    // Later the host removes the row that had focus before: focus stays out of the viewer.
    log.setValue!({
      episodes: {
        0: {
          segments: [
            seg('b', 1, 1, { review: 'confirmed', origin: { kind: 'manual' } }),
            seg('c', 2, 2, { review: 'confirmed', origin: { kind: 'manual' } }),
          ],
        },
      },
    });
    await expect.poll(() => rows().length).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(viewerRoot(host).contains(document.activeElement)).toBe(false);
  });

  it('the place is kept current: rows a–e, focus c, the host removes a, then c → focus on d', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    const five = (ids: string[]) => ({
      episodes: {
        0: {
          segments: ids.map((id) => {
            const start = 'abcde'.indexOf(id) * 60;
            return seg(id, start, start + 59, { review: 'confirmed', origin: { kind: 'manual' } });
          }),
        },
      },
    });
    root.render(<Host log={log} dataset={FRAME_CODED} initial={five(['a', 'b', 'c', 'd', 'e'])} />);
    await waitForSegments(host);
    await expect.poll(() => rows().length).toBe(5);
    rows()[2]!.focus();
    log.setValue!(five(['b', 'c', 'd', 'e']));
    await expect.poll(() => rows().length).toBe(4);
    expect(document.activeElement).toBe(rows()[1]);
    log.setValue!(five(['b', 'd', 'e']));
    await expect.poll(() => rows().length).toBe(3);
    // d took c's place (index 1 after a went), not e (c's first index, 2).
    await expect.poll(() => document.activeElement).toBe(rows()[1]);
    // Row 2 now is d (frames 180–239: 0:06.00), the row after c.
    expect(rows()[1]!.getAttribute('aria-label')).toContain('0:06.00');
  });
});
