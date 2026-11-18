import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { FetchDataSource } from './fixtures';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

// Committed, not generated: two cameras, 360 frames.
const FRAME_CODED = '/tests/fixtures/static/frame-coded-v3';

/** The same recording from another source (an anonymized copy, say), slow to open. */
class SlowOpen extends FetchDataSource {
  constructor(private readonly failInfo = false) {
    super(FRAME_CODED);
  }
  override async readText(path: string) {
    if (path === 'meta/info.json') {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (this.failInfo) throw new Error('fetch meta/info.json -> 503');
    }
    return super.readText(path);
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

async function openAtFrame(frame: number) {
  await page.viewport(1280, 800);
  host = document.createElement('div');
  host.style.cssText = 'width:1280px;height:800px';
  document.body.append(host);
  root = createRoot(host);
  root.render(
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
  const swapped = () =>
    videos().every((video, index) => video.src !== before[index] && video.readyState >= 2) &&
    !host!.querySelector('[data-testid="video-hold-frame"][style*="block"]');
  const watching = watchView(swapped);
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
