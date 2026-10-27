import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer, createRemoteManifestDataSource, type RemoteFileEntry } from '@/public-api';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Opt-in: LEROBOT_LARGE_DATASET=<dataset root>, best with LEROBOT_E2E_THROTTLE_MBPS=20. Preview →
 * Original on a dataset whose originals together need more than the link: paused (every camera
 * switches at the frame), playing (the cameras that fit switch, the others keep the preview and the
 * playback bar says why), and with one camera focused (it plays the original). It judges the
 * screen: screenshots of every camera's picture, checked for black and frozen frames.
 */

function waitFor(predicate: () => boolean, timeoutMs = 60_000): Promise<boolean> {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (predicate()) resolve(true);
      else if (performance.now() - startedAt > timeoutMs) resolve(false);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

/** Screenshot interval (ms); the paused switch is sampled as fast as screenshots go. */
let SAMPLE_MS = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function largeAvailable(): Promise<boolean> {
  try {
    const status = (await (await fetch('/e2e-datasets/status')).json()) as {
      datasets?: Record<string, { available?: boolean }>;
    };
    return Boolean(status.datasets?.large?.available);
  } catch {
    return false;
  }
}

interface CameraPixels {
  key: string;
  /** Mean luma (0–255) of the picture's centre. */
  luma: number;
  /** 16 × 16 luma thumbnail, to compare samples. */
  thumb: Float32Array;
  rendition: 'preview' | 'original';
}

/** The visible part of each camera's picture in a screenshot of the page. */
async function capture(host: HTMLElement): Promise<{ at: number; cameras: CameraPixels[] }> {
  const at = performance.now();
  const base64 = await page.screenshot({ save: false });
  const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = bitmap.width / window.innerWidth;
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  const cameras: CameraPixels[] = [];
  for (const panel of host.querySelectorAll<HTMLElement>('[data-camera]')) {
    const video = panel.querySelector<HTMLVideoElement>('video[data-lerobot-role="active"]');
    if (!video || !video.videoWidth) continue;
    const box = panel.getBoundingClientRect();
    if (box.width < 8 || box.height < 8) continue;
    // the picture inside the panel (object-fit: contain), inner 60 % (no letterbox, no badges)
    const fit = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
    const width = video.videoWidth * fit * 0.6;
    const height = video.videoHeight * fit * 0.6;
    const left = box.left + (box.width - width) / 2;
    const top = box.top + (box.height - height) / 2;
    const x = Math.round(left * scale);
    const y = Math.round(top * scale);
    const w = Math.max(16, Math.round(width * scale));
    const h = Math.max(16, Math.round(height * scale));
    if (x < 0 || y < 0 || x + w > bitmap.width || y + h > bitmap.height) continue;
    const data = context.getImageData(x, y, w, h).data;
    const thumb = new Float32Array(256);
    const counts = new Float32Array(256);
    let sum = 0;
    for (let row = 0; row < h; row++) {
      for (let column = 0; column < w; column++) {
        const offset = (row * w + column) * 4;
        const luma = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
        sum += luma;
        const cell = Math.floor((row * 16) / h) * 16 + Math.floor((column * 16) / w);
        thumb[cell] += luma;
        counts[cell] += 1;
      }
    }
    for (let cell = 0; cell < 256; cell++) thumb[cell] /= Math.max(1, counts[cell]);
    cameras.push({
      key: panel.dataset.camera ?? '',
      luma: sum / (w * h),
      thumb,
      rendition: (video.getAttribute('src') ?? '').includes('/preview/') ? 'preview' : 'original',
    });
  }
  bitmap.close();
  return { at, cameras };
}

function difference(a: Float32Array, b: Float32Array): number {
  let total = 0;
  for (let index = 0; index < a.length; index++) total += Math.abs(a[index] - b[index]);
  return total / a.length;
}

/** Black samples and the longest run without a change of picture, per camera. */
function judge(samples: Array<{ at: number; cameras: CameraPixels[] }>, keys?: string[]) {
  const black: Record<string, number> = {};
  const longestFrozenMs: Record<string, number> = {};
  const last = new Map<string, { thumb: Float32Array; since: number }>();
  for (const sample of samples) {
    for (const camera of sample.cameras) {
      if (keys && !keys.includes(camera.key)) continue;
      if (camera.luma < 6) black[camera.key] = (black[camera.key] ?? 0) + 1;
      const previous = last.get(camera.key);
      if (previous && difference(previous.thumb, camera.thumb) < 0.4) {
        longestFrozenMs[camera.key] = Math.max(
          longestFrozenMs[camera.key] ?? 0,
          Math.round(sample.at - previous.since),
        );
        previous.thumb = camera.thumb;
      } else {
        last.set(camera.key, { thumb: camera.thumb, since: sample.at });
      }
    }
  }
  return { samples: samples.length, black, longestFrozenMs };
}

describe('browser: Original on a link slower than the originals', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await page.viewport(1_600, 1_000);
    host = document.createElement('div');
    host.style.width = '1600px';
    host.style.height = '1000px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('switches paused cameras at once, plays what the link carries, and the focused camera in Original', async ({
    skip,
  }) => {
    if (!(await largeAvailable())) {
      skip();
      return;
    }
    const files = (await (await fetch('/e2e-datasets/large-manifest')).json()) as RemoteFileEntry[];
    const previewEntry = files.find((file) => file.logicalPath === 'meta/embodiflow/preview.json');
    if (!previewEntry) {
      skip();
      return;
    }
    const previewVideoPath = (
      (await (await fetch(previewEntry.presignedUrl)).json()) as { video_path: string }
    ).video_path;
    await act(async () => {
      root.render(
        <LeRobotViewer
          dataSource={createRemoteManifestDataSource(files)}
          language="en"
          showSidebar
          showPlaybackBar
          previewVideoPath={previewVideoPath}
        />,
      );
    });
    const actives = () =>
      Array.from(host.querySelectorAll<HTMLVideoElement>('video[data-lerobot-role="active"]'));
    const onScreen = () =>
      actives().filter((video) => {
        const panel = video.closest<HTMLElement>('[data-camera]');
        const box = panel?.getBoundingClientRect();
        return Boolean(box && box.width > 8 && box.height > 8);
      });
    const isOriginal = (video: HTMLVideoElement) =>
      !(video.getAttribute('src') ?? '').includes('/preview/') && video.readyState >= 2;
    expect(
      await waitFor(() => actives().length > 0 && actives().every((v) => v.readyState >= 2)),
    ).toBe(true);
    await waitFor(() => host.querySelector('[aria-label="Play/pause"]') !== null);
    const playButton = host.querySelector<HTMLButtonElement>('[aria-label="Play/pause"]')!;
    const isPlaying = () => playButton.querySelector('.lucide-pause') !== null;
    await waitFor(() => !playButton.disabled);
    if (isPlaying()) await act(async () => playButton.click());
    await waitFor(() => !isPlaying());
    await sleep(1_000);
    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Video quality"]')!;
    const notice = () => host.querySelector('[data-quality-notice]')?.textContent ?? null;

    const sampleWhile = async (
      done: () => boolean,
      maxMs: number,
    ): Promise<Array<{ at: number; cameras: CameraPixels[] }>> => {
      const samples: Array<{ at: number; cameras: CameraPixels[] }> = [];
      const startedAt = performance.now();
      while (!done() && performance.now() - startedAt < maxMs) {
        const sampledAt = performance.now();
        samples.push(await capture(host));
        // a screenshot costs the page's CPU too: at most every SAMPLE_MS, and the condition is
        // checked on every animation frame in between
        while (!done() && performance.now() - sampledAt < SAMPLE_MS) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      }
      return samples;
    };

    // 1. paused: Preview → Original switches every camera at the frame it shows
    const pausedBefore = await capture(host);
    const pausedAt = performance.now();
    await act(async () => toggle.click());
    let pausedDoneAt = 0;
    const pausedSamples = await sampleWhile(() => {
      const done = actives().length > 0 && actives().every(isOriginal);
      if (done && !pausedDoneAt) pausedDoneAt = performance.now();
      return done;
    }, 30_000);
    await sleep(300);
    pausedSamples.push(await capture(host));
    await page.screenshot({ path: '../../temp/quality/1-paused-original.png' });
    const pausedAfter = pausedSamples[pausedSamples.length - 1];
    const paused = {
      switchMs: pausedDoneAt ? Math.round(pausedDoneAt - pausedAt) : null,
      ...judge(pausedSamples),
      // the same frame in Original: the picture barely changes (resolution only)
      pictureChange: pausedBefore.cameras.map((camera) => {
        const after = pausedAfter.cameras.find((other) => other.key === camera.key);
        return after ? Number(difference(camera.thumb, after.thumb).toFixed(1)) : null;
      }),
      renditions: pausedAfter.cameras.map((camera) => camera.rendition),
    };

    // 2. playing with Original chosen: the link carries only some originals
    const waiting: number[] = [];
    for (const video of host.querySelectorAll('video')) {
      video.addEventListener('waiting', () => {
        if (video.dataset.lerobotRole === 'active') waiting.push(performance.now());
      });
    }
    const mediaTime = () => {
      const video = onScreen()[0];
      return video ? video.currentTime : 0;
    };
    SAMPLE_MS = 1_000;
    const playAt = performance.now();
    await act(async () => playButton.click());
    const playStartMedia = mediaTime();
    let noticeAt = 0;
    let midMedia = 0;
    let midWall = 0;
    // the notice's count against the panels: a panel without a Preview / Loading badge is on Original
    let noticeChecks = 0;
    let noticeMismatches = 0;
    let mismatchRun = 0;
    let longestMismatch = 0;
    const checkNotice = () => {
      const match = /Original on (\d+) of (\d+)/.exec(notice() ?? '');
      if (!match) return;
      const panels = Array.from(host.querySelectorAll<HTMLElement>('[data-camera]')).filter(
        (panel) => panel.getBoundingClientRect().width > 8,
      );
      const onOriginal = panels.filter(
        (panel) => !panel.querySelector('[data-camera-rendition]'),
      ).length;
      noticeChecks += 1;
      const agrees = Number(match[1]) === onOriginal && Number(match[2]) === panels.length;
      if (agrees) {
        mismatchRun = 0;
      } else {
        noticeMismatches += 1;
        mismatchRun += 1;
        longestMismatch = Math.max(longestMismatch, mismatchRun);
      }
    };
    const playingSamples = await sampleWhile(() => {
      checkNotice();
      if (!noticeAt && notice()) noticeAt = performance.now();
      if (!midWall && performance.now() - playAt > 15_000) {
        midWall = performance.now();
        midMedia = mediaTime();
      }
      return false;
    }, 30_000);
    const lastHalfRatio = (mediaTime() - midMedia) / ((performance.now() - midWall) / 1000);
    await page.screenshot({ path: '../../temp/quality/2-playing-limited.png' });
    const lastPlaying = playingSamples[playingSamples.length - 1];
    const playing = {
      noticeMs: noticeAt ? Math.round(noticeAt - playAt) : null,
      // checked on every animation frame: a mismatch may last one frame (React renders the bar
      // and the panels in the same commit, so it should not happen at all)
      noticeChecks,
      noticeMismatches,
      longestMismatchFrames: longestMismatch,
      notice: notice(),
      ...judge(playingSamples.filter((sample) => sample.at - playAt > 1_000)),
      renditions: lastPlaying.cameras.map((camera) => camera.rendition),
      stalls: waiting.filter((time) => time - playAt > 1_000).length,
      // media seconds per wall second (1 = no time lost to stalls)
      playRatio: Number(
        ((mediaTime() - playStartMedia) / ((performance.now() - playAt) / 1000)).toFixed(2),
      ),
      playRatioLast15s: Number(lastHalfRatio.toFixed(2)),
      stillPlaying: isPlaying(),
    };

    // 3. focus one camera while playing: it plays the original
    // a camera on the preview (the one on the original would show nothing new)
    const previewPanel = Array.from(host.querySelectorAll<HTMLElement>('[data-camera]')).find(
      (panel) =>
        (
          panel.querySelector('video[data-lerobot-role="active"]')?.getAttribute('src') ?? ''
        ).includes('/preview/'),
    );
    const focusButton = (previewPanel ?? host).querySelector<HTMLButtonElement>(
      '[aria-label="Focus this camera"]',
    );
    let focused: Record<string, unknown> = { available: false };
    if (focusButton) {
      const panel = focusButton.closest<HTMLElement>('[data-camera]')!;
      const key = panel.dataset.camera!;
      const video = () =>
        panel.querySelector<HTMLVideoElement>('video[data-lerobot-role="active"]');
      const focusAt = performance.now();
      await act(async () => focusButton.click());
      let originalAt = 0;
      const focusedSamples = await sampleWhile(() => {
        const current = video();
        if (!originalAt && current && isOriginal(current)) originalAt = performance.now();
        return false;
      }, 20_000);
      await page.screenshot({ path: '../../temp/quality/3-focused-original.png' });
      const stallsBefore = waiting.length;
      const focusMedia = mediaTime();
      const focusWall = performance.now();
      await sleep(5_000);
      const focusRatio = (mediaTime() - focusMedia) / ((performance.now() - focusWall) / 1000);
      focused = {
        available: true,
        camera: key,
        switchMs: originalAt ? Math.round(originalAt - focusAt) : null,
        onScreen: onScreen().length,
        notice: notice(),
        ...judge(
          focusedSamples.filter((sample) => sample.at - focusAt > 500),
          [key],
        ),
        rendition: video() && isOriginal(video()!) ? 'original' : 'preview',
        stallsAfterSwitch: waiting.length - stallsBefore,
        playRatioAfterSwitch: Number(focusRatio.toFixed(2)),
        stillPlaying: isPlaying(),
      };
    }
    if (isPlaying()) await act(async () => playButton.click());

    const report = { paused, playing, focused };
    console.log(`[large-quality] ${JSON.stringify(report)}`);

    expect(paused.switchMs).not.toBeNull();
    expect(Object.keys(paused.black)).toHaveLength(0);
    expect(Object.keys(playing.black)).toHaveLength(0);
    expect(playing.stillPlaying).toBe(true);
    expect(playing.noticeChecks).toBeGreaterThan(0);
    expect(playing.longestMismatchFrames).toBeLessThanOrEqual(1);
  });
});
