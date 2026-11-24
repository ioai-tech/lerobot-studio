import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { LeRobotViewer, type LeRobotViewerProps } from '@/components/LeRobotViewer';
import type { AnnotationDocument, Segment, TimelineMarker } from '@/core';
import { FetchDataSource } from './fixtures';
import { expectNoBlockingA11yViolations } from './a11y';
import { type HostLog, press, seg } from './segmentHarness';
import { Host } from './SegmentHost';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

/**
 * Host APIs asked for by an embedding console (viewer walk 2, 2026-11-23):
 * navigable marker rows (F-03: walk 39 possible faces one by one), display
 * hints for a task or subtask label in another language (F-05), camera
 * display names (F-19).
 */

// Committed: 360 frames at 30 fps, cameras observation.images.cam0 / cam1.
const FRAME_CODED = '/tests/fixtures/static/frame-coded-v3';

let host: HTMLDivElement;
let root: Root;

async function mount(element: React.ReactElement, width = 1280, height = 800) {
  await page.viewport(width, height);
  host = document.createElement('div');
  host.style.cssText = `width:${width}px;height:${height}px`;
  document.body.style.margin = '0';
  document.body.append(host);
  root = createRoot(host);
  root.render(element);
}

function viewer(props: Partial<LeRobotViewerProps> = {}) {
  return <LeRobotViewer dataSource={new FetchDataSource(FRAME_CODED)} language="en" {...props} />;
}

const slider = () => host.querySelector<HTMLElement>('[role="slider"]')!;
const sliderFrame = () => Number(slider()?.getAttribute('aria-valuenow'));
const playButton = () => host.querySelector<HTMLButtonElement>('button[aria-label="Play/pause"]');
const isPlaying = () => playButton()?.querySelector('.lucide-pause') != null;
const rows = () => [...host.querySelectorAll<HTMLElement>('[data-testid="lerobot-marker-lane"]')];
const facesHeader = () => host.querySelector<HTMLElement>('[data-marker-lane="faces"]')!;
const position = () =>
  facesHeader().querySelector('[data-testid="lerobot-marker-lane-position"]')?.textContent ?? '';
const announced = () => facesHeader().querySelector('[role="status"]')?.textContent ?? '';

async function ready() {
  await expect.poll(() => playButton()?.disabled, { timeout: 60_000 }).toBe(false);
  await expect.poll(() => host.querySelectorAll('video').length, { timeout: 60_000 }).toBe(2);
  await expect
    .poll(() => {
      if (isPlaying()) playButton()!.click();
      return !isPlaying();
    })
    .toBe(true);
}

/** Focus on the page itself, as right after the viewer opens. */
function onPage() {
  (document.activeElement as HTMLElement | null)?.blur?.();
  expect(document.activeElement).toBe(document.body);
}

const next = () => press('{Shift>}.{/Shift}');
const previous = () => press('{Shift>},{/Shift}');

function m(id: string, startFrame: number, extra: Partial<TimelineMarker> = {}): TimelineMarker {
  return {
    id,
    episodeIndex: 0,
    startFrame,
    endFrame: startFrame + 2,
    severity: 'warn',
    label: `Possible face · ${id}`,
    ...extra,
  };
}

// Two faces on frame 180 (two cameras, one frame): each is visited.
const MARKERS: TimelineMarker[] = [
  m('idle', 10, { severity: 'info', label: 'Idle' }),
  m('f1', 60, { lane: 'faces' }),
  m('check', 120, { lane: 'checks', severity: 'fail', label: 'Joint jump' }),
  m('f2', 180, { lane: 'faces' }),
  m('f3', 180, { lane: 'faces' }),
  m('f4', 300, { lane: 'faces' }),
];
const LANES = [
  { id: 'faces', label: 'Possible faces', navigable: true },
  { id: 'checks', label: 'Checks' },
];

beforeEach(() => {
  document.body.style.margin = '0';
});

afterEach(() => {
  root?.unmount();
  host?.remove();
});

describe('browser: navigable marker rows (markerLanes)', () => {
  it('rows are drawn top to bottom, each named, with the default row last as before', async () => {
    await mount(viewer({ markers: MARKERS, markerLanes: LANES }));
    await ready();
    expect(rows().map((row) => row.getAttribute('aria-label'))).toEqual([
      'Possible faces',
      'Checks',
      'Markers',
    ]);
    expect(rows().map((row) => [...row.querySelectorAll('[data-marker-id]')].length)).toEqual([
      4, 1, 1,
    ]);
    expect(facesHeader().textContent).toContain('Possible faces');
    // Only the navigable row has a position and buttons.
    expect(position()).toBe('– / 4');
    expect(host.querySelector('[data-marker-lane="checks"] button[aria-label^="Next"]')).toBeNull();
    // Every row keeps the shared time axis.
    const track = slider().getBoundingClientRect();
    const tick = host.querySelector('[data-marker-id="f4"]')!.getBoundingClientRect();
    expect(tick.left).toBeCloseTo(track.left + (300 / 360) * track.width, 0);
    await expectNoBlockingA11yViolations(facesHeader());
  });

  it('Shift+. / Shift+, from the page walk every marker of the row, paused, and announce "n of N"', async () => {
    await mount(viewer({ markers: MARKERS, markerLanes: LANES }));
    await ready();
    onPage();

    await next();
    await expect.poll(sliderFrame).toBe(60);
    expect(announced()).toBe('Possible faces 1 of 4');
    expect(position()).toBe('1 / 4');
    await next();
    await expect.poll(sliderFrame).toBe(180);
    expect(announced()).toBe('Possible faces 2 of 4');
    // The second face on the same frame is its own stop.
    await next();
    await expect.poll(announced).toBe('Possible faces 3 of 4');
    expect(sliderFrame()).toBe(180);
    expect(position()).toBe('3 / 4');
    await next();
    await expect.poll(sliderFrame).toBe(300);
    expect(announced()).toBe('Possible faces 4 of 4');
    // At the end it says so and stays.
    await next();
    await expect.poll(announced).toBe('Possible faces: no later marker');
    expect(sliderFrame()).toBe(300);
    expect(position()).toBe('4 / 4');

    await previous();
    await expect.poll(sliderFrame).toBe(180);
    expect(announced()).toBe('Possible faces 3 of 4');
    expect(isPlaying()).toBe(false);
  });

  it('a step while playing pauses on the marker; the keys also work from inside the viewer', async () => {
    await mount(viewer({ markers: MARKERS, markerLanes: LANES }));
    await ready();
    // Focus on the slider (a widget that owns the arrows, not these keys).
    slider().focus();
    await press('{Home}');
    playButton()!.click();
    await expect.poll(isPlaying).toBe(true);
    await next();
    await expect.poll(isPlaying).toBe(false);
    await expect.poll(sliderFrame).toBe(60);
    expect(document.activeElement).toBe(slider());
    expect(announced()).toBe('Possible faces 1 of 4');
  });

  it('the header buttons step the same way and say which row and key they use', async () => {
    await mount(viewer({ markers: MARKERS, markerLanes: LANES }));
    await ready();
    const nextButton = facesHeader().querySelector<HTMLButtonElement>(
      'button[aria-label="Next in Possible faces"]',
    )!;
    const previousButton = facesHeader().querySelector<HTMLButtonElement>(
      'button[aria-label="Previous in Possible faces"]',
    )!;
    expect(nextButton.type).toBe('button');
    expect(nextButton.title).toBe('Next in Possible faces (Shift+.)');
    expect(previousButton.title).toBe('Previous in Possible faces (Shift+,)');
    nextButton.click();
    await expect.poll(sliderFrame).toBe(60);
    nextButton.click();
    await expect.poll(sliderFrame).toBe(180);
    previousButton.click();
    await expect.poll(sliderFrame).toBe(60);
    expect(announced()).toBe('Possible faces 1 of 4');
    // A playhead moved elsewhere no longer claims a place.
    slider().focus();
    await press('{ArrowRight}');
    await expect.poll(position).toBe('– / 4');
  });

  it('without markerLanes, markers keep one row and Shift+. is not taken', async () => {
    let defaultPrevented: boolean | null = null;
    const listener = (event: KeyboardEvent) => {
      if (event.code === 'Period') defaultPrevented = event.defaultPrevented;
    };
    await mount(viewer({ markers: MARKERS }));
    await ready();
    expect(rows().map((row) => row.getAttribute('aria-label'))).toEqual(['Markers']);
    expect(rows()[0].querySelectorAll('[data-marker-id]')).toHaveLength(6);
    onPage();
    document.addEventListener('keydown', listener);
    try {
      await next();
    } finally {
      document.removeEventListener('keydown', listener);
    }
    expect(defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sliderFrame()).toBe(0);
  });
});

describe('browser: display hints (taskHint, labelHint)', () => {
  const hinted = (extra: Partial<Segment> = {}) =>
    seg('a', 0, 2, {
      review: 'to_review',
      taskHint: 'Fold the white towel',
      subtasks: [{ startFrame: 0, endFrame: 1, label: '', labelHint: 'grasp' }],
      ...extra,
    });

  it('a hint is shown muted in the row, the subtask track and as the placeholder, never as data', async () => {
    const initial: AnnotationDocument = { episodes: { 0: { segments: [hinted()] } } };
    const log: HostLog = { changes: [], value: () => initial };
    await mount(<Host initial={initial} log={log} />, 1280, 900);
    const list = () => host.querySelector('[data-testid="lerobot-segment-list"]');
    await expect.poll(() => list()?.textContent ?? '', { timeout: 60_000 }).toContain('Fold');
    const rowHint = list()!.querySelector('[data-task-hint]')!;
    expect(rowHint.textContent).toBe('Fold the white towel');
    expect(rowHint.className).toContain('text-muted-foreground');
    expect(list()!.textContent).not.toContain('Episode task');
    const subtaskHint = host.querySelector('[aria-label="Subtasks"] [data-label-hint]');
    expect(subtaskHint?.textContent).toBe('grasp');

    // Select it: the task input is empty, the hint is its placeholder.
    list()!.querySelector<HTMLElement>('[data-segment-id="a"]')!.click();
    const input = () =>
      host.querySelector<HTMLInputElement>(
        '[data-testid="lerobot-segment-inspector"] input[placeholder="Fold the white towel"]',
      );
    await expect.poll(() => input(), { timeout: 10_000 }).not.toBeNull();
    expect(input()!.value).toBe('');

    // Typing writes exactly what was typed.
    await userEvent.click(input()!);
    await userEvent.keyboard('叠毛巾');
    await press('{Enter}');
    await expect.poll(() => log.changes.length).toBeGreaterThan(0);
    expect(log.changes[0]).toEqual({
      op: 'update',
      episodeIndex: 0,
      id: 'a',
      patch: { task: '叠毛巾' },
    });
    // A delete and its undo send the whole segment back: without hints.
    host.querySelector<HTMLElement>('.lerobot-root')!.focus();
    await press('r');
    await expect.poll(() => log.changes.some((change) => change.op === 'delete')).toBe(true);
    await press('{Control>}z{/Control}');
    await expect.poll(() => log.changes.some((change) => change.op === 'restore')).toBe(true);
    const sent = JSON.stringify(log.changes);
    expect(sent).not.toContain('Hint');
    expect(sent).not.toContain('Fold');
    expect(sent).not.toContain('grasp');
  });
});

describe('browser: camera display names (cameraLabels)', () => {
  const titles = () =>
    [...host.querySelectorAll<HTMLElement>('.panel-title-text')].map((el) => el.textContent);

  it("panels use the host's name; the key stays in the tooltip and technical details", async () => {
    await mount(viewer({ cameraLabels: { 'observation.images.cam0': 'Head camera' } }));
    await ready();
    await expect.poll(titles).toEqual(expect.arrayContaining(['Head camera', 'cam1']));
    const head = [...host.querySelectorAll<HTMLElement>('.panel-title-text')].find(
      (el) => el.textContent === 'Head camera',
    )!;
    expect(head.title).toBe('Head camera · observation.images.cam0');
    const cam1 = [...host.querySelectorAll<HTMLElement>('.panel-title-text')].find(
      (el) => el.textContent === 'cam1',
    )!;
    expect(cam1.title).toBe('cam1');
    const details = () => [...host.querySelectorAll('dd')].map((dd) => dd.textContent);
    await expect.poll(details, { timeout: 30_000 }).toContain('observation.images.cam0');
    expect(details()).not.toContain('observation.images.cam1');

    // New labels rename the shown panels in place: the cameras stay mounted.
    const videos = [...host.querySelectorAll('video')];
    root.render(viewer({ cameraLabels: { 'observation.images.cam0': 'Front' } }));
    await expect.poll(titles).toEqual(expect.arrayContaining(['Front', 'cam1']));
    expect([...host.querySelectorAll('video')]).toEqual(videos);
  });

  it('without labels, cameras keep the last part of their key', async () => {
    await mount(viewer());
    await ready();
    await expect.poll(titles).toEqual(expect.arrayContaining(['cam0', 'cam1']));
    const details = [...host.querySelectorAll('dd')].map((dd) => dd.textContent);
    expect(details).not.toContain('observation.images.cam0');
  });
});
