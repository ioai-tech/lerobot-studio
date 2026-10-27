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
});
