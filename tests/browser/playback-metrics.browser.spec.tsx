import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer, createRemoteManifestDataSource, type RemoteFileEntry } from '@/public-api';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Opt-in timing report (LEROBOT_PLAYBACK_METRICS=1, usually with LEROBOT_E2E_THROTTLE_MBPS) on the
 * frame-coded dataset: time to first frame, episode switch latency (same file / across files),
 * frames of another episode and black frames during switches, quality switch black frames, and
 * cameras off the playhead after a paused scrub. Reads only the DOM (the <video> elements on screen),
 * so the same spec measures older builds too.
 */

const FRAMES = 90;
const BITS = 10;
const PREVIEW_PATH =
  'meta/preview/videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(predicate: () => boolean, timeoutMs = 60_000): Promise<boolean> {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      let ok: boolean;
      try {
        ok = predicate();
      } catch {
        ok = false;
      }
      if (ok) resolve(true);
      else if (performance.now() - startedAt > timeoutMs) resolve(false);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

const canvas = document.createElement('canvas');
const context = canvas.getContext('2d', { willReadFrequently: true })!;

function decodeFrame(video: HTMLVideoElement | null | undefined): number | null {
  if (!video || !video.videoWidth || !video.getAttribute('src')) return null;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blockWidth = Math.floor(canvas.width / BITS);
  let value = 0;
  for (let bit = 0; bit < BITS; bit++) {
    const x = Math.floor(bit * blockWidth + blockWidth / 2);
    const top = context.getImageData(x, Math.floor(canvas.height / 4), 1, 1).data[0];
    const bottom = context.getImageData(x, Math.floor((3 * canvas.height) / 4), 1, 1).data[0];
    if (Math.abs(top - bottom) < 80) return null;
    if (top > bottom) value |= 1 << bit;
  }
  return value;
}

describe('browser: playback metrics (opt-in)', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await page.viewport(1_400, 900);
    host = document.createElement('div');
    host.style.width = '1400px';
    host.style.height = '900px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('reports switching and seeking timings', async ({ skip }) => {
    const status = (await (await fetch('/e2e-datasets/status')).json()) as {
      metrics?: boolean;
      datasets?: Record<string, { available?: boolean }>;
    };
    if (!status.metrics || !status.datasets?.framecoded?.available) return skip();

    /** The element on screen per camera panel (the newer build stacks a standby element below). */
    const screens = () =>
      Array.from(host.querySelectorAll<HTMLVideoElement>('video')).filter(
        (video) => video.dataset.lerobotRole !== 'standby',
      );
    const values = () => screens().map(decodeFrame);
    const allIn = (start: number) =>
      screens().length >= 2 &&
      values().every((value) => value !== null && value >= start && value < start + FRAMES);
    const playButton = () => host.querySelector<HTMLButtonElement>('[aria-label="Play/pause"]');
    const isPlaying = () => Boolean(playButton()?.querySelector('.lucide-pause'));
    const slider = () =>
      host.querySelector<HTMLElement>('[role="slider"][aria-label="Playback progress"]')!;
    const pause = async () => {
      await waitFor(isPlaying, 3_000);
      if (isPlaying()) await act(async () => playButton()!.click());
      await waitFor(() => !isPlaying(), 5_000);
    };
    const press = async (key: string) =>
      act(async () => {
        slider().dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        );
      });

    /** Samples every animation frame: black (null) samples and samples outside `allowed`. */
    const watch = (allowed: (value: number) => boolean) => {
      let black = 0;
      let foreign = 0;
      let samples = 0;
      let running = true;
      const tick = () => {
        if (!running) return;
        samples += 1;
        for (const value of values()) {
          if (value === null) black += 1;
          else if (!allowed(value)) foreign += 1;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return () => {
        running = false;
        return { samples, black, foreign };
      };
    };

    const files = (await (
      await fetch('/e2e-datasets/framecoded-manifest')
    ).json()) as RemoteFileEntry[];
    const openedAt = performance.now();
    await act(async () => {
      root.render(
        <LeRobotViewer
          dataSource={createRemoteManifestDataSource(files)}
          language="en"
          previewVideoPath={PREVIEW_PATH}
        />,
      );
    });
    const firstOk = await waitFor(() => allIn(0));
    const timeToFirstFrameMs = Math.round(performance.now() - openedAt);
    await waitFor(() => playButton() !== null && !playButton()!.disabled);
    await pause();
    await press('End');
    await waitFor(() => values().every((value) => value === FRAMES - 1), 10_000);

    const select = async (index: number) => {
      const row = host.querySelector<HTMLElement>(`[aria-label="Select Episode ${index}"]`)!;
      await act(async () => row.click());
    };

    // same file
    let before = new Set(values());
    let stop = watch((value) => before.has(value) || (value >= FRAMES && value < 2 * FRAMES));
    let startedAt = performance.now();
    await select(1);
    const sameOk = await waitFor(() => allIn(FRAMES), 30_000);
    const sameFileSwitchMs = Math.round(performance.now() - startedAt);
    const sameFile = stop();
    await pause();
    await sleep(2_000); // idle: lets a build prefetch the next episode

    // across files
    before = new Set(values());
    stop = watch((value) => before.has(value) || (value >= 2 * FRAMES && value < 3 * FRAMES));
    startedAt = performance.now();
    await select(2);
    const crossOk = await waitFor(() => allIn(2 * FRAMES), 30_000);
    const crossFileSwitchMs = Math.round(performance.now() - startedAt);
    const crossFile = stop();
    await pause();
    await press('Home');
    for (let step = 0; step < 4; step++) await press('PageUp');
    await waitFor(() => values().every((value) => value === 2 * FRAMES + 40), 10_000);

    // quality switch, paused
    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Video quality"]');
    let quality: Record<string, unknown> = { available: false };
    if (toggle) {
      const widths = screens().map((video) => video.videoWidth);
      stop = watch((value) => value === 2 * FRAMES + 40);
      startedAt = performance.now();
      await act(async () => toggle.click());
      const ok = await waitFor(
        () =>
          screens().every((video, index) => video.videoWidth === widths[index] * 2) &&
          values().every((value) => value === 2 * FRAMES + 40),
        30_000,
      );
      const switchMs = Math.round(performance.now() - startedAt);
      await sleep(300);
      quality = { ok, switchMs, ...stop() };
    }

    // paused scrub 45% → 68%, then where every camera is after 2 s
    const track = slider();
    const rect = track.getBoundingClientRect();
    const pointer = (type: string, fraction: number, target: EventTarget) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          clientX: rect.left + rect.width * fraction,
          clientY: rect.top + rect.height / 2,
          buttons: type === 'pointerup' ? 0 : 1,
        }),
      );
    await act(async () => {
      pointer('pointerdown', 0.45, track);
    });
    for (let index = 0; index <= 23; index++) {
      pointer('pointermove', 0.45 + index / 100, window);
      await sleep(1);
    }
    await act(async () => {
      pointer('pointerup', 0.68, window);
    });
    const expected = 2 * FRAMES + Math.round(0.68 * (FRAMES - 1));
    startedAt = performance.now();
    const scrubOk = await waitFor(() => values().every((value) => value === expected), 2_000);
    const scrubSettleMs = Math.round(performance.now() - startedAt);
    const scrubOffCameras = values().filter((value) => value !== expected).length;

    const report = {
      throttle: 'see LEROBOT_E2E_THROTTLE_MBPS',
      cameras: screens().length,
      timeToFirstFrameMs: firstOk ? timeToFirstFrameMs : null,
      sameFileSwitchMs: sameOk ? sameFileSwitchMs : null,
      sameFile,
      crossFileSwitchMs: crossOk ? crossFileSwitchMs : null,
      crossFile,
      quality,
      scrub: {
        ok: scrubOk,
        settleMs: scrubSettleMs,
        offCameras: scrubOffCameras,
        values: values(),
      },
    };
    console.log(`[playback-metrics] ${JSON.stringify(report)}`);
  });
});
