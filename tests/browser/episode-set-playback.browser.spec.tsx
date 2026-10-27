import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import {
  LeRobotViewer,
  createEpisodeSetDataSource,
  EPISODE_SET_PREVIEW_VIDEO_PATH,
  type EpisodeSetRecording,
  type RemoteFileEntry,
} from '@/public-api';
import { DEFAULT_RETRY_POLICY } from '../../src/react/services/video/retry';
import { VIDEO_URL_POLICY } from '../../src/react/services/video/CameraPlayer';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A curated version on the frame-coded dataset: an episode set over two "recordings" (file 000 and
 * file 001 of the fixture, each its own single-file tree), with episodes at offsets in each. The
 * frames encode their dataset index, so every camera's picture tells which episode and frame it
 * shows.
 */

const FPS = 30;
const FRAMES = 90;
const BITS = 10;
const CAMERAS = ['observation.images.front', 'observation.images.wrist'];
const RECORDING_PREVIEW = 'meta/preview/videos/{video_key}/chunk-000/file-000.mp4';

/** Episodes of the set: recording, row range in its data file, and the first dataset frame. */
const EPISODES = [
  { recordingId: 'a', fromRow: 90, toRow: 180, first: 90 },
  { recordingId: 'b', fromRow: 0, toRow: 90, first: 180 },
  { recordingId: 'b', fromRow: 90, toRow: 180, first: 270 },
  { recordingId: 'a', fromRow: 0, toRow: 90, first: 0 },
] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Seeks of `video` take `ms` (the data is not buffered yet): while one is on its way the element
 * reports `seeking` and the time sought, the way a browser does, and a newer seek waits for it.
 */
function slowSeeks(video: HTMLVideoElement, ms: number): void {
  const time = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
  const seeking = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'seeking')!;
  let sought: number | null = null;
  let timer = 0;
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => sought ?? (time.get!.call(video) as number),
    set: (value: number) => {
      sought = value;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        sought = null;
        time.set!.call(video, value);
      }, ms);
    },
  });
  Object.defineProperty(video, 'seeking', {
    configurable: true,
    get: () => sought !== null || (seeking.get!.call(video) as boolean),
  });
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

const canvas = document.createElement('canvas');
const context = canvas.getContext('2d', { willReadFrequently: true })!;

/** The dataset frame index shown by `video`, or null for a black / blank picture. */
function decodeFrame(video: HTMLVideoElement | HTMLCanvasElement | null | undefined) {
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

/** Whether the frame-coded dataset is served; a failed build fails the spec. */
async function frameCodedAvailable(): Promise<boolean> {
  const status = (await (await fetch('/e2e-datasets/status')).json()) as {
    datasets?: Record<string, { available?: boolean; error?: string }>;
  };
  const dataset = status.datasets?.framecoded;
  if (dataset?.error) throw new Error(`the frame-coded dataset failed to build: ${dataset.error}`);
  return Boolean(dataset?.available);
}

interface LogEntry {
  path: string;
  query: string;
  range: string | null;
  status: number;
  /** When the server got it (epoch ms). */
  at: number;
}

async function requestLog(clear = false): Promise<LogEntry[]> {
  return (await (
    await fetch(`/e2e-datasets/request-log${clear ? '?clear=1' : ''}`)
  ).json()) as LogEntry[];
}

/** The fixture's files as two recordings: file 000 as "a", file 001 as "b". */
function recordings(files: RemoteFileEntry[], videoQuery: Partial<Record<'a' | 'b', string>> = {}) {
  return (['a', 'b'] as const).map((id, index): EpisodeSetRecording => {
    const own = `file-00${index}.`;
    return {
      id,
      previewVideoPath: RECORDING_PREVIEW,
      files: files
        .filter(
          (file) =>
            file.logicalPath.includes(own) &&
            (file.logicalPath.startsWith('data/') ||
              file.logicalPath.startsWith('videos/') ||
              file.logicalPath.startsWith('meta/preview/')),
        )
        .map((file) => {
          const query = file.logicalPath.endsWith('.mp4') ? videoQuery[id] : undefined;
          return {
            ...file,
            logicalPath: file.logicalPath.replace(own, 'file-000.'),
            presignedUrl: query
              ? `${file.presignedUrl}${file.presignedUrl.includes('?') ? '&' : '?'}${query}`
              : file.presignedUrl,
          };
        }),
    };
  });
}

/** Add `query` to the URLs of recording `recordingId`'s files that `match` (server test knobs). */
function patchFiles(recordingId: string, match: (path: string) => boolean, query: string) {
  return (sets: EpisodeSetRecording[]) =>
    sets.map((recording) =>
      recording.id !== recordingId
        ? recording
        : {
            ...recording,
            files: recording.files.map((file) =>
              match(file.logicalPath)
                ? {
                    ...file,
                    presignedUrl: `${file.presignedUrl}${file.presignedUrl.includes('?') ? '&' : '?'}${query}`,
                  }
                : file,
            ),
          },
    );
}

const videoOf = (camera: string) => (path: string) =>
  path.includes(camera) && path.endsWith('.mp4');

describe('browser: an episode set over two recordings', () => {
  let host: HTMLDivElement;
  let root: Root;

  const panel = (camera: string) => host.querySelector<HTMLElement>(`[data-camera="${camera}"]`);
  const activeVideo = (camera: string) =>
    panel(camera)?.querySelector<HTMLVideoElement>('video[data-lerobot-role="active"]') ?? null;
  const shown = (camera: string) =>
    decodeFrame(
      panel(camera)?.querySelector<HTMLCanvasElement>('canvas[data-lerobot-cover]') ??
        activeVideo(camera),
    );
  const allIn = (episode: number) =>
    CAMERAS.every((camera) => {
      const value = shown(camera);
      const first = EPISODES[episode].first;
      return value !== null && value >= first && value < first + FRAMES;
    });
  const playButton = () => host.querySelector<HTMLButtonElement>('[aria-label="Play/pause"]');
  const slider = () =>
    host.querySelector<HTMLElement>('[role="slider"][aria-label="Playback progress"]');
  async function press(key: string) {
    await act(async () => {
      slider()?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
    });
  }
  const isPlaying = () => Boolean(playButton()?.querySelector('.lucide-pause'));
  const frameText = () =>
    Number(
      host
        .querySelector('[role="slider"][aria-label="Playback progress"]')
        ?.getAttribute('aria-valuenow') ?? '-1',
    );

  async function open(
    options: {
      manifestQuery?: string;
      videoQuery?: Partial<Record<'a' | 'b', string>>;
      refreshQuery?: string | (() => string);
      mutate?: (sets: EpisodeSetRecording[]) => EpisodeSetRecording[];
      waitFirst?: boolean;
      /** The manifest refresh answers this late (ms). */
      refreshDelayMs?: number;
      /** Other episodes than `EPISODES` (rows of the recordings' data files). */
      episodes?: ReadonlyArray<{ recordingId: string; fromRow: number; toRow: number }>;
    } = {},
  ) {
    const load = async (query: string) =>
      (await (
        await fetch(`/e2e-datasets/framecoded-manifest${query}`)
      ).json()) as RemoteFileEntry[];
    const files = await load(options.manifestQuery ?? '');
    const info = (await (
      await fetch(files.find((file) => file.logicalPath === 'meta/info.json')!.presignedUrl)
    ).json()) as { features: Record<string, unknown> };
    let refreshes = 0;
    const mutate = options.mutate ?? ((sets: EpisodeSetRecording[]) => sets);
    const source = createEpisodeSetDataSource(
      {
        fps: FPS,
        features: info.features,
        recordings: mutate(recordings(files, options.videoQuery)),
        episodes: (options.episodes ?? EPISODES).map((episode) => ({
          recordingId: episode.recordingId,
          task: 'look at the counter',
          fromRow: episode.fromRow,
          toRow: episode.toRow,
          fromS: episode.fromRow / FPS,
          toS: episode.toRow / FPS,
        })),
      },
      options.refreshQuery !== undefined
        ? {
            refresh: async () => {
              refreshes += 1;
              if (options.refreshDelayMs) await sleep(options.refreshDelayMs);
              const query =
                typeof options.refreshQuery === 'function'
                  ? options.refreshQuery()
                  : options.refreshQuery!;
              return mutate(recordings(await load(query), options.videoQuery));
            },
          }
        : {},
    );
    await act(async () => {
      root.render(
        <LeRobotViewer
          dataSource={source}
          language="en"
          previewVideoPath={EPISODE_SET_PREVIEW_VIDEO_PATH}
        />,
      );
    });
    if (options.waitFirst !== false) {
      await waitFor(() => allIn(0), 30_000, 'first episode on screen');
    }
    return { refreshes: () => refreshes, openedAt: performance.now() };
  }

  async function selectEpisode(index: number) {
    const row = host.querySelector<HTMLElement>(`[aria-label="Select Episode ${index}"]`);
    expect(row, `episode row ${index}`).not.toBeNull();
    await act(async () => row!.click());
  }

  async function setPlaying(playing: boolean) {
    await waitFor(() => Boolean(playButton() && !playButton()!.disabled), 30_000, 'play button');
    if (isPlaying() !== playing) await act(async () => playButton()!.click());
    await waitFor(() => isPlaying() === playing, 10_000, playing ? 'playing' : 'paused');
  }

  beforeEach(async () => {
    describeState = () =>
      JSON.stringify({
        playing: isPlaying(),
        frame: frameText(),
        cameras: CAMERAS.map((camera) => ({
          camera,
          status: panel(camera)?.dataset.cameraStatus,
          error: panel(camera)?.dataset.videoError,
          shown: shown(camera),
          videos: Array.from(panel(camera)?.querySelectorAll('video') ?? []).map((video) => ({
            role: video.dataset.lerobotRole,
            src: video.getAttribute('src')?.replace(/^.*\/e2e-datasets\//, ''),
            readyState: video.readyState,
            time: Number(video.currentTime.toFixed(3)),
            paused: video.paused,
          })),
        })),
      });
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

  it('holds the clock while the cameras switch, playing, into an episode at an offset of a slow recording', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    // recording b's videos answer slowly
    await open({ videoQuery: { b: 'delayMs=1500' } });
    await setPlaying(true);
    await sleep(800);
    await selectEpisode(2);
    let ranAhead = 0;
    const startedAt = performance.now();
    await waitFor(
      () => {
        if (!allIn(2)) ranAhead = Math.max(ranAhead, frameText());
        return allIn(2) && isPlaying();
      },
      30_000,
      'episode 2 playing',
    );
    const switchMs = performance.now() - startedAt;
    // the timeline did not run while the cameras showed no picture of episode 2
    expect(ranAhead, describeState()).toBeLessThanOrEqual(1);
    // and then plays every camera, in sync
    await sleep(1_000);
    const values = CAMERAS.map(shown);
    expect(allIn(2), describeState()).toBe(true);
    expect(Math.abs((values[0] ?? 0) - (values[1] ?? 0)), describeState()).toBeLessThanOrEqual(2);
    expect(frameText()).toBeGreaterThan(10);
    console.log(`[episode-set] playing switch into a slow recording: ${Math.round(switchMs)} ms`);
  });

  it('a camera that never gets ready does not hold the others for ever', async ({ skip }) => {
    if (!(await frameCodedAvailable())) return skip();
    const { SWITCH_HOLD_POLICY } = await import('../../src/react/services/video/CameraPlayer');
    const saved = SWITCH_HOLD_POLICY.maxMs;
    SWITCH_HOLD_POLICY.maxMs = 2_000;
    try {
      // the wrist camera's videos of recording b hang for 20 s
      await open({
        mutate: (sets) =>
          sets.map((recording) =>
            recording.id !== 'b'
              ? recording
              : {
                  ...recording,
                  files: recording.files.map((file) =>
                    file.logicalPath.includes('observation.images.wrist') &&
                    file.logicalPath.endsWith('.mp4')
                      ? { ...file, presignedUrl: `${file.presignedUrl}?delayMs=20000` }
                      : file,
                  ),
                },
          ),
      });
      await setPlaying(true);
      await sleep(500);
      await selectEpisode(2);
      // the front camera plays on after the hold limit; the wrist one shows its placeholder
      await waitFor(
        () => {
          const value = shown(CAMERAS[0]);
          return value !== null && value > EPISODES[2].first + 15 && isPlaying();
        },
        15_000,
        'front camera playing episode 2 without the wrist camera',
      );
      expect(shown(CAMERAS[1]), describeState()).toBeNull();
    } finally {
      SWITCH_HOLD_POLICY.maxMs = saved;
    }
  });

  it('never plays a URL past its expiry: the playing camera and a prefetched next episode renew', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    // URLs that expire 8 s after opening; the refresh signs for 10 minutes
    await requestLog(true);
    const { refreshes, openedAt } = await open({
      manifestQuery: '?expiresInMs=8000&sig=1',
      refreshQuery: '?expiresInMs=600000&sig=2',
    });
    await setPlaying(true);
    // episode 0 (3 s) plays into episode 1 (recording b, prefetched with the first URLs), on into
    // episode 2, past the first URLs' expiry
    await waitFor(() => allIn(2) && isPlaying(), 30_000, 'episode 2 playing');
    // past the expiry of the first URLs
    await sleep(Math.max(0, 9_000 - (performance.now() - openedAt)));
    const log = await requestLog();
    const refused = log.filter((entry) => entry.status === 403 && entry.path.endsWith('.mp4'));
    expect(refused, JSON.stringify(refused)).toEqual([]);
    for (const camera of CAMERAS) {
      expect(panel(camera)?.dataset.videoError, describeState()).toBeUndefined();
    }
    expect(refreshes()).toBeGreaterThanOrEqual(1);
  });

  it('renews the URLs of playing and prefetched cameras through many URL lifetimes (scaled down)', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    // A 150 s presign TTL with the default margins, at a tenth of the time: URLs live 15 s, the
    // manifest renews 6 s ahead (at most every 2 s), the loader re-fetches URLs 4.5 s ahead, the
    // cameras renew 9 s ahead. The server refuses an expired URL (403).
    const { MANIFEST_REFRESH_POLICY } =
      await import('../../src/platform/datasource/RemoteManifestDataSource');
    const { URL_EXPIRY_POLICY } = await import('../../src/platform/services/LeRobotDataLoader');
    const saved = { ...MANIFEST_REFRESH_POLICY, loader: URL_EXPIRY_POLICY.marginMs };
    MANIFEST_REFRESH_POLICY.marginMs = 6_000;
    MANIFEST_REFRESH_POLICY.minProactiveMs = 2_000;
    URL_EXPIRY_POLICY.marginMs = 4_500;
    VIDEO_URL_POLICY.renewLeadMs = 9_000;
    let signature = 1;
    try {
      await requestLog(true);
      // every refresh signs anew for 15 s
      await open({
        manifestQuery: '?expiresInMs=15000&sig=1',
        refreshQuery: () => `?expiresInMs=15000&sig=${(signature += 1)}`,
        // a refresh takes a round trip to the server (slow under load)
        refreshDelayMs: 1_500,
      });
      const startedAt = performance.now();
      await setPlaying(true);
      const errors = new Set<string>();
      // the clock never runs while a camera shows a picture of another episode
      let wrong = 0;
      let lastFrame = frameText();
      const wrongTrace: string[] = [];
      let watching = true;
      const watch = () => {
        if (!watching) return;
        const frame = frameText();
        const current = Number(
          host
            .querySelector('[aria-current="true"][aria-label^="Select Episode"]')
            ?.getAttribute('aria-label')
            ?.replace(/\D+/g, '') ?? '-1',
        );
        // (the frames around a switch excepted: the selection and the pictures change a frame apart)
        if (
          lastFrame > 2 &&
          frame > lastFrame &&
          frame - lastFrame < 10 &&
          frame < FRAMES - 3 &&
          current >= 0 &&
          isPlaying()
        ) {
          const first = EPISODES[current].first;
          for (const camera of CAMERAS) {
            const value = shown(camera);
            if (value !== null && (value < first || value >= first + FRAMES)) {
              wrong += frame - lastFrame;
              if (wrongTrace.length < 20)
                wrongTrace.push(`${camera}@ep${current}:${frame}=${value}`);
            }
          }
        }
        lastFrame = frame;
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
      // play the set through, three times, past several URL lifetimes
      for (let round = 0; round < 3; round++) {
        for (let episode = 0; episode < EPISODES.length; episode++) {
          await waitFor(
            () => {
              for (const camera of CAMERAS) {
                const code = panel(camera)?.dataset.videoError;
                if (code) errors.add(code);
              }
              return allIn(episode);
            },
            15_000,
            `round ${round} episode ${episode}`,
          );
        }
        await waitFor(() => !isPlaying() || allIn(EPISODES.length - 1), 10_000, 'end');
        await selectEpisode(0);
        await setPlaying(true);
      }
      const log = await requestLog();
      const refused = log.filter((entry) => entry.status === 403 && entry.path.endsWith('.mp4'));
      console.log(
        `[episode-set] ${Math.round((performance.now() - startedAt) / 1000)} s of playback, ${refused.length} refused video requests`,
      );
      expect(refused.map((entry) => `${entry.path}?${entry.query}`)).toEqual([]);
      expect([...errors]).toEqual([]);
      watching = false;
      expect(wrong, wrongTrace.join(' ')).toBeLessThanOrEqual(2);
    } finally {
      MANIFEST_REFRESH_POLICY.marginMs = saved.marginMs;
      MANIFEST_REFRESH_POLICY.minProactiveMs = saved.minProactiveMs;
      URL_EXPIRY_POLICY.marginMs = saved.loader;
    }
  });

  it('a prefetched next episode kept past its URL renewal is renewed, and the switch takes it over', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    // scaled lifetimes (see above): URLs live 15 s, renewed 9 s ahead
    const { MANIFEST_REFRESH_POLICY } =
      await import('../../src/platform/datasource/RemoteManifestDataSource');
    const { URL_EXPIRY_POLICY } = await import('../../src/platform/services/LeRobotDataLoader');
    const saved = { ...MANIFEST_REFRESH_POLICY, loader: URL_EXPIRY_POLICY.marginMs };
    MANIFEST_REFRESH_POLICY.marginMs = 6_000;
    MANIFEST_REFRESH_POLICY.minProactiveMs = 2_000;
    URL_EXPIRY_POLICY.marginMs = 4_500;
    VIDEO_URL_POLICY.renewLeadMs = 9_000;
    let signature = 1;
    try {
      await open({
        manifestQuery: '?expiresInMs=15000&sig=1',
        refreshQuery: () => `?expiresInMs=15000&sig=${(signature += 1)}`,
      });
      await setPlaying(false);
      // near the end of episode 0, paused: the next episode (recording b) is prefetched while idle
      await act(async () => {
        slider()!.focus();
      });
      await press('End');
      for (let step = 0; step < 15; step++) await press('ArrowLeft');
      // idle past the prefetched URL's renewal time
      await sleep(14_000);
      await requestLog(true);
      await setPlaying(true);
      await waitFor(() => allIn(1) && isPlaying(), 15_000, 'episode 1 playing');
      // the switch took the prefetched standby over: no video of recording b loaded from its start
      const reloads = (await requestLog()).filter(
        (entry) =>
          entry.path.endsWith('.mp4') &&
          entry.path.includes('file-001') &&
          (entry.range === null || entry.range === 'bytes=0-'),
      );
      expect(reloads.map((entry) => `${entry.path} ${entry.range}`)).toEqual([]);
      const refused = (await requestLog()).filter((entry) => entry.status === 403);
      expect(refused.map((entry) => entry.path)).toEqual([]);
    } finally {
      MANIFEST_REFRESH_POLICY.marginMs = saved.marginMs;
      MANIFEST_REFRESH_POLICY.minProactiveMs = saved.minProactiveMs;
      URL_EXPIRY_POLICY.marginMs = saved.loader;
    }
  });

  it('a renewal that gets the same URL back leaves a prefetched next episode loaded', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    // URLs that expire within the renewal lead, from a source without refresh: every renewal gets
    // the same URL back (and backs off: 5 s, then 10 s apart)
    VIDEO_URL_POLICY.renewLeadMs = 121_000;
    const nextLoads = async (clear = false) =>
      (await requestLog(clear)).filter(
        (entry) =>
          entry.path.endsWith('.mp4') &&
          entry.path.includes('file-001') &&
          (entry.range === null || entry.range === 'bytes=0-'),
      );
    await requestLog(true);
    await open({ manifestQuery: '?expiresInMs=110000&sig=1' });
    await setPlaying(false);
    // near the end of episode 0, paused: the next episode (recording b) is prefetched while idle
    await act(async () => {
      slider()!.focus();
    });
    await press('End');
    for (let step = 0; step < 15; step++) await press('ArrowLeft');
    const deadline = performance.now() + 15_000;
    while ((await nextLoads()).length < CAMERAS.length) {
      expect(performance.now() < deadline, 'the next episode is prefetched').toBe(true);
      await sleep(200);
    }
    await nextLoads(true);
    // renewals come and go (5 s, then 10 s apart): the prefetch stays, never torn down and loaded
    // again (the media cache may hide the reload from the server, not from the element)
    const reloads: string[] = [];
    const listeners = [...document.querySelectorAll('video')].flatMap((video) =>
      ['emptied', 'loadstart'].map((type) => {
        const listener = () => reloads.push(`${type} ${video.getAttribute('src') ?? ''}`);
        video.addEventListener(type, listener);
        return () => video.removeEventListener(type, listener);
      }),
    );
    await sleep(16_000);
    listeners.forEach((remove) => remove());
    expect(reloads).toEqual([]);
    expect((await nextLoads()).map((entry) => `${entry.path} ${entry.range}`)).toEqual([]);
  });

  it('Retry loads a camera that failed before it showed anything; one request per attempt', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    DEFAULT_RETRY_POLICY.baseMs = 100;
    DEFAULT_RETRY_POLICY.maxMs = 200;
    await requestLog(true);
    // the wrist camera's preview of recording a fails 7 times, then works
    const broken = 'meta/preview/videos/observation.images.wrist/chunk-000/file-000.mp4';
    await open({
      waitFirst: false,
      mutate: (sets) =>
        sets.map((recording) =>
          recording.id !== 'a'
            ? recording
            : {
                ...recording,
                files: recording.files.map((file) =>
                  file.logicalPath === broken
                    ? {
                        ...file,
                        presignedUrl: `${file.presignedUrl}?fail=500&failTimes=7&run=${Date.now()}`,
                      }
                    : file,
                ),
              },
        ),
    });
    const wrist = () => panel(CAMERAS[1]);
    await waitFor(
      () => wrist()?.dataset.cameraStatus === 'error',
      30_000,
      'wrist camera gives up with a named error',
    );
    const brokenRequests = (await requestLog()).filter((entry) => entry.path === broken);
    // the first load, then one request per retry (5 attempts in the budget); never two at once
    expect(brokenRequests.length, JSON.stringify(brokenRequests)).toBeLessThanOrEqual(6);
    const gaps = brokenRequests.slice(1).map((entry, index) => entry.at - brokenRequests[index].at);
    expect(Math.min(...gaps), JSON.stringify(gaps)).toBeGreaterThanOrEqual(80);
    // Retry: the camera loads (the server works by now)
    const retry = Array.from(wrist()!.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => /retry/i.test(button.textContent ?? ''),
    );
    expect(retry, 'retry button').not.toBeNull();
    await act(async () => retry!.click());
    await waitFor(
      () => wrist()?.dataset.cameraStatus === 'ready' && shown(CAMERAS[1]) !== null,
      15_000,
      'wrist camera shows its picture after Retry',
    );
  });

  it('a camera whose switch fails lets the others play on (playing, and paused then Play)', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    DEFAULT_RETRY_POLICY.baseMs = 100;
    DEFAULT_RETRY_POLICY.maxMs = 200;
    // the wrist camera's videos of recording b are gone (404)
    await open({ mutate: patchFiles('b', videoOf(CAMERAS[1]), `fail=404&run=${Date.now()}`) });
    await setPlaying(true);
    await sleep(500);
    await selectEpisode(2);
    await waitFor(() => panel(CAMERAS[1])?.dataset.cameraStatus === 'error', 20_000, 'wrist error');
    // the front camera and the timeline play on without it
    const front = () => shown(CAMERAS[0]);
    await waitFor(
      () => isPlaying() && frameText() > 30 && (front() ?? 0) > EPISODES[2].first + 30,
      10_000,
      'front camera plays episode 2 on',
    );
    expect(allIn(2) || shown(CAMERAS[1]) === null, describeState()).toBe(true);

    // paused: a switch into the failing recording, then Play
    await setPlaying(false);
    await selectEpisode(3);
    await waitFor(() => allIn(3), 15_000, 'episode 3 on screen');
    await setPlaying(false);
    await selectEpisode(1);
    await waitFor(() => panel(CAMERAS[1])?.dataset.cameraStatus === 'error', 20_000, 'wrist error');
    await setPlaying(true);
    await waitFor(
      () => isPlaying() && frameText() > 30 && (front() ?? 0) > EPISODES[1].first + 30,
      10_000,
      'front camera plays episode 1 after Play',
    );
  });

  it('Retry after a failed switch loads the episode switched to, not the one before', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    DEFAULT_RETRY_POLICY.baseMs = 100;
    DEFAULT_RETRY_POLICY.maxMs = 200;
    // two episodes: a 3 s one in recording a, then all of recording b (6 s, dataset frames 180-359)
    const inSecond = (value: number | null) => value !== null && value >= 180 && value < 360;
    // the wrist camera's preview of recording b fails 9 times (past the retry budget), then works
    await open({
      waitFirst: false,
      episodes: [
        { recordingId: 'a', fromRow: 90, toRow: 180 },
        { recordingId: 'b', fromRow: 0, toRow: 180 },
      ],
      mutate: patchFiles(
        'b',
        (path) => path === RECORDING_PREVIEW.replace('{video_key}', CAMERAS[1]),
        `fail=500&failTimes=9&run=${Date.now()}`,
      ),
    });
    await waitFor(() => allIn(0), 30_000, 'first episode on screen');
    await setPlaying(true);
    await sleep(500);
    await selectEpisode(1);
    const wrist = () => panel(CAMERAS[1]);
    await waitFor(() => wrist()?.dataset.cameraStatus === 'error', 30_000, 'wrist gives up');
    // the front camera played on in the episode switched to
    expect(inSecond(shown(CAMERAS[0])), describeState()).toBe(true);
    const retry = Array.from(wrist()!.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => /retry/i.test(button.textContent ?? ''),
    );
    expect(retry, 'retry button').not.toBeNull();
    await act(async () => retry!.click());
    // the wrist camera loads that episode (never the one before), and joins the playing clock
    let before = 0;
    await waitFor(
      () => {
        const value = shown(CAMERAS[1]);
        if (value !== null && value < 180) before += 1;
        const front = shown(CAMERAS[0]);
        return (
          wrist()?.dataset.cameraStatus === 'ready' &&
          inSecond(value) &&
          inSecond(front) &&
          Math.abs((value ?? 0) - (front ?? 0)) <= 2
        );
      },
      15_000,
      'wrist camera shows the second episode after Retry, in sync',
    );
    expect(before, describeState()).toBe(0);
  });

  it('a late first camera joins the playing clock without moving the timeline back', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    const { SWITCH_HOLD_POLICY } = await import('../../src/react/services/video/CameraPlayer');
    const saved = SWITCH_HOLD_POLICY.maxMs;
    SWITCH_HOLD_POLICY.maxMs = 1_000;
    try {
      // the FRONT camera (registered first: the clock's master) answers late in recording b
      await open({ mutate: patchFiles('b', videoOf(CAMERAS[0]), 'delayMs=2500') });
      await setPlaying(true);
      await sleep(500);
      await selectEpisode(2);
      let max = 0;
      let backJump = 0;
      const trace: number[] = [];
      const startedAt = performance.now();
      // through episode 2 (3 s; it plays on into episode 3 at its end)
      while (performance.now() - startedAt < 6_000 && max < FRAMES - 15) {
        const frame = frameText();
        trace.push(frame);
        max = Math.max(max, frame);
        if (isPlaying()) backJump = Math.max(backJump, max - frame);
        await sleep(50);
      }
      expect(backJump, `${trace.join(',')}\n${describeState()}`).toBeLessThanOrEqual(1);
      await waitFor(
        () => {
          const values = CAMERAS.map(shown);
          return (
            values.every((value) => value !== null) &&
            Math.abs((values[0] ?? 0) - (values[1] ?? 0)) <= 2
          );
        },
        10_000,
        'both cameras on screen, in sync',
      );
    } finally {
      SWITCH_HOLD_POLICY.maxMs = saved;
    }
  });

  it('the switch hold counts playing time only, and a new selection holds again', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    const { SWITCH_HOLD_POLICY } = await import('../../src/react/services/video/CameraPlayer');
    const saved = SWITCH_HOLD_POLICY.maxMs;
    SWITCH_HOLD_POLICY.maxMs = 2_000;
    try {
      await open({ mutate: patchFiles('b', videoOf(CAMERAS[0]), 'delayMs=6000') });
      // paused: a switch into the slow recording, Play shortly before the hold limit
      await setPlaying(false);
      await selectEpisode(2);
      await sleep(1_700);
      await setPlaying(true);
      // the clock still waits for the slow camera (the paused time did not count)
      const playedAt = performance.now();
      let ran = 0;
      while (performance.now() - playedAt < 1_000) {
        if (!allIn(2)) ran = Math.max(ran, frameText());
        await sleep(50);
      }
      expect(ran, describeState()).toBeLessThanOrEqual(1);

      // playing: a switch that comes late, then another episode of the same file while it loads
      SWITCH_HOLD_POLICY.maxMs = 1_500;
      await selectEpisode(3);
      await waitFor(() => allIn(3) && isPlaying(), 15_000, 'episode 3 playing');
      await selectEpisode(1);
      await sleep(1_800); // late by now: the clock runs without the front camera
      await selectEpisode(2);
      const selectedAt = performance.now();
      let ahead = 0;
      await waitFor(
        () => {
          if (!allIn(2)) ahead = Math.max(ahead, frameText());
          return allIn(2) || performance.now() - selectedAt > 1_200;
        },
        5_000,
        'episode 2 or the hold limit',
      );
      // the new selection held the clock again
      expect(ahead, describeState()).toBeLessThanOrEqual(1);
    } finally {
      SWITCH_HOLD_POLICY.maxMs = saved;
    }
  });

  it('a layout rebuild while playing keeps playing; the Raw panel shows the frame playback stops on', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    // two 6 s episodes (whole recordings), so the rebuilds happen within one episode
    await open({
      waitFirst: false,
      episodes: [
        { recordingId: 'a', fromRow: 0, toRow: 180 },
        { recordingId: 'b', fromRow: 0, toRow: 180 },
      ],
    });
    await waitFor(() => CAMERAS.every((camera) => shown(camera) !== null), 30_000, 'first picture');
    const proto = Element.prototype as Element & { moveBefore?: unknown };
    const nativeMove = proto.moveBefore;
    try {
      // with the state-preserving move, and with a plain append (browsers without moveBefore)
      for (const mode of ['native', 'append'] as const) {
        if (mode === 'append') delete proto.moveBefore;
        await setPlaying(true);
        for (const width of ['520px', '1400px']) {
          host.style.width = width;
          await sleep(600);
          const paused = CAMERAS.filter((camera) => activeVideo(camera)?.paused !== false);
          expect(paused, `${mode} ${width}: ${describeState()}`).toEqual([]);
          expect(isPlaying()).toBe(true);
        }
        await setPlaying(false);
        // the Raw panel shows the frame playback stopped on (its trailing update)
        await sleep(400);
        const rawFrame = () => {
          const key = Array.from(host.querySelectorAll('span')).find(
            (span) => span.textContent === '"index": ',
          );
          return Number(key?.nextElementSibling?.textContent ?? 'NaN');
        };
        // (the episode is rows 0-179 of recording a: its dataset index is the frame)
        expect(rawFrame(), `${mode}: ${describeState()}`).toBe(frameText());
        await act(async () => {
          slider()!.focus();
        });
        await press('Home');
      }
    } finally {
      if (nativeMove !== undefined) proto.moveBefore = nativeMove;
    }
  });

  it('the bar, the chart and the time base are the episode own, also after it plays on into the next', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    // episodes that start inside the fixture's episodes (whose timestamps run from 0 every 90
    // rows): 60 frames from 1 s, then 80 frames from 0.33 s of another recording
    await open({
      waitFirst: false,
      episodes: [
        { recordingId: 'a', fromRow: 30, toRow: 90 },
        { recordingId: 'b', fromRow: 100, toRow: 180 },
      ],
    });
    await waitFor(() => CAMERAS.every((camera) => shown(camera) !== null), 30_000, 'first picture');
    await setPlaying(false);
    const barText = () =>
      playButton()?.closest('div')?.parentElement?.textContent?.replace(/\s+/g, '') ?? '';
    const xRange = () => {
      const range = host.querySelector<HTMLElement>('[data-x-range]')?.dataset.xRange;
      return range ? range.split(':').map(Number) : null;
    };
    // episode time: from 0:00 to the episode's length (1.97 s), not its data's 1-2.97 s
    await waitFor(() => /\/0:01\.96/.test(barText()), 10_000, `bar total: ${barText()}`);
    await waitFor(
      () => {
        const range = xRange();
        return range !== null && Math.abs(range[0]) < 0.05 && Math.abs(range[1] - 1.967) < 0.05;
      },
      10_000,
      `chart range of the first episode: ${xRange()}`,
    );
    // plays on into the next episode: the bar and the chart follow it
    await setPlaying(true);
    await waitFor(
      () => {
        const range = xRange();
        return (
          /\/0:02\.63/.test(barText()) &&
          range !== null &&
          Math.abs(range[0]) < 0.05 &&
          Math.abs(range[1] - 2.633) < 0.05
        );
      },
      15_000,
      'bar and chart of the second episode',
    );
    await setPlaying(false);
    await act(async () => {
      slider()!.focus();
    });
    await press('End');
    await waitFor(
      () => /0:02\.63\/0:02\.63/.test(barText()),
      5_000,
      `bar at the end: ${barText()}`,
    );
  });

  it('a paused step while a switch loads: every camera lands on the stepped frame', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    // the wrist camera's videos of recording b answer late
    await open({ mutate: patchFiles('b', videoOf(CAMERAS[1]), 'delayMs=1500') });
    await setPlaying(false);
    await selectEpisode(2);
    // the front camera is ready (and waits for the wrist one to switch together); step meanwhile
    await sleep(500);
    await act(async () => {
      slider()!.focus();
    });
    for (let step = 0; step < 3; step++) {
      await press('ArrowRight');
      await sleep(60);
    }
    await waitFor(
      () => frameText() === 3 && CAMERAS.every((camera) => shown(camera) === EPISODES[2].first + 3),
      10_000,
      'both cameras on frame 3 of episode 2',
    );
  });

  it('layout changes while playing do not stall or pause the cameras on screen', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    await open({
      waitFirst: false,
      episodes: [
        { recordingId: 'a', fromRow: 0, toRow: 180 },
        { recordingId: 'b', fromRow: 0, toRow: 180 },
      ],
    });
    await waitFor(() => CAMERAS.every((camera) => shown(camera) !== null), 30_000, 'first picture');
    await setPlaying(true);
    await sleep(500);
    const events: string[] = [];
    const listen = (event: Event) => {
      const video = event.target as HTMLVideoElement;
      if (video.dataset.lerobotRole === 'active')
        events.push(
          `${event.type}:${video.dataset.lerobotCamera?.split('.').pop()}@${Math.round(performance.now())}`,
        );
    };
    for (const type of ['waiting', 'pause', 'seeking'])
      document.addEventListener(type, listen, true);
    try {
      for (const width of ['900px', '520px', '1400px', '700px', '1400px']) {
        host.style.width = width;
        await sleep(500);
      }
      expect(isPlaying()).toBe(true);
      // (a panel moved in the page pauses its element for a moment: it plays on at once)
      expect(
        events.filter((event) => !event.startsWith('pause:')),
        describeState(),
      ).toEqual([]);
      await sleep(300);
      expect(
        CAMERAS.filter((camera) => activeVideo(camera)?.paused !== false),
        describeState(),
      ).toEqual([]);
    } finally {
      for (const type of ['waiting', 'pause', 'seeking'])
        document.removeEventListener(type, listen, true);
    }
  });

  it('a camera hidden for a while joins the playing clock when shown again, without holding the others', async ({
    skip,
  }) => {
    if (!(await frameCodedAvailable())) return skip();
    await open({
      waitFirst: false,
      episodes: [
        { recordingId: 'a', fromRow: 0, toRow: 180 },
        { recordingId: 'b', fromRow: 0, toRow: 180 },
      ],
    });
    await waitFor(() => CAMERAS.every((camera) => shown(camera) !== null), 30_000, 'first picture');
    await setPlaying(true);
    const hidden = CAMERAS.find((camera) => panel(camera)!.getBoundingClientRect().left < 400);
    expect(hidden, 'a camera on the left half').toBeDefined();
    const visible = CAMERAS.find((camera) => camera !== hidden)!;
    // the left half leaves the viewport for longer than a camera stays loaded while hidden
    host.style.transform = 'translateX(-880px)';
    await sleep(3_200);
    // it let go of its element (a cover holds its last picture)
    expect(
      panel(hidden!)!.querySelector('canvas[data-lerobot-cover]'),
      describeState(),
    ).not.toBeNull();
    const events: string[] = [];
    const listen = (event: Event) => {
      const video = event.target as HTMLVideoElement;
      if (video.dataset.lerobotCamera === visible && video.dataset.lerobotRole === 'active')
        events.push(`${event.type}@${frameText()}`);
    };
    for (const type of ['waiting', 'pause', 'seeking'])
      document.addEventListener(type, listen, true);
    try {
      const before = frameText();
      host.style.transform = '';
      // it joins in sync
      await waitFor(
        () => {
          const values = CAMERAS.map(shown);
          return (
            !panel(hidden!)!.querySelector('canvas[data-lerobot-cover]') &&
            activeVideo(hidden!)?.paused === false &&
            values.every((value) => value !== null) &&
            Math.abs(values[0]! - values[1]!) <= 2 &&
            frameText() > before + 10
          );
        },
        10_000,
        'the hidden camera back in sync',
      );
      // the camera on screen played on meanwhile
      expect(events, describeState()).toEqual([]);
    } finally {
      for (const type of ['waiting', 'pause', 'seeking'])
        document.removeEventListener(type, listen, true);
    }
  });

  it('after playing on into the next episode, a pause stays paused', async ({ skip }) => {
    if (!(await frameCodedAvailable())) return skip();
    await open();
    await setPlaying(true);
    // episode 0 plays on into episode 1
    await waitFor(() => allIn(1) && isPlaying() && frameText() > 10, 15_000, 'episode 1 playing');
    // the keyboard's pause (and the button's)
    for (const how of ['key', 'button'] as const) {
      if (how === 'key') {
        (document.activeElement as HTMLElement | null)?.blur();
        await userEvent.keyboard(' ');
      } else {
        await act(async () => playButton()!.click());
      }
      await waitFor(() => !isPlaying(), 5_000, `${how}: paused`);
      const at = frameText();
      await sleep(1_500);
      expect(isPlaying(), `${how}: ${describeState()}`).toBe(false);
      expect(frameText()).toBe(at);
      if (how === 'key') {
        // on into the next episode again
        await setPlaying(true);
        await waitFor(() => allIn(2) && isPlaying() && frameText() > 10, 15_000, 'episode 2');
      }
    }
  });

  describe('quick reselection', () => {
    // long episodes (5-6 s) over both recordings, each told apart by its first dataset frame
    const LONG = [
      { recordingId: 'a', fromRow: 0, toRow: 180, first: 0 },
      { recordingId: 'b', fromRow: 0, toRow: 180, first: 180 },
      { recordingId: 'a', fromRow: 30, toRow: 180, first: 30 },
      { recordingId: 'b', fromRow: 30, toRow: 180, first: 210 },
      { recordingId: 'a', fromRow: 60, toRow: 180, first: 60 },
    ];
    const selected = () =>
      Number(
        host
          .querySelector('[aria-current="true"][aria-label^="Select Episode"]')
          ?.getAttribute('aria-label')
          ?.replace(/\D+/g, '') ?? '-1',
      );
    /** Every camera shows `episode` at the clock's frame. */
    const onClock = (episode: number) =>
      CAMERAS.every((camera) => {
        const value = shown(camera);
        return value !== null && Math.abs(value - (LONG[episode].first + frameText())) <= 3;
      });
    const slow = (sets: EpisodeSetRecording[]) =>
      ['a', 'b'].reduce(
        (all, id) =>
          patchFiles(
            id,
            (path) => path.startsWith('data/'),
            'delayMs=800',
          )(patchFiles(id, (path) => path.endsWith('.mp4'), 'delayMs=1500')(all)),
        sets,
      );

    async function settlesOn(episode: number, what: string) {
      await waitFor(
        () => selected() === episode && isPlaying() && frameText() > 5 && onClock(episode),
        10_000,
        `${what}: episode ${episode} playing on every camera (selected ${selected()})`,
      );
      // and stays there, playing
      const at = frameText();
      await sleep(600);
      expect(selected(), `${what}: ${describeState()}`).toBe(episode);
      expect(frameText(), `${what}: the clock runs ${describeState()}`).toBeGreaterThan(at + 5);
    }

    it('the first episode: a camera slower than the others still joins, and the clock waits for it', async ({
      skip,
    }) => {
      if (!(await frameCodedAvailable())) return skip();
      // the wrist camera's videos of recording a answer late; the first episode autoplays
      await open({
        waitFirst: false,
        episodes: LONG,
        mutate: patchFiles('a', videoOf(CAMERAS[1]), 'delayMs=2500'),
      });
      let ranAhead = 0;
      await waitFor(
        () => {
          if (shown(CAMERAS[1]) === null) ranAhead = Math.max(ranAhead, frameText());
          return selected() === 0 && isPlaying() && frameText() > 5 && onClock(0);
        },
        20_000,
        `both cameras on the first episode (selected ${selected()})`,
      );
      expect(ranAhead, describeState()).toBeLessThanOrEqual(1);
    });

    it('back and forth between episodes of one file never runs into the next episode', async ({
      skip,
    }) => {
      if (!(await frameCodedAvailable())) return skip();
      // two episodes of recording a (0-2.5 s and 3.5-6 s), then one of b
      const SAME = [
        { recordingId: 'a', fromRow: 0, toRow: 75, first: 0 },
        { recordingId: 'a', fromRow: 105, toRow: 180, first: 105 },
        { recordingId: 'b', fromRow: 0, toRow: 90, first: 180 },
      ];
      await open({ waitFirst: false, episodes: SAME });
      const on = (episode: number) =>
        CAMERAS.every((camera) => {
          const value = shown(camera);
          return value !== null && Math.abs(value - (SAME[episode].first + frameText())) <= 3;
        });
      await waitFor(() => selected() === 0 && isPlaying() && on(0), 20_000, 'first episode');
      // seeks take 400 ms (data not buffered yet, as on a long recording): the seek to episode 1
      // is still on its way when episode 0 is selected again, so the element sits in episode 1
      // (3.5 s on) while the selection is episode 0 (0-2.5 s)
      for (const video of document.querySelectorAll('video')) slowSeeks(video, 400);
      const episode0Frames = SAME[0].toRow - SAME[0].fromRow;
      for (let round = 0; round < 4; round++) {
        await sleep(400);
        await selectEpisode(1);
        await sleep(100);
        await selectEpisode(0);
        // nothing outside the selection drives the bar or ends the episode: the selection stays
        // and the bar never runs past episode 0 (an element still in episode 1 read against
        // episode 0 reads as frame 105 on)
        const wrong: string[] = [];
        let watching = true;
        const watch = () => {
          if (!watching) return;
          if (selected() !== 0 || frameText() >= episode0Frames - 1)
            wrong.push(`selected ${selected()} frame ${frameText()}`);
          requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
        await waitFor(
          () => selected() === 0 && isPlaying() && frameText() > 5 && on(0),
          10_000,
          `round ${round}: back on episode 0 (selected ${selected()})`,
        ).finally(() => {
          watching = false;
        });
        expect(wrong, `round ${round}: ${describeState()}`).toEqual([]);
        expect(selected(), describeState()).toBe(0);
      }
    });

    it('a second click 100 ms after the first lands on the second episode, every camera on it', async ({
      skip,
    }) => {
      if (!(await frameCodedAvailable())) return skip();
      await open({ waitFirst: false, episodes: LONG, mutate: slow });
      await settlesOn(0, 'first episode');
      for (const [first, second] of [
        [0, 3],
        [4, 1],
        [3, 0],
        [2, 3],
        [0, 1],
        [4, 2],
      ] as const) {
        await selectEpisode(first);
        await sleep(100 + ((first * 7 + second * 13) % 4) * 100);
        await selectEpisode(second);
        await settlesOn(second, `${first}→${second}`);
      }
    });

    it('on a fresh page, a second click 100 ms after the first loads every camera', async ({
      skip,
    }) => {
      if (!(await frameCodedAvailable())) return skip();
      await open({ waitFirst: false, episodes: LONG, mutate: slow });
      await waitFor(
        () => host.querySelector('[aria-label="Select Episode 1"]') !== null,
        30_000,
        'episode list',
      );
      await selectEpisode(0);
      await sleep(100);
      await selectEpisode(1);
      await settlesOn(1, 'fresh 0→1');
    });
  });
});
