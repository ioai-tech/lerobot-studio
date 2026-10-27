import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cdp, page } from 'vitest/browser';
import {
  EPISODE_SET_PREVIEW_VIDEO_PATH,
  LeRobotViewer,
  createEpisodeSetDataSource,
  type EpisodeSetRecording,
  type RemoteFileEntry,
} from '@/public-api';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Opt-in: LEROBOT_LARGE_DATASET=<dataset root> (a long multi-camera recording with a preview copy
 * under meta/embodiflow/preview), best with LEROBOT_E2E_THROTTLE_MBPS=20. A curated version: an
 * episode set over two "recordings" (the same files under two URLs, so the browser cannot share
 * their caches), with episodes far into one file and at an offset in the other. Switching while
 * playing and paused, the next episode at an episode end, and the clock never running ahead of the
 * pictures.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PREVIEW = 'meta/embodiflow/preview/videos/{video_key}/chunk-000/file-000.mp4';
const FPS = 30;

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

/** Episode `[fromS, toS)` of recording `id`. */
interface Span {
  recordingId: 'a' | 'b';
  fromS: number;
  toS: number;
}

/** Episodes: 0 far into recording a, 1 and 2 at offsets in b, 3 back in a. */
const SPANS: Span[] = [
  { recordingId: 'a', fromS: 1200, toS: 1215 },
  { recordingId: 'b', fromS: 40, toS: 55 },
  { recordingId: 'b', fromS: 100, toS: 115 },
  { recordingId: 'a', fromS: 600, toS: 615 },
];

describe('browser: a curated version over two long recordings', () => {
  let host: HTMLDivElement;
  let root: Root;

  const panels = () => Array.from(host.querySelectorAll<HTMLElement>('[data-camera]'));
  const active = (panel: HTMLElement) =>
    panel.querySelector<HTMLVideoElement>('video[data-lerobot-role="active"]');
  const playButton = () => host.querySelector<HTMLButtonElement>('[aria-label="Play/pause"]');
  const isPlaying = () => Boolean(playButton()?.querySelector('.lucide-pause'));
  const slider = () =>
    host.querySelector<HTMLElement>('[role="slider"][aria-label="Playback progress"]');
  const frame = () => Number(slider()?.getAttribute('aria-valuenow') ?? '-1');

  /** Every camera shows (a decoded picture of) episode `index` near its frame `at`. */
  const cameraState = () =>
    panels().map((panel) => {
      const video = active(panel);
      return {
        camera: panel.dataset.camera?.split('.').pop(),
        status: panel.dataset.cameraStatus,
        cover: Boolean(panel.querySelector('canvas[data-lerobot-cover]')),
        time: video ? Number(video.currentTime.toFixed(2)) : null,
        readyState: video?.readyState ?? null,
        paused: video?.paused ?? null,
        src: (video?.getAttribute('src') ?? '').replace(/^.*\/e2e-datasets\/large\//, ''),
        standby: (() => {
          const standby = panel.querySelector<HTMLVideoElement>(
            'video[data-lerobot-role="standby"]',
          );
          if (!standby) return '';
          const buffered = standby.buffered.length
            ? `${standby.buffered.start(0).toFixed(1)}-${standby.buffered.end(standby.buffered.length - 1).toFixed(1)}`
            : '';
          return `${(standby.getAttribute('src') ?? '').slice(-3)}@${standby.currentTime.toFixed(2)}/rs${standby.readyState}/n${standby.networkState}[${buffered}]`;
        })(),
      };
    });
  const allOn = (index: number) => {
    const span = SPANS[index];
    const state = cameraState();
    return (
      state.length > 0 &&
      state.every(
        (camera) =>
          !camera.cover &&
          camera.readyState !== null &&
          camera.readyState >= 2 &&
          camera.time !== null &&
          camera.time >= span.fromS - 0.05 &&
          camera.time <= span.toS + 0.05 &&
          camera.src.includes(`r=${span.recordingId}`),
      )
    );
  };

  async function open(manifestQuery = '') {
    const load = async () =>
      (await (
        await fetch(`/e2e-datasets/large-manifest${manifestQuery}`)
      ).json()) as RemoteFileEntry[];
    const files = await load();
    const info = (await (
      await fetch(files.find((file) => file.logicalPath === 'meta/info.json')!.presignedUrl)
    ).json()) as { features: Record<string, unknown> };
    const recordings = (entries: RemoteFileEntry[]): EpisodeSetRecording[] =>
      (['a', 'b'] as const).map((id) => ({
        id,
        previewVideoPath: PREVIEW,
        files: entries
          .filter(
            (file) =>
              file.logicalPath.startsWith('data/') ||
              file.logicalPath.startsWith('videos/') ||
              file.logicalPath.startsWith('meta/embodiflow/preview/'),
          )
          .map((file) => ({
            ...file,
            presignedUrl: `${file.presignedUrl}${file.presignedUrl.includes('?') ? '&' : '?'}r=${id}`,
          })),
      }));
    let refreshes = 0;
    const source = createEpisodeSetDataSource(
      {
        fps: FPS,
        features: info.features,
        recordings: recordings(files),
        episodes: SPANS.map((span) => ({
          recordingId: span.recordingId,
          task: 'walk',
          fromRow: Math.round(span.fromS * FPS),
          toRow: Math.round(span.toS * FPS),
          fromS: span.fromS,
          toS: span.toS,
        })),
      },
      {
        refresh: async () => {
          refreshes += 1;
          return recordings(await load());
        },
      },
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
    expect(await waitFor(() => allOn(0), 90_000), JSON.stringify(cameraState())).toBe(true);
    return { refreshes: () => refreshes };
  }

  async function selectEpisode(index: number) {
    const row = host.querySelector<HTMLElement>(`[aria-label="Select Episode ${index}"]`);
    expect(row, `episode row ${index}`).not.toBeNull();
    await act(async () => row!.click());
  }

  async function setPlaying(playing: boolean) {
    await waitFor(() => Boolean(playButton() && !playButton()!.disabled), 30_000);
    if (isPlaying() !== playing) await act(async () => playButton()!.click());
    await waitFor(() => isPlaying() === playing, 10_000);
  }

  /** Samples of the clock and the cameras until `done` or `maxMs`. */
  async function trace(done: () => boolean, maxMs: number) {
    const samples: Array<{ ms: number; frame: number; playing: boolean; cameras: unknown }> = [];
    const startedAt = performance.now();
    while (performance.now() - startedAt < maxMs) {
      samples.push({
        ms: Math.round(performance.now() - startedAt),
        frame: frame(),
        playing: isPlaying(),
        cameras: cameraState(),
      });
      if (done()) break;
      await sleep(100);
    }
    return samples;
  }

  beforeEach(async () => {
    // a 20 Mbps link with 20 ms latency, as a browser sees it (the dev server's own throttle,
    // LEROBOT_E2E_THROTTLE_MBPS, is the alternative)
    const session = cdp();
    await session.send('Network.enable');
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 20,
      downloadThroughput: (20 * 1_000_000) / 8,
      uploadThroughput: (20 * 1_000_000) / 8,
    });
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

  it('switches while playing into an episode at an offset of another recording', async ({
    skip,
  }) => {
    if (!(await largeAvailable())) return skip();
    await open();
    for (const [from, to] of [
      [0, 1],
      [1, 3],
      [3, 2],
    ] as const) {
      await selectEpisode(from);
      await setPlaying(true);
      await sleep(4_000);
      const before = frame();
      await selectEpisode(to);
      const startedAt = performance.now();
      // the clock does not run while the cameras show no picture of the new episode
      let ranAhead = 0;
      const samples = await trace(() => {
        if (!allOn(to)) ranAhead = Math.max(ranAhead, frame());
        return allOn(to) && isPlaying();
      }, 30_000);
      const tookMs = Math.round(performance.now() - startedAt);
      console.log(
        samples
          .filter((_, i) => i % 3 === 0)
          .slice(0, 12)
          .map(
            (sample) =>
              `${sample.ms} f${sample.frame} ${sample.playing ? 'P' : '-'} ` +
              (sample.cameras as ReturnType<typeof cameraState>)
                .map(
                  (c) =>
                    `${c.camera?.slice(0, 6)}:${c.status?.slice(0, 3)}:${c.cover ? 'C' : ''}${c.time}:rs${c.readyState}${c.paused ? 'p' : ''}:${c.src.includes('preview') ? 'pv' : 'or'}${c.src.slice(-3)} sb:${c.standby}`,
                )
                .join(' '),
          )
          .join('\n'),
      );
      console.log(
        `[large-episode-set] playing ${from}→${to}: ${tookMs} ms, clock while waiting ≤ ${ranAhead}`,
      );
      expect(allOn(to), JSON.stringify({ before, samples: samples.slice(-5) })).toBe(true);
      expect(ranAhead, JSON.stringify(samples.filter((_, i) => i % 5 === 0))).toBeLessThan(
        FPS * 1.5,
      );
      // and keeps playing in sync
      await sleep(3_000);
      expect(allOn(to) && isPlaying(), JSON.stringify(cameraState())).toBe(true);
    }
  });

  it('a switch made while paused stays paused on the first frame of the new episode', async ({
    skip,
  }) => {
    if (!(await largeAvailable())) return skip();
    await open();
    await setPlaying(false);
    for (const to of [1, 3, 2]) {
      await selectEpisode(to);
      expect(await waitFor(() => allOn(to), 30_000), JSON.stringify(cameraState())).toBe(true);
      // the episode's data loaded (the timeline is back), then a while longer
      expect(await waitFor(() => frame() === 0, 30_000), `episode ${to} loaded`).toBe(true);
      await sleep(2_000);
      expect(isPlaying(), `episode ${to} must stay paused`).toBe(false);
      expect(frame()).toBe(0);
      expect(allOn(to), JSON.stringify(cameraState())).toBe(true);
      for (const camera of cameraState()) {
        expect(Math.abs((camera.time ?? 0) - SPANS[to].fromS)).toBeLessThan(1 / FPS + 0.02);
      }
    }
  });

  it('plays on into the next episode at an episode end', async ({ skip }) => {
    if (!(await largeAvailable())) return skip();
    await open();
    await setPlaying(false);
    // 2 s before the end of episode 0, then play into episode 1 (another recording, at 40 s)
    const length = (SPANS[0].toS - SPANS[0].fromS) * FPS;
    await act(async () => {
      slider()!.focus();
    });
    for (let index = 0; index < 20; index++) {
      await act(async () => {
        slider()!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
        );
      });
    }
    await waitFor(() => frame() === length - 1, 10_000);
    for (let index = 0; index < 60; index++) {
      await act(async () => {
        slider()!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
        );
      });
    }
    await setPlaying(true);
    const advanced = await waitFor(() => allOn(1) && isPlaying(), 40_000);
    expect(advanced, JSON.stringify(cameraState())).toBe(true);
    // the chart follows: its time axis is the new episode's (episode seconds, from 0)
    expect(
      await waitFor(() => {
        const range = host.querySelector<HTMLElement>('[data-x-range]')?.dataset.xRange;
        if (!range) return false;
        const [min, max] = range.split(':').map(Number);
        return min >= -0.5 && min < 1 && max > 10 && max < 16;
      }, 10_000),
      host.querySelector<HTMLElement>('[data-x-range]')?.dataset.xRange,
    ).toBe(true);
    // and the playback bar counts episode time, not the recording's
    expect(host.textContent ?? '').toMatch(/\/ 0:14\.9\d/);
  });

  it("plans Original from the files' bit rates and a link estimate that holds up", async ({
    skip,
  }) => {
    if (!(await largeAvailable())) return skip();
    await open();
    await setPlaying(false);
    // an episode at an offset of the other recording, then Original while playing
    await selectEpisode(1);
    expect(await waitFor(() => allOn(1) && frame() === 0, 60_000)).toBe(true);
    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Video quality"]')!;
    await act(async () => toggle.click());
    await setPlaying(true);
    const notice = () => host.querySelector('[data-quality-notice]')?.textContent ?? '';
    expect(await waitFor(() => /Mbps/.test(notice()), 30_000), notice()).toBe(true);
    const [, needed, link] = /about (\d+) Mbps.*about (\d+) Mbps/.exec(notice()) ?? [];
    console.log(`[large-episode-set] Original needs ${needed} Mbps, link ${link} Mbps`);
    // four originals of about 13 Mbps: tens of Mbps, not hundreds (a file's size over its own
    // duration, never over an episode's end time)
    expect(Number(needed)).toBeGreaterThan(20);
    expect(Number(needed)).toBeLessThan(120);
    // a 20 Mbps link reads as about that, not a contended fraction of it
    expect(Number(link)).toBeGreaterThanOrEqual(12);
  });
});
