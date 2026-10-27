import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
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
        episodes: EPISODES.map((episode) => ({
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
      });
      const startedAt = performance.now();
      await setPlaying(true);
      const errors = new Set<string>();
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
    } finally {
      MANIFEST_REFRESH_POLICY.marginMs = saved.marginMs;
      MANIFEST_REFRESH_POLICY.minProactiveMs = saved.minProactiveMs;
      URL_EXPIRY_POLICY.marginMs = saved.loader;
    }
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
    // the first load, its probe, then one request per retry (5 attempts in the budget)
    expect(brokenRequests.length, JSON.stringify(brokenRequests)).toBeLessThanOrEqual(7);
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
});
