import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer, createRemoteManifestDataSource, type RemoteFileEntry } from '@/public-api';
import { DEFAULT_RETRY_POLICY } from '../../src/react/services/video/retry';
import { VIDEO_URL_POLICY } from '../../src/react/services/video/CameraPlayer';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Switching and seeking on a frame-coded dataset (scripts/e2e/materializeFrameCodedDataset.ts):
 * every video frame encodes its dataset frame index, so the tests read which frame each camera
 * actually shows. 4 episodes x 90 frames; episodes 0-1 in file 000, 2-3 in file 001; two cameras;
 * a half-size preview copy. Served with Range support (and LEROBOT_E2E_THROTTLE_MBPS if set).
 */

const FRAMES = 90;
const BITS = 10;
const CAMERAS = ['observation.images.front', 'observation.images.wrist'];
const PREVIEW_PATH =
  'meta/preview/videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4';

interface LogEntry {
  path: string;
  query: string;
  range: string | null;
  status: number;
  at: number;
}

let describeState: () => string = () => '';

function waitFor(predicate: () => boolean, timeoutMs = 30_000, what = 'condition'): Promise<void> {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let ok: boolean;
      try {
        ok = predicate();
      } catch {
        ok = false;
      }
      if (ok) resolve();
      else if (performance.now() - startedAt > timeoutMs)
        reject(new Error(`waitFor timeout: ${what}\n${describeState()}`));
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const canvas = document.createElement('canvas');
const context = canvas.getContext('2d', { willReadFrequently: true })!;

/** The dataset frame index shown by `video`, or null for a black / blank / undecodable picture. */
function decodeFrame(
  video: HTMLVideoElement | HTMLCanvasElement | null | undefined,
): number | null {
  // what is on screen: the last presented frame also while a seek is in flight
  if (!video) return null;
  const width = video instanceof HTMLVideoElement ? video.videoWidth : video.width;
  const height = video instanceof HTMLVideoElement ? video.videoHeight : video.height;
  if (!width || !height) return null;
  canvas.width = width;
  canvas.height = height;
  context.drawImage(video, 0, 0, width, height);
  const blockWidth = Math.floor(width / BITS);
  let value = 0;
  for (let bit = 0; bit < BITS; bit++) {
    const x = Math.floor(bit * blockWidth + blockWidth / 2);
    const top = context.getImageData(x, Math.floor(height / 4), 1, 1).data[0];
    const bottom = context.getImageData(x, Math.floor((3 * height) / 4), 1, 1).data[0];
    if (Math.abs(top - bottom) < 80) return null;
    if (top > bottom) value |= 1 << bit;
  }
  return value;
}

async function frameCodedAvailable(): Promise<boolean> {
  try {
    const status = (await (await fetch('/e2e-datasets/status')).json()) as {
      datasets?: Record<string, { available?: boolean }>;
    };
    return Boolean(status.datasets?.framecoded?.available);
  } catch {
    return false;
  }
}

async function requestLog(clear = false): Promise<LogEntry[]> {
  return (await (
    await fetch(`/e2e-datasets/request-log${clear ? '?clear=1' : ''}`)
  ).json()) as LogEntry[];
}

describe('browser: playback switching on a frame-coded dataset', () => {
  let host: HTMLDivElement;
  let root: Root;

  const panel = (camera: string) => host.querySelector<HTMLElement>(`[data-camera="${camera}"]`);
  const activeVideo = (camera: string) =>
    panel(camera)?.querySelector<HTMLVideoElement>('video[data-lerobot-role="active"]') ?? null;
  /** The picture on screen: a paused swap holds it on a cover canvas while the new file loads. */
  const shown = (camera: string) =>
    decodeFrame(
      panel(camera)?.querySelector<HTMLCanvasElement>('canvas[data-lerobot-cover]') ??
        activeVideo(camera),
    );
  const allShow = (value: number) => CAMERAS.every((camera) => shown(camera) === value);
  /** Every camera shows a frame of the episode starting at `start` (it may be playing). */
  const allIn = (start: number) =>
    CAMERAS.every((camera) => {
      const value = shown(camera);
      return value !== null && value >= start && value < start + FRAMES;
    });
  const playButton = () => host.querySelector<HTMLButtonElement>('[aria-label="Play/pause"]');
  const isPlaying = () => Boolean(playButton()?.querySelector('.lucide-pause'));
  const slider = () =>
    host.querySelector<HTMLElement>('[role="slider"][aria-label="Playback progress"]')!;
  const frameText = () => Number(slider().getAttribute('aria-valuenow'));

  /** Records the frame every camera shows on every animation frame. */
  function record() {
    const samples: Record<string, Array<number | null>> = Object.fromEntries(
      CAMERAS.map((camera) => [camera, []]),
    );
    let running = true;
    const tick = () => {
      if (!running) return;
      for (const camera of CAMERAS) samples[camera].push(shown(camera));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return {
      stop: () => {
        running = false;
        return samples;
      },
      /** The samples up to the first one where every camera shows the episode at `start`. */
      untilIn: (start: number) => {
        running = false;
        const length = samples[CAMERAS[0]].length;
        let end = length;
        for (let index = 0; index < length; index++) {
          if (
            CAMERAS.every((camera) => {
              const value = samples[camera][index];
              return value !== null && value >= start && value < start + FRAMES;
            })
          ) {
            end = index + 1;
            break;
          }
        }
        return Object.fromEntries(
          CAMERAS.map((camera) => [camera, samples[camera].slice(0, end)]),
        ) as Record<string, Array<number | null>>;
      },
    };
  }

  async function open(
    manifestQuery = '',
    mutate?: (files: RemoteFileEntry[]) => RemoteFileEntry[],
    refresh?: () => Promise<RemoteFileEntry[]>,
  ) {
    let files = (await (
      await fetch(`/e2e-datasets/framecoded-manifest${manifestQuery}`)
    ).json()) as RemoteFileEntry[];
    if (mutate) files = mutate(files);
    const source = createRemoteManifestDataSource(files, refresh ? { refresh } : undefined);
    await act(async () => {
      root.render(
        <LeRobotViewer dataSource={source} language="en" previewVideoPath={PREVIEW_PATH} />,
      );
    });
    await waitFor(() => playButton() !== null && !playButton()!.disabled, 30_000, 'play button');
    // the viewer autoplays the first episode; these tests start paused
    if (isPlaying()) await act(async () => playButton()!.click());
    await waitFor(() => !isPlaying(), 5_000, 'paused');
    await press('Home');
  }

  async function press(key: string, target: HTMLElement = slider()) {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
  }

  async function selectEpisode(index: number) {
    const row = host.querySelector<HTMLElement>(`[aria-label="Select Episode ${index}"]`);
    expect(row, `episode row ${index}`).not.toBeNull();
    await act(async () => row!.click());
  }

  /** Selecting an episode autoplays it once loaded; pause for frame-exact checks. */
  async function pauseAutoplay() {
    await waitFor(isPlaying, 3_000, 'autoplay').catch(() => undefined);
    if (isPlaying()) await act(async () => playButton()!.click());
    await waitFor(() => !isPlaying(), 5_000, 'paused');
  }

  beforeEach(async () => {
    describeState = () =>
      JSON.stringify(
        {
          playing: isPlaying(),
          frame: host.querySelector('[role="slider"]')?.getAttribute('aria-valuenow'),
          cameras: CAMERAS.map((camera) => ({
            camera,
            status: panel(camera)?.dataset.cameraStatus,
            shown: shown(camera),
            videos: Array.from(panel(camera)?.querySelectorAll('video') ?? []).map((video) => ({
              role: video.dataset.lerobotRole,
              src: video.getAttribute('src')?.replace(/^.*\/e2e-datasets\//, ''),
              readyState: video.readyState,
              time: Number(video.currentTime.toFixed(3)),
              paused: video.paused,
              seeking: video.seeking,
              decoded: decodeFrame(video),
            })),
          })),
        },
        null,
        1,
      );
    DEFAULT_RETRY_POLICY.baseMs = 1_000;
    DEFAULT_RETRY_POLICY.maxMs = 30_000;
    VIDEO_URL_POLICY.renewLeadMs = 90_000;
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

  it('switches episodes in the same file and across files without a frame of another episode', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    await open();
    await waitFor(() => allShow(0), 30_000, 'episode 0 frame 0 on every camera');

    // last frame of episode 0
    await press('End');
    await waitFor(() => allShow(FRAMES - 1), 10_000, 'frame 89');
    const elementsBefore = CAMERAS.map(activeVideo);

    // same file: episode 1 is the second half of file 000 — a seek of the element on screen
    await requestLog(true);
    let recorder = record();
    const sameFileAt = performance.now();
    await selectEpisode(1);
    await waitFor(() => allIn(FRAMES), 15_000, 'episode 1 on screen');
    const sameFileMs = performance.now() - sameFileAt;
    let samples = recorder.untilIn(FRAMES);
    for (const camera of CAMERAS) {
      // only the frame shown before the switch, then the new episode from its first frame; never
      // black, never a frame of another episode
      for (const value of new Set(samples[camera])) {
        expect(
          value === FRAMES - 1 || (value !== null && value >= FRAMES && value < 2 * FRAMES),
          `${camera} showed ${value}`,
        ).toBe(true);
      }
      expect(samples[camera].at(-1)).toBeLessThanOrEqual(FRAMES + 2);
    }
    expect(CAMERAS.map(activeVideo)).toEqual(elementsBefore);
    await pauseAutoplay();

    // the next episode (file 001) is prefetched into the standby elements (while playing near the
    // end, or after a short idle while paused)
    await sleep(1_500);
    const prefetchRequests = (await requestLog(true)).filter((entry) =>
      entry.path.endsWith('.mp4'),
    );
    const prefetched = new Set(prefetchRequests.map((entry) => entry.path));
    expect([...prefetched].filter((path) => path.includes('file-001')).length).toBe(CAMERAS.length);

    // cross-file: episode 2 lives in file 001 and is already in the standby elements
    const before = CAMERAS.map(shown);
    recorder = record();
    const crossFileAt = performance.now();
    await selectEpisode(2);
    await waitFor(() => allIn(2 * FRAMES), 15_000, 'episode 2 on screen');
    const crossFileMs = performance.now() - crossFileAt;
    samples = recorder.untilIn(2 * FRAMES);
    for (const [index, camera] of CAMERAS.entries()) {
      for (const value of new Set(samples[camera])) {
        expect(
          value === before[index] || (value !== null && value >= 2 * FRAMES && value < 3 * FRAMES),
          `${camera} showed ${value}`,
        ).toBe(true);
      }
      expect(samples[camera].at(-1)).toBeLessThanOrEqual(2 * FRAMES + 2);
    }
    const crossFileRequests = (await requestLog(true)).filter((entry) =>
      entry.path.endsWith('.mp4'),
    );
    // file 000 is not reloaded, file 001 is not opened again
    expect(crossFileRequests.filter((entry) => entry.path.includes('file-000')).length).toBe(0);
    expect(crossFileRequests.length).toBeLessThanOrEqual(CAMERAS.length);
    // paused, the cameras land exactly on the playhead
    await pauseAutoplay();
    await waitFor(() => allShow(2 * FRAMES + frameText()), 5_000, 'paused on the playhead');
    console.log(
      `[switching] ${JSON.stringify({
        sameFileMs: Math.round(sameFileMs),
        crossFileMs: Math.round(crossFileMs),
        prefetchVideoRequests: prefetchRequests.length,
        crossFileVideoRequests: crossFileRequests.length,
      })}`,
    );
  });

  it('switches quality without a black frame, keeping the frame and the cameras in sync', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    await open();
    await waitFor(() => allShow(0), 30_000, 'first frame');
    for (let step = 0; step < 5; step++) await press('PageUp');
    await waitFor(() => allShow(50), 10_000, 'frame 50');
    const previewWidths = CAMERAS.map((camera) => activeVideo(camera)!.videoWidth);

    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Video quality"]')!;
    expect(toggle.textContent).toContain('Preview');
    const recorder = record();
    await act(async () => toggle.click());
    await waitFor(
      () =>
        CAMERAS.every(
          (camera, index) => activeVideo(camera)!.videoWidth === previewWidths[index] * 2,
        ),
      15_000,
      'original rendition on screen',
    );
    await sleep(300);
    const samples = recorder.stop();
    for (const camera of CAMERAS) {
      expect(samples[camera].length).toBeGreaterThan(3);
      expect(
        samples[camera].every((value) => value === 50),
        `${camera}: ${samples[camera].join(',')}`,
      ).toBe(true);
    }
    expect(toggle.textContent).toContain('Original');

    // a second toggle while the first one still loads: the latest intent wins
    await act(async () => toggle.click());
    await act(async () => toggle.click());
    await act(async () => toggle.click());
    await waitFor(
      () =>
        CAMERAS.every((camera, index) => activeVideo(camera)!.videoWidth === previewWidths[index]),
      15_000,
      'preview again',
    );
    expect(allShow(50)).toBe(true);
  });

  it('switches quality while playing without a black frame or a jump back', async ({ skip }) => {
    if (!(await frameCodedAvailable())) return skip();
    await open();
    await waitFor(() => allShow(0), 30_000, 'first frame');
    const previewWidths = CAMERAS.map((camera) => activeVideo(camera)!.videoWidth);
    await act(async () => playButton()!.click());
    await waitFor(isPlaying, 5_000, 'playing');
    await waitFor(() => allIn(0) && (shown(CAMERAS[0]) ?? 0) > 10, 10_000, 'playing a while');
    const recorder = record();
    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Video quality"]')!;
    await act(async () => toggle.click());
    await waitFor(
      () =>
        CAMERAS.every(
          (camera, index) => activeVideo(camera)!.videoWidth === previewWidths[index] * 2,
        ),
      15_000,
      'original rendition while playing',
    );
    await sleep(200);
    const samples = recorder.stop();
    if (isPlaying()) await act(async () => playButton()!.click());
    for (const camera of CAMERAS) {
      const values = samples[camera];
      expect(
        values.every((value) => value !== null),
        `${camera}: ${values.join(',')}`,
      ).toBe(true);
      // within the episode, frames only move forward (the swap meets the clock, it does not rewind)
      const inEpisode = values.filter((value) => value !== null && value < FRAMES) as number[];
      for (let index = 1; index < inEpisode.length; index++) {
        expect(inEpisode[index], `${camera}: ${inEpisode.join(',')}`).toBeGreaterThanOrEqual(
          inEpisode[index - 1] - 1,
        );
      }
    }
  });

  it('lands paused scrubs and keyboard steps on the exact frame of every camera', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    await open();
    await selectEpisode(3);
    await waitFor(() => allIn(3 * FRAMES), 15_000, 'episode 3 on screen');
    await pauseAutoplay();
    const base = 3 * FRAMES;
    await press('Home');
    await waitFor(() => allShow(base), 20_000, 'episode 3');

    const track = slider();
    const rect = track.getBoundingClientRect();
    const at = (fraction: number) => rect.left + rect.width * fraction;
    const pointer = (type: string, fraction: number, target: EventTarget) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          clientX: at(fraction),
          clientY: rect.top + rect.height / 2,
          buttons: type === 'pointerup' ? 0 : 1,
        }),
      );
    // a fast drag 45% → 68% (one move per millisecond, like a real scrub)
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
    const expected = Math.round(0.68 * (FRAMES - 1));
    await waitFor(() => frameText() === expected, 5_000, 'slider value');
    await waitFor(() => allShow(base + expected), 10_000, `frame ${expected} on every camera`);

    // keyboard steps, faster than a seek completes
    await press('ArrowRight');
    await press('ArrowRight');
    await press('ArrowRight');
    await waitFor(() => allShow(base + expected + 3), 10_000, 'three steps');
    await press('ArrowLeft');
    await waitFor(() => allShow(base + expected + 2), 10_000, 'one step back');
    for (const frame of [0, 1, 44, FRAMES - 2, FRAMES - 1]) {
      await press('Home');
      for (let step = 0; step < Math.floor(frame / 10); step++) await press('PageUp');
      for (let step = 0; step < frame % 10; step++) await press('ArrowRight');
      await waitFor(() => allShow(base + frame), 10_000, `frame ${frame}`);
    }
  });

  it('moves every camera on a step while playing', async ({ skip }) => {
    if (!(await frameCodedAvailable())) return skip();
    await open();
    await waitFor(() => allShow(0), 30_000, 'first frame');
    await act(async () => playButton()!.click());
    await waitFor(isPlaying, 5_000, 'playing');
    await sleep(500);
    await press('ArrowLeft');
    await press('ArrowLeft');
    await sleep(200);
    await act(async () => playButton()!.click());
    await waitFor(() => !isPlaying(), 5_000, 'paused');
    await sleep(500);
    const values = CAMERAS.map(shown);
    expect(values[0]).not.toBeNull();
    // the cameras agree within a frame after a step during playback
    expect(Math.abs((values[0] ?? 0) - (values[1] ?? 0))).toBeLessThanOrEqual(1);
  });

  it('keeps the video elements when a breakpoint rebuilds the layout', async ({ skip }) => {
    if (!(await frameCodedAvailable())) return skip();
    await open();
    await waitFor(() => allShow(0), 30_000, 'first frame');
    const before = Array.from(
      host.querySelectorAll<HTMLVideoElement>('video[data-lerobot-camera]'),
    );
    expect(before.length).toBe(CAMERAS.length * 2);
    const sources = before.map((video) => video.getAttribute('src'));
    await requestLog(true);

    for (const width of ['520px', '1400px', '900px', '1400px']) {
      host.style.width = width;
      await sleep(400);
      const now = Array.from(host.querySelectorAll<HTMLVideoElement>('video[data-lerobot-camera]'));
      expect(now.length).toBe(before.length);
      expect(now.every((video) => before.includes(video))).toBe(true);
    }
    expect(before.map((video) => video.getAttribute('src'))).toEqual(sources);
    await waitFor(() => allShow(0), 5_000, 'still on frame 0');
    // nothing was downloaded again
    const videoRequests = (await requestLog()).filter((entry) => entry.path.endsWith('.mp4'));
    expect(videoRequests.length).toBe(0);
  });

  it('renews expiring video URLs before they expire, without interrupting the picture', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    let refreshes = 0;
    // URLs expire in 125 s (the source's own 2-minute margin does not renew them yet); the panels
    // renew 121 s before expiry here: about 4 s after opening
    VIDEO_URL_POLICY.renewLeadMs = 121_000;
    await open('?expiresInMs=125000&sig=1', undefined, async () => {
      refreshes += 1;
      return (await (
        await fetch('/e2e-datasets/framecoded-manifest?expiresInMs=600000&sig=2')
      ).json()) as RemoteFileEntry[];
    });
    await waitFor(() => allShow(0), 30_000, 'first frame');
    expect(
      CAMERAS.every((camera) => activeVideo(camera)?.getAttribute('src')?.includes('sig=1')),
    ).toBe(true);
    await press('End');
    await waitFor(() => allShow(FRAMES - 1), 10_000, 'last frame');
    const recorder = record();
    await waitFor(
      () => CAMERAS.every((camera) => activeVideo(camera)?.getAttribute('src')?.includes('sig=2')),
      20_000,
      'renewed URLs on screen',
    );
    await sleep(300);
    const samples = recorder.stop();
    for (const camera of CAMERAS) {
      expect(
        samples[camera].every((value) => value === FRAMES - 1),
        `${camera}: ${samples[camera].join(',')}`,
      ).toBe(true);
    }
    expect(refreshes).toBeGreaterThanOrEqual(1);
    expect(refreshes).toBeLessThanOrEqual(2);
  });

  it('retries a failing video with backoff and stops with a named error', async ({ skip }) => {
    if (!(await frameCodedAvailable())) return skip();
    DEFAULT_RETRY_POLICY.baseMs = 150;
    DEFAULT_RETRY_POLICY.maxMs = 600;
    let refreshes = 0;
    const failFront = (files: RemoteFileEntry[]) =>
      files.map((file) =>
        file.logicalPath.includes('observation.images.front') && file.logicalPath.endsWith('.mp4')
          ? { ...file, presignedUrl: `${file.presignedUrl}?fail=500` }
          : file,
      );
    await requestLog(true);
    await open('', failFront, async () => {
      refreshes += 1;
      return failFront(
        (await (await fetch('/e2e-datasets/framecoded-manifest')).json()) as RemoteFileEntry[],
      );
    });
    await waitFor(
      () =>
        panel('observation.images.front')?.dataset.videoError === 'VIDEO_UNAVAILABLE' &&
        panel('observation.images.front')?.dataset.cameraStatus === 'error',
      20_000,
      'named error state',
    );
    const atError = (await requestLog()).filter((entry) =>
      entry.path.includes('observation.images.front'),
    ).length;
    await sleep(2_500);
    const later = (await requestLog()).filter((entry) =>
      entry.path.includes('observation.images.front'),
    ).length;
    // a server error is not an expired signature: never re-signed
    expect(refreshes).toBe(0);
    // bounded: the first load and 5 retries, each with at most a probe and a media request or two
    expect(atError).toBeLessThanOrEqual(6 * 3);
    // and it stopped
    expect(later).toBe(atError);
    // the other camera plays on
    expect(shown('observation.images.wrist')).toBe(0);
  });
});
