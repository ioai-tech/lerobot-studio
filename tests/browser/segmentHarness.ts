import { expect } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { AnnotationChange, AnnotationDocument, AnnotationField, Segment } from '@/core';
import { expectNoBlockingA11yViolations } from './a11y';

/** Shared helpers of the segment browser tests (the host component is `SegmentHost.tsx`). */
export const FIXTURE = '/tests/fixtures/datasets/lerobotv3';
export const LENGTHS = new Map([
  [0, 3],
  [1, 3],
]);
export const ctx = { episodeLength: (index: number) => LENGTHS.get(index) };

export const fields: AnnotationField[] = [
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

export function seg(
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

export type HostLog = {
  changes: AnnotationChange[];
  value: () => AnnotationDocument;
  /** Replace the host value (another writer saved). */
  setValue?: (doc: AnnotationDocument) => void;
};

/** Wait for the dataset and the segment UI, then make sure playback is paused so the playhead stays put. */
export async function waitForSegments(host: HTMLElement) {
  await expect
    .poll(() => host.querySelector('[data-testid="lerobot-segment-track"]'), { timeout: 60_000 })
    .not.toBeNull();
  const playButton = () =>
    host.querySelector<HTMLButtonElement>(
      'button.rounded-full:has(> svg.lucide-play, > svg.lucide-pause)',
    );
  await expect.poll(() => playButton()?.disabled, { timeout: 60_000 }).toBe(false);
  // Pause the way a person does, so autoplay stays off for this episode. A
  // Play icon alone is not "paused": autoplay may not have started yet, and
  // would start after this returns. So play first if needed, then pause.
  let pausedByClick = false;
  await expect
    .poll(
      () => {
        const button = playButton();
        if (button?.querySelector('.lucide-pause')) {
          button.click();
          pausedByClick = true;
          return false;
        }
        if (!pausedByClick) {
          button?.click();
          return false;
        }
        return button?.querySelector('.lucide-play') != null;
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
export async function selectWithKeys(host: HTMLElement, n: number) {
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

export function viewerRoot(host: HTMLElement) {
  return host.querySelector<HTMLElement>('.lerobot-root')!;
}

export async function press(keys: string) {
  await userEvent.keyboard(keys);
  await new Promise((resolve) => setTimeout(resolve, 30));
}

/** Axe on the segment UI this change adds (track, inspector, list). */
export async function expectSegmentUiAccessible(host: HTMLElement) {
  // A closing dialog keeps the rest of the page aria-hidden until it is gone.
  await expect.poll(() => document.querySelector('[data-aria-hidden="true"]')).toBeNull();
  for (const id of ['lerobot-segment-track', 'lerobot-segment-inspector', 'lerobot-segment-list']) {
    const element = host.querySelector(`[data-testid="${id}"]`);
    expect(element, id).not.toBeNull();
    await expectNoBlockingA11yViolations(element!);
  }
}

export function trackCount(host: HTMLElement) {
  return () =>
    host.querySelectorAll('[data-testid="lerobot-segment-track"] [role="listitem"]').length;
}

export function status(host: HTMLElement) {
  return host.querySelector('[data-testid="lerobot-segment-status"]')?.textContent ?? '';
}
