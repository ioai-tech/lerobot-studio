import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { FetchDataSource } from './fixtures';
import { HOLD_CAP_MS } from '@/components/panels/VideoPanel/VideoPanel';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

// Committed, not generated: two cameras, 360 frames.
const FRAME_CODED = '/tests/fixtures/static/frame-coded-v3';

const V3 = '/tests/fixtures/datasets/lerobotv3';

/** The same recording from another source (an anonymized copy, say), slow to open. */
class Slow extends FetchDataSource {
  readonly dataReads: string[] = [];
  constructor(
    base = FRAME_CODED,
    private readonly options: {
      infoMs?: number;
      dataMs?: number;
      failInfo?: boolean;
      video?: 'stall' | 'broken';
    } = {},
  ) {
    super(base);
  }
  override async readText(path: string) {
    if (path === 'meta/info.json') {
      await new Promise((resolve) => setTimeout(resolve, this.options.infoMs ?? 1000));
      if (this.options.failInfo) throw new Error('fetch meta/info.json -> 503');
    }
    return super.readText(path);
  }
  override async readBytes(path: string, onProgress?: Parameters<FetchDataSource['readBytes']>[1]) {
    if (path.startsWith('data/')) {
      this.dataReads.push('start');
      if (this.options.dataMs) {
        await new Promise((resolve) => setTimeout(resolve, this.options.dataMs));
      }
      this.dataReads.push('end');
    }
    return super.readBytes(path, onProgress);
  }
  override async getObjectUrl(path: string, mime?: string) {
    if (path.startsWith('videos/')) {
      // A URL that never delivers data (no metadata, no error), or one that is not a video.
      if (this.options.video === 'stall') return URL.createObjectURL(new MediaSource());
      if (this.options.video === 'broken') {
        return URL.createObjectURL(new Blob(['not a video'], { type: 'video/mp4' }));
      }
    }
    return super.getObjectUrl(path, mime);
  }
}
/** The earlier name, for the tests below. */
class SlowOpen extends Slow {
  constructor(failInfo = false) {
    super(FRAME_CODED, { failInfo });
  }
}

let host: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  vi.restoreAllMocks();
});

const slider = () =>
  host!.querySelector<HTMLElement>('[role="slider"][aria-label="Playback progress"]');
const videos = () => Array.from(host!.querySelectorAll('video'));
const holds = () =>
  Array.from(host!.querySelectorAll<HTMLElement>('[data-testid="video-hold-frame"]'));
const holding = () => holds().some((hold) => hold.style.display === 'block');
const playing = () => host!.querySelector('button[aria-label="Play/pause"] .lucide-pause') !== null;
const currentEpisode = () =>
  host!
    .querySelector('[aria-current="true"][aria-label^="Select Episode"]')
    ?.getAttribute('aria-label');

async function mount(element: React.ReactElement) {
  await page.viewport(1280, 800);
  host = document.createElement('div');
  host.style.cssText = 'width:1280px;height:800px';
  document.body.append(host);
  root = createRoot(host);
  root.render(element);
}

async function openAtFrame(frame: number) {
  await mount(
    <LeRobotViewer
      dataSource={new FetchDataSource(FRAME_CODED)}
      language="en"
      initialSelection={{ episodeIndex: 0, timeS: frame / 30 }}
    />,
  );
  await expect
    .poll(() => videos().length === 2 && videos().every((video) => paintsFrame(video)), {
      timeout: 30_000,
    })
    .toBe(true);
  await expect
    .poll(() => slider()?.getAttribute('aria-valuenow'), { timeout: 30_000 })
    .toBe(String(frame));
}

/** Whether the element paints a frame now (a video without data paints nothing). */
const probe = document.createElement('canvas');
probe.width = 8;
probe.height = 8;
const probeContext = probe.getContext('2d', { willReadFrequently: true })!;
function paintsFrame(video: HTMLVideoElement) {
  if (video.style.display === 'none') return false;
  probeContext.clearRect(0, 0, 8, 8);
  probeContext.drawImage(video, 0, 0, 8, 8);
  const pixels = probeContext.getImageData(0, 0, 8, 8).data;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! > 0) return true;
  return false;
}

/** Sample the view every frame until `done`: what a person would have seen. */
function watchView(done: () => boolean) {
  const seen = {
    loadingText: false,
    noSlider: false,
    noVideo: false,
    noCharts: false,
    blankCamera: false,
    blankDetail: undefined as string | undefined,
    samples: 0,
  };
  return new Promise<typeof seen>((resolve) => {
    const tick = () => {
      seen.samples += 1;
      const text = host!.textContent ?? '';
      if (/Reading data|Initializing|Loading layout/.test(text)) seen.loadingText = true;
      if (!slider()) seen.noSlider = true;
      if (videos().length !== 2) seen.noVideo = true;
      if (!host!.querySelector('[data-testid="chart-groups"]')) seen.noCharts = true;
      // Each camera shows a decoded frame, or the frame held while its new URL loads.
      for (const video of videos()) {
        const hold = video.parentElement?.querySelector<HTMLElement>(
          '[data-testid="video-hold-frame"]',
        );
        if (hold?.style.display !== 'block' && !paintsFrame(video)) {
          seen.blankCamera = true;
          seen.blankDetail ??= `sample ${seen.samples}: readyState=${video.readyState} seeking=${video.seeking} display=${video.style.display}`;
        }
      }
      if (done()) resolve(seen);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

it('swaps to another source of the same recording without leaving the view', async () => {
  await openAtFrame(120);
  const before = videos().map((video) => video.src);
  const next = new SlowOpen();
  const loaded = () =>
    videos().every((video, index) => video.src !== before[index] && video.readyState >= 2);
  const watching = watchView(loaded);
  root!.render(
    <LeRobotViewer
      dataSource={next}
      language="en"
      initialSelection={{ episodeIndex: 0, timeS: 120 / 30 }}
    />,
  );
  const seen = await watching;
  expect(seen).toMatchObject({
    loadingText: false,
    noSlider: false,
    noVideo: false,
    noCharts: false,
    blankCamera: false,
    blankDetail: undefined,
  });
  // The slow open took about a second of frames, all of them the old view.
  expect(seen.samples).toBeGreaterThan(20);
  // The held frames give way at the new frames' first paint, well before the cap.
  await expect.poll(holding, { timeout: 1500 }).toBe(false);
  // Same episode, same frame, now from the new source.
  expect(slider()?.getAttribute('aria-valuenow')).toBe('120');
});

it('keeps the shown source and names the error when the new one fails to open', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await openAtFrame(60);
  const before = videos().map((video) => video.src);
  let failed = false;
  const watching = watchView(() => failed);
  root!.render(
    <LeRobotViewer
      dataSource={new SlowOpen(true)}
      language="en"
      initialSelection={{ episodeIndex: 0, timeS: 2 }}
    />,
  );
  await expect
    .poll(() => (failed = (host!.textContent ?? '').includes('meta/info.json -> 503')), {
      timeout: 30_000,
    })
    .toBe(true);
  const seen = await watching;
  expect(seen).toMatchObject({ loadingText: false, noSlider: false, noVideo: false });
  expect(videos().map((video) => video.src)).toEqual(before);
  expect(slider()?.getAttribute('aria-valuenow')).toBe('60');
});

it('keeps playing across a swap when it was playing', async () => {
  await openAtFrame(30);
  host!.querySelector<HTMLElement>('.lerobot-root')!.focus();
  await userEvent.keyboard(' ');
  await expect.poll(() => videos().every((video) => !video.paused), { timeout: 10_000 }).toBe(true);
  const before = videos().map((video) => video.src);
  root!.render(<LeRobotViewer dataSource={new SlowOpen()} language="en" />);
  await expect
    .poll(
      () => videos().every((video, index) => video.src !== before[index] && video.readyState >= 2),
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect.poll(() => videos().every((video) => !video.paused), { timeout: 10_000 }).toBe(true);
});

it('releases a held frame whose new file never loads, at the cap, into the loading state', async () => {
  await openAtFrame(120);
  root!.render(
    <LeRobotViewer
      dataSource={new Slow(FRAME_CODED, { infoMs: 300, video: 'stall' })}
      language="en"
    />,
  );
  await expect.poll(holding, { timeout: 15_000 }).toBe(true);
  const heldAt = performance.now();
  await expect.poll(holding, { timeout: HOLD_CAP_MS + 2000 }).toBe(false);
  expect(performance.now() - heldAt).toBeGreaterThan(HOLD_CAP_MS - 500);
  // The cameras say they are waiting instead of showing the old source's frame.
  expect(host!.textContent).toContain('Waiting for video file...');
});

it('releases a held frame when the new file fails, and names the failure', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await openAtFrame(120);
  root!.render(
    <LeRobotViewer
      dataSource={new Slow(FRAME_CODED, { infoMs: 300, video: 'broken' })}
      language="en"
    />,
  );
  await expect
    .poll(() => host!.textContent ?? '', { timeout: 15_000 })
    .toContain('Error loading data');
  // Released at the error itself, not at the cap.
  expect(holding()).toBe(false);
});

it('keeps an episode the person picks while the new source opens', async () => {
  await mount(
    <LeRobotViewer
      dataSource={new FetchDataSource(V3)}
      language="en"
      initialSelection={{ episodeIndex: 0, timeS: 0.5 }}
    />,
  );
  await expect.poll(currentEpisode, { timeout: 30_000 }).toBe('Select Episode 0');
  await expect
    .poll(() => Number(slider()?.getAttribute('aria-valuemax') ?? 0) > 0, { timeout: 30_000 })
    .toBe(true);
  // These episodes are three frames long: loop the current one, so that
  // only the swap (not playback reaching the end) could change the episode.
  const modeToggle = () =>
    host!.querySelector<HTMLButtonElement>('button[aria-label="Toggle playback mode"]')!;
  for (const icon of ['lucide-shuffle', 'lucide-repeat-1']) {
    modeToggle().click(); // in order, then shuffle, then loop
    await expect.poll(() => modeToggle().querySelector(`.${icon}`) !== null).toBe(true);
  }
  const next = new Slow(V3, { infoMs: 1500 });
  root!.render(<LeRobotViewer dataSource={next} language="en" />);
  await new Promise((resolve) => setTimeout(resolve, 200));
  host!.querySelector<HTMLButtonElement>('[aria-label="Select Episode 1"]')!.click();
  await expect.poll(currentEpisode, { timeout: 10_000 }).toBe('Select Episode 1');
  // The new source opens and reloads the episode on screen: the picked one.
  await expect.poll(() => next.dataReads.includes('end'), { timeout: 15_000 }).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(currentEpisode()).toBe('Select Episode 1');
});

it('a swap during a swap resumes playback only once the newest source has its data', async () => {
  await openAtFrame(30);
  host!.querySelector<HTMLElement>('button[aria-label="Play/pause"]')!.click();
  await expect.poll(playing, { timeout: 10_000 }).toBe(true);
  // B commits quickly, then its episode data is slow; C replaces it meanwhile.
  const b = new Slow(FRAME_CODED, { infoMs: 200, dataMs: 2000 });
  root!.render(<LeRobotViewer dataSource={b} language="en" />);
  await expect.poll(() => b.dataReads.includes('start'), { timeout: 10_000 }).toBe(true);
  const c = new Slow(FRAME_CODED, { infoMs: 300, dataMs: 3000 });
  root!.render(<LeRobotViewer dataSource={c} language="en" />);
  let early = false;
  const started = performance.now();
  while (!c.dataReads.includes('end') && performance.now() - started < 15_000) {
    if (playing()) early = true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(early).toBe(false);
  // Then it plays again, on C's data.
  await expect.poll(playing, { timeout: 10_000 }).toBe(true);
});

it('a superseded swap whose reload finishes first neither lands nor resumes', async () => {
  await openAtFrame(30);
  host!.querySelector<HTMLElement>('button[aria-label="Play/pause"]')!.click();
  await expect.poll(playing, { timeout: 10_000 }).toBe(true);
  // B commits and reloads its episode while C (newer) is still opening.
  const b = new Slow(FRAME_CODED, { infoMs: 200, dataMs: 600 });
  root!.render(<LeRobotViewer dataSource={b} language="en" />);
  await expect.poll(() => b.dataReads.includes('start'), { timeout: 10_000 }).toBe(true);
  const c = new Slow(FRAME_CODED, { infoMs: 2500, dataMs: 300 });
  root!.render(<LeRobotViewer dataSource={c} language="en" />);
  let early = false;
  const started = performance.now();
  while (!c.dataReads.includes('end') && performance.now() - started < 15_000) {
    if (playing()) early = true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(b.dataReads.includes('end')).toBe(true);
  expect(early).toBe(false);
  await expect.poll(playing, { timeout: 10_000 }).toBe(true);
});

it('a swap during a pending swap lands on the newest source only', async () => {
  await openAtFrame(60);
  const b = new Slow(FRAME_CODED, { infoMs: 2500 });
  root!.render(<LeRobotViewer dataSource={b} language="en" />);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const c = new Slow(FRAME_CODED, { infoMs: 500 });
  root!.render(<LeRobotViewer dataSource={c} language="en" />);
  await expect.poll(() => c.dataReads.includes('end'), { timeout: 15_000 }).toBe(true);
  // Past B's late metadata: it is dropped, never committed or loaded.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  expect(b.dataReads).toEqual([]);
  expect(slider()?.getAttribute('aria-valuenow')).toBe('60');
  expect(videos()).toHaveLength(2);
});
