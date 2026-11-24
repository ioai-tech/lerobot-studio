import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { LeRobotSelection } from '@/contexts/hostTypes';
import { type HostLog, press, seg, status } from './segmentHarness';
import { Host } from './SegmentHost';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

/**
 * Walk 2026-11-23 on Studio 1.7.0: the review loop a person runs right after
 * the viewer opens. F-01: keys pressed before any click (focus on <body>) did
 * nothing. F-18: Confirm left the selection, details and playhead on the
 * confirmed episode the filter now hides, while focus jumped to the next row.
 */

const inspector = (host: HTMLElement) =>
  host.querySelector('[data-testid="lerobot-segment-inspector"]')?.textContent ?? '';

const playButton = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>('button[aria-label="Play/pause"]');

const isPlaying = (host: HTMLElement) => playButton(host)?.querySelector('.lucide-pause') != null;

/** Wait until the viewer is ready for keys, without touching it (focus stays on <body>). */
async function waitUntouched(host: HTMLElement) {
  await expect
    .poll(() => host.querySelector('[data-testid="lerobot-segment-track"]'), { timeout: 60_000 })
    .not.toBeNull();
  await expect.poll(() => playButton(host)?.disabled, { timeout: 60_000 }).toBe(false);
  // The viewer opens paused (s10): nothing plays and nothing was clicked.
  expect(isPlaying(host)).toBe(false);
  (document.activeElement as HTMLElement | null)?.blur?.();
  expect(document.activeElement).toBe(document.body);
}

describe('browser: the review loop (walk 2026-11-23)', () => {
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

  it('F-01: J, A and N work right after the viewer opens, before any click', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        initial={{ episodes: { 0: { segments: [seg('a', 0, 0), seg('b', 2, 2)] } } }}
      />,
    );
    await waitUntouched(host);
    // The hint the viewer shows names these keys.
    await expect
      .poll(() => inspector(host))
      .toContain('Press N to start one at the playhead, or J');
    await press('j');
    await expect.poll(() => inspector(host)).toContain('#1');
    await press('a');
    await expect.poll(() => log.changes[0]).toEqual({ op: 'confirm', episodeIndex: 0, ids: ['a'] });
    // A moved review on to #2 (frame 2); N on the uncovered frame between the two.
    await expect.poll(() => inspector(host)).toContain('#2');
    await press('{Home}');
    await press('{ArrowRight}');
    await press('n');
    await expect
      .poll(() => log.changes.find((change) => change.op === 'create'))
      .toMatchObject({ op: 'create', segment: { startFrame: 1, endFrame: 1 } });
    // Focus never moved into the viewer: the keys came from <body>.
    expect(document.activeElement).toBe(document.body);
  });

  it('F-01: a field or a focused control of the host page, and an open host dialog, keep their keys', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    const search = document.createElement('input');
    search.setAttribute('aria-label', 'host search');
    const button = document.createElement('button');
    button.textContent = 'host action';
    document.body.prepend(search, button);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    try {
      root.render(<Host log={log} initial={{ episodes: { 0: { segments: [seg('a', 0, 1)] } } }} />);
      await waitUntouched(host);
      search.focus();
      await press('j');
      button.focus();
      await press('j');
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(inspector(host)).not.toContain('#1');
      // A modal of the host page is open while focus is on <body>: its keys.
      document.body.append(dialog);
      button.blur();
      expect(document.activeElement).toBe(document.body);
      await press('j');
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(inspector(host)).not.toContain('#1');
      dialog.remove();
      await press('j');
      await expect.poll(() => inspector(host)).toContain('#1');
      expect(log.changes).toEqual([]);
    } finally {
      search.remove();
      button.remove();
      dialog.remove();
    }
  });

  it('a closed modal the host keeps mounted (hidden from people) does not take page keys; a shown one does', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    const selections: LeRobotSelection[] = [];
    root.render(
      <Host
        log={log}
        onSelectionChange={(selection) => selections.push(selection)}
        initial={{
          episodes: { 0: { segments: [seg('a', 0, 0), seg('b', 1, 1), seg('c', 2, 2)] } },
        }}
      />,
    );
    await waitUntouched(host);
    const selected = () => selections.at(-1)?.segmentId;
    const modal = '<div role="dialog" aria-modal="true" style="width:40px;height:40px">Menu</div>';
    /** Each hides its modal from people one way, as hosts keep a closed modal mounted. */
    const hidden: Record<string, string> = {
      // A keepMounted drawer: the closed modal root is aria-hidden and invisible,
      // its paper slid off screen (MUI Modal with keepMounted).
      'keepMounted drawer': `<div role="presentation" aria-hidden="true" style="position:fixed;inset:0;visibility:hidden"><div role="dialog" aria-modal="true" style="position:fixed;left:0;top:0;width:200px;height:100%;transform:translateX(-200px)">Nav</div></div>`,
      'aria-hidden subtree': `<div aria-hidden="true">${modal}</div>`,
      'display: none subtree': `<div style="display:none">${modal}</div>`,
      'inert subtree': `<div inert>${modal}</div>`,
      'visibility: hidden subtree': `<div style="visibility:hidden">${modal}</div>`,
      'hidden open dialog': '<dialog open hidden>Menu</dialog>',
    };
    const added: HTMLElement[] = [];
    const add = (html: string) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      document.body.append(wrapper);
      added.push(wrapper);
      return wrapper;
    };
    try {
      // J, J, J, K, K, J: a, b, c, b, a, b; one hidden modal more before each key.
      const steps: [string, string][] = [
        ['j', 'a'],
        ['j', 'b'],
        ['j', 'c'],
        ['k', 'b'],
        ['k', 'a'],
        ['j', 'b'],
      ];
      const kinds = Object.keys(hidden);
      for (const [index, [key, expected]] of steps.entries()) {
        add(hidden[kinds[index]!]!);
        expect(document.activeElement).toBe(document.body);
        await press(key);
        await expect.poll(selected, { message: kinds[index] }).toBe(expected);
      }
      // A modal a person can see still keeps its keys: an aria-modal dialog,
      // then an open (non-modal) <dialog>.
      const shown = add(modal);
      await press('k');
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(selected()).toBe('b');
      shown.remove();
      const dialog = add('<dialog>Menu</dialog>').querySelector('dialog')!;
      dialog.show();
      (document.activeElement as HTMLElement | null)?.blur?.();
      await press('k');
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(selected()).toBe('b');
      dialog.close();
      await press('k');
      await expect.poll(selected).toBe('a');
      expect(log.changes).toEqual([]);
    } finally {
      for (const element of added) element.remove();
    }
  });

  it('F-01: with two viewers on one page a key on <body> reaches one: the one opened or used last', async () => {
    const logA: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    const logB: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    host.style.cssText = 'width:1280px;height:900px;display:flex;flex-direction:column';
    const doc = { episodes: { 0: { segments: [seg('a', 0, 0), seg('b', 1, 2)] } } };
    function Two({ second }: { second: boolean }) {
      return (
        <>
          <div style={{ height: 450 }} data-testid="viewer-a">
            <Host log={logA} initial={doc} />
          </div>
          {second ? (
            <div style={{ height: 450 }} data-testid="viewer-b">
              <Host log={logB} initial={doc} />
            </div>
          ) : null}
        </>
      );
    }
    root.render(<Two second={false} />);
    const a = () => host.querySelector<HTMLElement>('[data-testid="viewer-a"]')!;
    const b = () => host.querySelector<HTMLElement>('[data-testid="viewer-b"]')!;
    await expect.poll(() => host.querySelector('[data-testid="viewer-a"]')).not.toBeNull();
    await waitUntouched(a());
    root.render(<Two second />);
    await expect.poll(() => host.querySelector('[data-testid="viewer-b"]')).not.toBeNull();
    await waitUntouched(b());
    // B opened last: it alone takes the key.
    await press('j');
    await expect.poll(() => inspector(b())).toContain('#1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(inspector(a())).not.toContain('#1');
    // A person uses A (a click in it), then focus returns to the page: A takes the keys.
    await userEvent.click(a().querySelector('[data-testid="lerobot-segment-progress"]')!);
    (document.activeElement as HTMLElement | null)?.blur?.();
    await press('j');
    await expect.poll(() => inspector(a())).toContain('#1');
    await press('a');
    await expect.poll(() => logA.changes.length).toBe(1);
    expect(logB.changes).toEqual([]);
    expect(inspector(b())).toContain('#1');
  });

  it('F-01: keyboardScope="viewer" takes only keys pressed inside the viewer', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        keyboardScope="viewer"
        initial={{ episodes: { 0: { segments: [seg('a', 0, 1)] } } }}
      />,
    );
    await waitUntouched(host);
    await press('j');
    await press(' ');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(inspector(host)).not.toContain('#1');
    expect(isPlaying(host)).toBe(false);
  });

  it('F-01: on <body>, Ctrl / Cmd / Alt combinations, IME composition and an editable page keep their keys', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(<Host log={log} initial={{ episodes: { 0: { segments: [seg('a', 0, 1)] } } }} />);
    await waitUntouched(host);
    const keydown = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    };
    // A host's own shortcut (Ctrl+K, Cmd+K) and the browser's (Alt+← back).
    expect(keydown({ key: 'k', code: 'KeyK', ctrlKey: true })).toBe(false);
    expect(keydown({ key: 'k', code: 'KeyK', metaKey: true })).toBe(false);
    expect(keydown({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true })).toBe(false);
    expect(keydown({ key: 'j', code: 'KeyJ', ctrlKey: true })).toBe(false);
    // A key that composes text (IME) is the composition's.
    expect(keydown({ key: 'j', code: 'KeyJ', isComposing: true })).toBe(false);
    // A page that is being edited keeps every key.
    document.body.contentEditable = 'true';
    try {
      expect(keydown({ key: 'j', code: 'KeyJ' })).toBe(false);
    } finally {
      document.body.removeAttribute('contenteditable');
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(inspector(host)).not.toContain('#1');
    // The plain key on the page still reaches the viewer.
    expect(keydown({ key: 'j', code: 'KeyJ' })).toBe(true);
    await expect.poll(() => inspector(host)).toContain('#1');
    expect(log.changes).toEqual([]);
  });

  it('F-18: A confirms and moves selection, details, playhead and focus to the next episode to review', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    const selections: LeRobotSelection[] = [];
    root.render(
      <Host
        log={log}
        onSelectionChange={(selection) => selections.push(selection)}
        initial={{
          episodes: {
            0: { segments: [seg('a', 0, 0), seg('b', 1, 1), seg('c', 2, 2)] },
          },
        }}
      />,
    );
    await waitUntouched(host);
    const list = () => host.querySelector('[data-testid="lerobot-segment-list"]')!;
    await expect.poll(() => list().querySelector('[role="radio"]')).not.toBeNull();
    await userEvent.click(page.getByRole('radio', { name: /To review/ }));
    const row = (id: string) =>
      list().querySelector<HTMLButtonElement>(`button[data-segment-id="${id}"]`);
    await userEvent.click(row('a')!);
    await expect.poll(() => inspector(host)).toContain('#1');
    expect(document.activeElement).toBe(row('a'));
    await press('a');

    await expect.poll(() => inspector(host)).toContain('#2');
    expect(row('a')).toBeNull();
    expect(row('b')?.getAttribute('aria-current')).toBe('true');
    await expect.poll(() => document.activeElement).toBe(row('b'));
    expect(isPlaying(host)).toBe(false);
    await expect.poll(() => selections.at(-1)).toMatchObject({ segmentId: 'b', timeS: 0.1 });
    expect(status(host)).toContain('Confirmed 1 segment.');
    expect(status(host)).toContain('Next to review: #2.');

    // The last one to review wraps to none left: said so, nothing hidden is selected.
    await press('a');
    await expect.poll(() => inspector(host)).toContain('#3');
    await expect.poll(() => document.activeElement).toBe(row('c'));
    await press('a');
    await expect.poll(() => status(host)).toContain('Nothing to review in this filter.');
    expect(log.changes.map((change) => change.op === 'confirm' && change.ids)).toEqual([
      ['a'],
      ['b'],
      ['c'],
    ]);
  });

  it('F-18: J / K step through the episodes the filter shows, never onto a hidden one', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        initial={{
          episodes: {
            0: {
              segments: [seg('a', 0, 0), seg('b', 1, 1, { review: 'confirmed' }), seg('c', 2, 2)],
            },
          },
        }}
      />,
    );
    await waitUntouched(host);
    await userEvent.click(page.getByRole('radio', { name: /To review/ }));
    (document.activeElement as HTMLElement | null)?.blur?.();
    await press('j');
    await expect.poll(() => inspector(host)).toContain('#1');
    await press('j');
    // #2 is confirmed and hidden by To review: J goes on to #3.
    await expect.poll(() => inspector(host)).toContain('#3');
    await press('k');
    await expect.poll(() => inspector(host)).toContain('#1');
  });

  it('F-04: a suggestion says what its number is, and a confirmed row no longer repeats it', async () => {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        initial={{
          episodes: {
            0: {
              segments: [
                seg('a', 0, 0, { origin: { kind: 'suggested', confidence: 0.25 } }),
                seg('b', 1, 2, {
                  origin: { kind: 'suggested', confidence: 0.25 },
                  review: 'confirmed',
                }),
              ],
            },
          },
        }}
      />,
    );
    await waitUntouched(host);
    const rowText = (id: string) =>
      host.querySelector(`[data-testid="lerobot-segment-list"] button[data-segment-id="${id}"]`)
        ?.textContent ?? '';
    await expect.poll(() => rowText('a')).toContain('Suggested · 25% confidence');
    expect(rowText('a')).not.toContain('0.25');
    expect(rowText('b')).not.toContain('Suggested');
    // The details still say who made it.
    await press('j');
    await press('j');
    await expect.poll(() => inspector(host)).toContain('#2');
    expect(inspector(host)).toContain('Suggested · 25% confidence');
  });
});
