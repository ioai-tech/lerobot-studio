import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { LeRobotViewer, type LeRobotViewerProps } from '@/components/LeRobotViewer';
import type { LeRobotNotice, LeRobotSelection } from '@/contexts/hostTypes';
import { cameraAreaHeight, type AnnotationDocument, type Segment } from '@/core';
import { FetchDataSource } from './fixtures';
import { expectNoBlockingA11yViolations } from './a11y';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

// Committed, not generated: 360 frames at 30 fps, two frame-coded cameras.
const FRAME_CODED = '/tests/fixtures/static/frame-coded-v3';
const FPS = 30;
const FRAMES = 360;

/** The frame-coded dataset with a third camera (cam0's video under another key). */
class ThreeCameras extends FetchDataSource {
  constructor() {
    super(FRAME_CODED);
  }
  private map(path: string) {
    return path.replace('observation.images.cam2', 'observation.images.cam0');
  }
  override async readText(path: string) {
    const text = await super.readText(this.map(path));
    if (path !== 'meta/info.json') return text;
    const info = JSON.parse(text);
    info.features['observation.images.cam2'] = info.features['observation.images.cam0'];
    return JSON.stringify(info);
  }
  override readBytes(path: string) {
    return super.readBytes(this.map(path));
  }
  override getObjectUrl(path: string) {
    return super.getObjectUrl(this.map(path));
  }
  override exists(path: string) {
    return super.exists(this.map(path));
  }
}

function seg(id: string, startFrame: number, endFrame: number, extra: Partial<Segment> = {}) {
  return {
    id,
    startFrame,
    endFrame,
    task: null,
    subtasks: [],
    values: {},
    review: 'to_review',
    origin: { kind: 'suggested', confidence: 0.8 },
    ...extra,
  } as Segment;
}

const DOC: AnnotationDocument = {
  episodes: {
    0: {
      segments: [
        seg('a', 0, 119, { subtasks: [{ startFrame: 60, endFrame: 119, label: 'reach' }] }),
        seg('b', 120, 239),
        seg('c', 240, 359),
      ],
    },
  },
};

let host: HTMLDivElement;
let root: Root;

async function mount(width: number, height: number, element: React.ReactElement) {
  await page.viewport(width, height);
  host = document.createElement('div');
  host.style.cssText = `width:${width}px;height:${height}px`;
  document.body.style.margin = '0';
  document.body.append(host);
  root = createRoot(host);
  root.render(element);
}

const videos = () => Array.from(host.querySelectorAll('video'));
const slider = () => host.querySelector<HTMLElement>('[role="slider"]')!;
const playButton = () =>
  host.querySelector<HTMLButtonElement>('button[aria-label="Play/pause"]') ?? null;
const isPlaying = () => playButton()?.querySelector('.lucide-pause') != null;
const sliderFrame = () => Number(slider()?.getAttribute('aria-valuenow'));
const cameraFrames = () => videos().map((v) => Math.floor(v.currentTime * FPS + 1e-3));

async function videosReady(count: number) {
  await expect.poll(() => videos().length, { timeout: 60_000 }).toBe(count);
  await expect
    .poll(() => videos().every((v) => v.readyState >= 2 && !v.seeking), { timeout: 60_000 })
    .toBe(true);
}

/** Stop autoplay and wait until every camera rests. */
async function pause() {
  await expect.poll(() => playButton()?.disabled, { timeout: 60_000 }).toBe(false);
  await expect
    .poll(
      () => {
        if (isPlaying()) playButton()!.click();
        return !isPlaying();
      },
      { timeout: 30_000, interval: 200 },
    )
    .toBe(true);
  await expect.poll(() => videos().every((v) => v.paused && !v.seeking)).toBe(true);
}

async function seekTo(frame: number) {
  slider().focus();
  await userEvent.keyboard('{Home}');
  for (let i = 0; i < Math.floor(frame / 10); i++) await userEvent.keyboard('{PageUp}');
  for (let i = 0; i < frame % 10; i++) await userEvent.keyboard('{ArrowRight}');
  await expect.poll(sliderFrame).toBe(frame);
}

function viewer(props: Partial<LeRobotViewerProps> = {}) {
  return <LeRobotViewer dataSource={new FetchDataSource(FRAME_CODED)} language="en" {...props} />;
}

beforeEach(() => {
  document.body.style.margin = '0';
});

afterEach(() => {
  root?.unmount();
  host?.remove();
});

describe('browser: embedding — selection', () => {
  it('a deep link to segmentId + timeS lands paused on that frame, cameras included', async () => {
    const reports: LeRobotSelection[] = [];
    await mount(
      1280,
      800,
      viewer({
        annotation: { value: DOC },
        initialSelection: { segmentId: 'b', timeS: 5 },
        onSelectionChange: (selection) => reports.push(selection),
      }),
    );
    await videosReady(2);
    await expect.poll(sliderFrame, { timeout: 30_000 }).toBe(150);
    // Never autoplayed past the link.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(isPlaying()).toBe(false);
    expect(sliderFrame()).toBe(150);
    await expect.poll(() => videos().every((v) => !v.seeking)).toBe(true);
    expect(cameraFrames()).toEqual([150, 150]);
    expect(host.querySelector('[data-testid="lerobot-segment-inspector"]')?.textContent).toContain(
      '#2',
    );
    // Reports start at the landing, never at frame 0 of the default opening.
    await expect.poll(() => reports.at(-1)).toEqual({ episodeIndex: 0, segmentId: 'b', timeS: 5 });
    // The first report is the landing itself: never the segment's start, or no segment.
    expect(reports[0]).toEqual({ episodeIndex: 0, segmentId: 'b', timeS: 5 });
  });

  it('a deep link into a later episode lands on its time inside the segment, and reports it', async () => {
    const reports: LeRobotSelection[] = [];
    // Two three-frame episodes at 10 fps; the segment covers episode 1's frames 1-2.
    const doc: AnnotationDocument = { episodes: { 1: { segments: [seg('x', 1, 2)] } } };
    await mount(
      1280,
      800,
      viewer({
        dataSource: new FetchDataSource('/tests/fixtures/datasets/lerobotv3'),
        annotation: { value: doc },
        initialSelection: { segmentId: 'x', timeS: 0.2 },
        onSelectionChange: (selection) => reports.push(selection),
      }),
    );
    await expect
      .poll(
        () =>
          host
            .querySelector('[aria-current="true"][aria-label^="Select Episode"]')
            ?.getAttribute('aria-label'),
        { timeout: 30_000 },
      )
      .toBe('Select Episode 1');
    await expect.poll(sliderFrame, { timeout: 30_000 }).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(sliderFrame()).toBe(2);
    expect(isPlaying()).toBe(false);
    expect(host.querySelector('[data-testid="lerobot-segment-inspector"]')?.textContent).toContain(
      '#1',
    );
    expect(reports.at(-1)).toEqual({ episodeIndex: 1, segmentId: 'x', timeS: 0.2 });
    expect(reports[0]).toEqual({ episodeIndex: 1, segmentId: 'x', timeS: 0.2 });
  });

  it('reports time at most four times a second while playing', async () => {
    const reports: Array<{ at: number; selection: LeRobotSelection }> = [];
    await mount(
      1280,
      800,
      viewer({
        onSelectionChange: (selection) => reports.push({ at: performance.now(), selection }),
      }),
    );
    await videosReady(2);
    await expect.poll(isPlaying, { timeout: 30_000 }).toBe(true);
    reports.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await pause();
    const playing = reports.filter((report, i) => i > 0 && report.at - reports[0]!.at < 2_000);
    expect(playing.length).toBeGreaterThan(3);
    expect(playing.length).toBeLessThanOrEqual(9);
    for (let i = 1; i < reports.length; i++) {
      expect(reports[i]!.at - reports[i - 1]!.at).toBeGreaterThanOrEqual(240);
    }
  });

  it('a data-source swap before the deep link lands still lands on the link', async () => {
    const view = (source: FetchDataSource) =>
      viewer({
        dataSource: source,
        annotation: { value: DOC },
        initialSelection: { segmentId: 'b', timeS: 5 },
      });
    await mount(1280, 800, view(new FetchDataSource(FRAME_CODED)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    root.render(view(new FetchDataSource(FRAME_CODED)));
    await videosReady(2);
    await expect.poll(sliderFrame, { timeout: 30_000 }).toBe(150);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(isPlaying()).toBe(false);
    expect(sliderFrame()).toBe(150);
  });

  it('a burst of seeks while paused ends with the final time reported (trailing report)', async () => {
    const reports: LeRobotSelection[] = [];
    await mount(1280, 800, viewer({ onSelectionChange: (selection) => reports.push(selection) }));
    await videosReady(2);
    await pause();
    slider().focus();
    await userEvent.keyboard('{Home}');
    await new Promise((resolve) => setTimeout(resolve, 400));
    // Three quick steps inside one 250 ms window: the last must still be reported.
    for (let i = 0; i < 3; i++) await userEvent.keyboard('{ArrowRight}');
    await expect.poll(sliderFrame).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(reports.at(-1)).toEqual({ episodeIndex: 0, segmentId: null, timeS: 3 / FPS });
  });

  it('swapping the data source on the same timeline keeps episode, segment and time', async () => {
    const reports: LeRobotSelection[] = [];
    const annotation = { value: DOC };
    const view = (source: FetchDataSource) =>
      viewer({
        dataSource: source,
        annotation,
        onSelectionChange: (selection) => reports.push(selection),
      });
    await mount(1280, 800, view(new FetchDataSource(FRAME_CODED)));
    await videosReady(2);
    await pause();
    host
      .querySelector<HTMLButtonElement>(
        '[data-testid="lerobot-segment-list"] li:nth-child(3) button',
      )!
      .click();
    await expect.poll(sliderFrame).toBe(240);
    await seekTo(277);
    const before = videos();
    const beforeUrls = before.map((video) => video.src);

    // Another rendition of the same frames (e.g. anonymized), as a new source:
    // the cameras stay mounted and load the new source's files in place.
    const inspector = () =>
      host.querySelector('[data-testid="lerobot-segment-inspector"]')?.textContent ?? '';
    let segmentDropped = false;
    const watch = window.setInterval(() => {
      if (!inspector().includes('#3')) segmentDropped = true;
    }, 10);
    root.render(view(new FetchDataSource(FRAME_CODED)));
    // The swap ends when every camera shows the new source's file, nothing held.
    const holding = () =>
      host.querySelector('[data-testid="video-hold-frame"][style*="block"]') !== null;
    await expect
      .poll(() => videos().every((video, index) => video.src !== beforeUrls[index]), {
        timeout: 30_000,
      })
      .toBe(true);
    await videosReady(2);
    await expect.poll(holding, { timeout: 5_000 }).toBe(false);
    window.clearInterval(watch);
    // The selected segment stays selected throughout (the same timeline).
    expect(segmentDropped).toBe(false);
    expect(videos().every((video, index) => video === before[index])).toBe(true);
    await expect.poll(sliderFrame, { timeout: 30_000 }).toBe(277);
    await expect.poll(() => cameraFrames()).toEqual([277, 277]);
    expect(isPlaying()).toBe(false);
    expect(host.querySelector('[data-testid="lerobot-segment-inspector"]')?.textContent).toContain(
      '#3',
    );
    expect(reports.at(-1)).toEqual({ episodeIndex: 0, segmentId: 'c', timeS: 277 / FPS });
  });
});

describe('browser: embedding — host chrome', () => {
  it('cameras that go away stop loading their files', async () => {
    await mount(1280, 800, viewer({ dataSource: new FetchDataSource(FRAME_CODED) }));
    await videosReady(2);
    const cameras = videos();
    root.unmount();
    // Detached, they no longer hold a file (nor the connections reading it).
    await expect
      .poll(() =>
        cameras.map((video) => `${video.getAttribute('src') ?? ''}:${video.networkState}`),
      )
      .toEqual([`:${HTMLMediaElement.NETWORK_EMPTY}`, `:${HTMLMediaElement.NETWORK_EMPTY}`]);
    root = createRoot(host);
  });

  it('hiding and showing the viewer keeps its camera panels', async () => {
    await mount(1280, 800, viewer({ dataSource: new FetchDataSource(FRAME_CODED) }));
    await videosReady(2);
    const before = videos();
    host.style.display = 'none';
    await new Promise((resolve) => setTimeout(resolve, 300));
    host.style.display = '';
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(videos().every((video, index) => video === before[index] && video.isConnected)).toBe(
      true,
    );
  });

  it('notices with progress update without re-mounting the camera panels', async () => {
    const extensions = (progress: number) => [
      {
        id: 'host',
        toolbar: [
          {
            kind: 'button' as const,
            id: 'propose',
            label: 'Propose',
            icon: 'sparkles' as const,
            onSelect: () => undefined,
          },
        ],
        notices: [{ id: 'job', severity: 'info' as const, text: 'Proposing', progress }],
      },
    ];
    const dataSource = new FetchDataSource(FRAME_CODED);
    await mount(1280, 800, viewer({ dataSource, extensions: extensions(0.1) }));
    await videosReady(2);
    const before = videos();
    const bar = () => host.querySelector('[data-host-notice="job"] [role="progressbar"]');
    expect(bar()?.getAttribute('aria-valuenow')).toBe('10');
    for (const progress of [0.3, 0.6, 0.9]) {
      root.render(viewer({ dataSource, extensions: extensions(progress) }));
      await expect
        .poll(() => bar()?.getAttribute('aria-valuenow'))
        .toBe(String(Math.round(progress * 100)));
    }
    const after = videos();
    expect(after).toHaveLength(2);
    expect(after.every((video, i) => video === before[i] && video.isConnected)).toBe(true);
    await expectNoBlockingA11yViolations(
      host.querySelector<HTMLElement>('[data-testid="lerobot-host-chrome"]')!,
    );
  });

  it('markers put overlapping segments in Issues; the overlay band has its legend', async () => {
    await mount(
      1280,
      800,
      viewer({
        annotation: { value: DOC },
        markers: [
          {
            id: 'jump',
            episodeIndex: 0,
            startFrame: 130,
            endFrame: 140,
            severity: 'fail',
            label: 'Joint jump',
          },
          {
            id: 'idle',
            episodeIndex: 0,
            startFrame: 10,
            endFrame: 20,
            severity: 'info',
            label: 'Idle',
          },
        ],
        overlaySegments: [
          {
            episodeIndex: 0,
            segments: [
              {
                id: 'p',
                startFrame: 0,
                endFrame: 179,
                task: 'Fold',
                origin: { kind: 'suggested' },
              },
            ],
          },
        ],
        messages: { 'overlay.legend': 'Proposals in progress' },
      }),
    );
    await videosReady(2);
    await pause();
    await expect
      .poll(() => host.querySelector('[data-testid="lerobot-segment-list"]')?.textContent ?? '')
      .toContain('Issues 1');
    expect(host.querySelector('[data-testid="lerobot-overlay-band"]')?.textContent).toContain(
      'Proposals in progress',
    );
    await userEvent.click(
      page.getByRole('button', { name: 'Joint jump, Failure, 0:04.33–0:04.70' }),
    );
    await expect.poll(sliderFrame).toBe(130);
    await userEvent.click(page.getByRole('radio', { name: /Issues/ }));
    const rows = host.querySelectorAll('[data-testid="lerobot-segment-list"] li');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('1 issue');
    // The row's own label hides its content, so the issues are its description.
    const row = rows[0]!.querySelector('button')!;
    const description = (row.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(description).toContain('1 issue');
    expect(description).toContain('Joint jump');
  });

  it('theme tokens set the root variables, with dark overrides only in dark', async () => {
    const themeTokens = {
      primary: 'rgb(29, 78, 216)',
      radius: '4px',
      fontFamily: 'Georgia, serif',
      dark: { primary: 'rgb(147, 197, 253)' },
    };
    const dataSource = new FetchDataSource(FRAME_CODED);
    await mount(1024, 700, viewer({ dataSource, theme: 'light', themeTokens }));
    const viewerRoot = () => host.querySelector<HTMLElement>('.lerobot-root')!;
    await expect
      .poll(() => getComputedStyle(viewerRoot()).getPropertyValue('--primary').trim())
      .toBe('rgb(29, 78, 216)');
    expect(getComputedStyle(viewerRoot()).fontFamily).toContain('Georgia');
    await expect.poll(() => playButton() !== null, { timeout: 60_000 }).toBe(true);
    expect(getComputedStyle(playButton()!).backgroundColor).toBe('rgb(29, 78, 216)');
    root.render(viewer({ dataSource, theme: 'dark', themeTokens }));
    await expect
      .poll(() => getComputedStyle(viewerRoot()).getPropertyValue('--primary').trim())
      .toBe('rgb(147, 197, 253)');
    expect(viewerRoot().classList.contains('dark')).toBe(true);
    root.render(viewer({ dataSource, theme: 'dark' }));
    await expect.poll(() => viewerRoot().style.getPropertyValue('--primary')).toBe('');
  });
});

describe('browser: embedding — layout and time axis', () => {
  it('three cameras at 1440x900 with the sidebar and the segment editor get at least 360 px; charts take the rest', async () => {
    await mount(
      1440,
      900,
      <LeRobotViewer
        dataSource={new ThreeCameras()}
        language="en"
        annotation={{ value: DOC, onChange: () => undefined }}
      />,
    );
    await videosReady(3);
    // Camera content (video area under each panel title).
    await expect
      .poll(() => Math.min(...videos().map((video) => video.getBoundingClientRect().height)), {
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(360);
    const tops = videos().map((video) => Math.round(video.getBoundingClientRect().top));
    expect(new Set(tops).size).toBe(1);
    const chart = host.querySelector('[data-testid="chart-groups"]')!.getBoundingClientRect();
    expect(chart.height).toBeGreaterThan(100);
  });

  it('the camera rows take their height from the grid height, not the root width', async () => {
    await mount(1440, 900, <LeRobotViewer dataSource={new ThreeCameras()} language="en" />);
    await videosReady(3);
    const dock = () => host.querySelector<HTMLElement>('.dv-dockview')!.getBoundingClientRect();
    const groupOf = (element: Element) => element.closest('.dv-groupview')!.getBoundingClientRect();
    const expected = () => {
      const { width, height } = dock();
      return cameraAreaHeight({ height, width, rows: 1, perRow: 3, aspect: 4 / 3 });
    };
    await expect
      .poll(() => Math.abs(groupOf(videos()[0]).height - expected()), { timeout: 10_000 })
      .toBeLessThanOrEqual(2);
    // The chart panel (its charts, or their placeholders while loading).
    const chartPanel = () =>
      host.querySelector('[data-testid="chart-groups"], [data-testid="chart-groups-placeholder"]');
    await expect.poll(() => chartPanel() != null, { timeout: 30_000 }).toBe(true);
    const chart = groupOf(chartPanel()!);
    expect(Math.abs(chart.height - (dock().height - expected()))).toBeLessThanOrEqual(2);
  });

  it('a height-only change resizes the rows in place without re-mounting the cameras', async () => {
    await mount(1440, 900, <LeRobotViewer dataSource={new ThreeCameras()} language="en" />);
    await videosReady(3);
    const before = videos();
    const dock = () => host.querySelector<HTMLElement>('.dv-dockview')!.getBoundingClientRect();
    const groupHeight = () => before[0].closest('.dv-groupview')!.getBoundingClientRect().height;
    const expected = () => {
      const { width, height } = dock();
      return cameraAreaHeight({ height, width, rows: 1, perRow: 3, aspect: 4 / 3 });
    };
    await expect.poll(() => Math.abs(groupHeight() - expected())).toBeLessThanOrEqual(2);
    // Short enough that the charts' 200 px floor binds (not a proportional resize).
    const tallDock = dock().height;
    host.style.height = '560px';
    await expect.poll(() => dock().height).toBeLessThan(tallDock - 100);
    await expect
      .poll(() => Math.abs(groupHeight() - expected()), { timeout: 10_000 })
      .toBeLessThanOrEqual(2);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(videos().every((video, index) => video === before[index])).toBe(true);
    expect(before.every((video) => video.isConnected)).toBe(true);
  });

  it('a host notice appearing above the playback bar does not re-mount the cameras', async () => {
    const view = (notices: LeRobotNotice[]) => (
      <LeRobotViewer
        dataSource={stableThree}
        language="en"
        showSidebar={false}
        extensions={[{ id: 'host', notices }]}
      />
    );
    const stableThree = new ThreeCameras();
    await mount(1440, 900, view([]));
    await videosReady(3);
    const before = videos();
    root.render(view([{ id: 'n', severity: 'info', text: 'Working', progress: 'indeterminate' }]));
    await expect.poll(() => host.querySelector('[data-host-notice="n"]') != null).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(videos().every((video, index) => video === before[index])).toBe(true);
    expect(before.every((video) => video.isConnected)).toBe(true);
  });

  it('during playback the thumb and the fill sit at k / N of the frame shown', async () => {
    await mount(1280, 800, viewer());
    await videosReady(2);
    await expect.poll(isPlaying, { timeout: 30_000 }).toBe(true);
    const thumb = host.querySelector<HTMLElement>('[data-testid="playback-thumb"]')!;
    const fill = host.querySelector<HTMLElement>('[data-testid="playback-fill"]')!;
    const frameText = host.querySelector<HTMLElement>('[data-testid="playback-frame"]')!;
    let samples = 0;
    for (let i = 0; i < 12; i++) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const frame = Number(frameText.textContent);
      const left = Number(/calc\(([\d.]+)%/.exec(thumb.style.left)?.[1]);
      const scale = Number(/scaleX\(([\d.]+)\)/.exec(fill.style.transform)?.[1]);
      if (frame <= 0 || frame >= FRAMES - 1) continue;
      expect(left).toBeCloseTo((frame / FRAMES) * 100, 3);
      expect(scale).toBeCloseTo(frame / FRAMES, 5);
      samples += 1;
    }
    expect(samples).toBeGreaterThan(3);
  });

  it('at 1024x768 nothing in the playback bar overlaps or is cut off', async () => {
    await mount(
      1024,
      768,
      <LeRobotViewer
        dataSource={new ThreeCameras()}
        language="en"
        annotation={{ value: DOC, onChange: () => undefined }}
      />,
    );
    await videosReady(3);
    await pause();
    const bar = host.querySelector<HTMLElement>('[data-testid="lerobot-playback-bar"]')!;
    const barRect = bar.getBoundingClientRect();
    const controls = [
      ...bar.querySelectorAll<HTMLElement>('button'),
      ...bar.querySelectorAll<HTMLElement>('span.font-mono'),
    ].filter((el) => el.getBoundingClientRect().width > 0);
    expect(controls.length).toBeGreaterThan(6);
    for (const el of controls) {
      const rect = el.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(barRect.left - 0.5);
      expect(rect.right).toBeLessThanOrEqual(barRect.right + 0.5);
      expect(el.scrollWidth, el.textContent ?? '').toBeLessThanOrEqual(el.clientWidth + 1);
    }
    // The time readout stays on one line.
    const time = bar.querySelector<HTMLElement>('span.font-mono')!;
    expect(time.getBoundingClientRect().height).toBeLessThan(24);
    // Transport buttons never overlap each other.
    const transport = [...bar.querySelectorAll<HTMLElement>('button[aria-label]')]
      .slice(0, 5)
      .map((el) => el.getBoundingClientRect());
    for (let i = 1; i < transport.length; i++) {
      expect(transport[i]!.left).toBeGreaterThanOrEqual(transport[i - 1]!.right - 0.5);
    }
    // Inspector buttons do not overlap either.
    const inspectorButtons = [
      ...host.querySelectorAll<HTMLElement>('[data-testid="lerobot-segment-inspector"] button'),
    ].map((el) => el.getBoundingClientRect());
    for (let i = 0; i < inspectorButtons.length; i++) {
      for (let j = i + 1; j < inspectorButtons.length; j++) {
        const a = inspectorButtons[i]!;
        const b = inspectorButtons[j]!;
        const overlap =
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        expect(overlap).toBe(false);
      }
    }
  });

  it('one time axis: tracks, markers, overlay, slider and every chart put the playhead at the same place', async () => {
    const frames = [60, 180, 300];
    await mount(
      1440,
      900,
      viewer({
        annotation: { value: DOC },
        markers: frames.map((frame) => ({
          id: `m${frame}`,
          episodeIndex: 0,
          startFrame: frame,
          endFrame: frame + 5,
          severity: 'warn' as const,
          label: `m${frame}`,
        })),
        overlaySegments: [
          {
            episodeIndex: 0,
            segments: frames.map((frame) => ({
              id: `o${frame}`,
              startFrame: frame,
              endFrame: frame + 20,
              task: null,
              origin: { kind: 'suggested' as const },
            })),
          },
        ],
      }),
    );
    await videosReady(2);
    await pause();
    await expect
      .poll(() => host.querySelectorAll('[data-chart-playhead]').length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);
    const track = slider().getBoundingClientRect();
    const xOfFrame = (frame: number) => track.left + (frame / FRAMES) * track.width;

    for (const frame of frames) {
      // Lanes on the playback bar: the same left edge and scale as the slider.
      const marker = host.querySelector(`[data-marker-id="m${frame}"]`)!.getBoundingClientRect();
      const overlay = host.querySelector(`[data-overlay-id="o${frame}"]`)!.getBoundingClientRect();
      expect(marker.left).toBeCloseTo(xOfFrame(frame), 0);
      expect(overlay.left).toBeCloseTo(xOfFrame(frame), 0);
    }
    const segmentB = host
      .querySelector('[data-testid="lerobot-segment-track"] [role="listitem"]:nth-child(2)')!
      .getBoundingClientRect();
    expect(segmentB.left).toBeCloseTo(xOfFrame(120), 0);
    const subtask = [
      ...host.querySelectorAll<HTMLElement>('[aria-label="Subtasks"] [role="listitem"]'),
    ].find((el) => el.title.startsWith('reach'))!;
    expect(subtask.getBoundingClientRect().left).toBeCloseTo(xOfFrame(60), 0);

    for (const frame of frames) {
      await seekTo(frame);
      // Slider thumb centre.
      const thumb = slider().lastElementChild!.getBoundingClientRect();
      expect(thumb.left + thumb.width / 2).toBeCloseTo(xOfFrame(frame), 0);
      // Every chart: the playhead sits at the same fraction of its plot, and
      // all charts share one left edge.
      const playheads = [...host.querySelectorAll<HTMLElement>('[data-chart-playhead]')];
      const lefts = new Set<number>();
      for (const line of playheads) {
        const over = line.parentElement!.getBoundingClientRect();
        lefts.add(Math.round(over.left));
        const x = line.getBoundingClientRect().left + 1 - over.left;
        expect(x / over.width).toBeCloseTo(frame / FRAMES, 2);
      }
      expect(lefts.size).toBe(1);
    }
  });

  it('under 768 px editable annotation shows one line instead of edit controls; playback and lists work', async () => {
    await mount(700, 800, viewer({ annotation: { value: DOC, onChange: () => undefined } }));
    await videosReady(2);
    await pause();
    await expect
      .poll(() => host.querySelector('[data-testid="lerobot-narrow-editing"]')?.textContent)
      .toBe('Editing needs a wider window. Playback and the segment list still work.');
    const inspectorButtons = [
      ...host.querySelectorAll('[data-testid="lerobot-segment-inspector"] button'),
    ].map((button) => button.textContent ?? '');
    for (const name of [/^New/, /^Split/, /^Delete/, /^Confirm/, /^Merge/]) {
      expect(inspectorButtons.filter((text) => name.test(text))).toEqual([]);
    }
    host
      .querySelector<HTMLButtonElement>(
        '[data-testid="lerobot-segment-list"] li:nth-child(2) button',
      )!
      .click();
    await expect.poll(sliderFrame).toBe(120);
    // Edit keys stay off.
    host.querySelector<HTMLElement>('.lerobot-root')!.focus();
    await userEvent.keyboard('s');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(
      host.querySelectorAll('[data-testid="lerobot-segment-track"] [role="listitem"]'),
    ).toHaveLength(3);
    playButton()!.click();
    await expect.poll(isPlaying).toBe(true);
  });
});
