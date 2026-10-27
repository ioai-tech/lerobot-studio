import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer, createRemoteManifestDataSource, type RemoteFileEntry } from '@/public-api';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Opt-in: LEROBOT_LARGE_DATASET=<dataset root> (optionally LEROBOT_E2E_THROTTLE_MBPS) serves a
 * large dataset as a remote manifest with Range support. The test plays it natively for 60 s and
 * reports time to first frame, parquet bytes read, stalls per minute, camera drift, and the black
 * frames and duration of a Preview → Original switch during playback. It reads only the DOM, so it
 * measures older builds the same way.
 */

function waitFor(predicate: () => boolean, timeoutMs = 60_000): Promise<void> {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) resolve();
      else if (performance.now() - startedAt > timeoutMs) reject(new Error('waitFor timeout'));
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function largeAvailable(): Promise<boolean> {
  try {
    const response = await fetch('/e2e-datasets/status');
    const status = (await response.json()) as {
      datasets?: Record<string, { available?: boolean }>;
    };
    return Boolean(status.datasets?.large?.available);
  } catch {
    return false;
  }
}

describe('browser: large dataset streaming playback', () => {
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

  it('opens with range reads and plays every camera in sync', async ({ skip }) => {
    if (!(await largeAvailable())) {
      skip();
      return;
    }
    const files = (await (await fetch('/e2e-datasets/large-manifest')).json()) as RemoteFileEntry[];
    const previewEntry = files.find((file) => file.logicalPath === 'meta/embodiflow/preview.json');
    const previewVideoPath = previewEntry
      ? ((await (await fetch(previewEntry.presignedUrl)).json()) as { video_path: string })
          .video_path
      : undefined;
    const parquetBytesInFiles = files
      .filter((file) => file.logicalPath.startsWith('data/'))
      .reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);

    performance.clearResourceTimings();
    const openedAt = performance.now();
    const source = createRemoteManifestDataSource(files);
    await act(async () => {
      root.render(
        <LeRobotViewer
          dataSource={source}
          language="en"
          showSidebar
          showPlaybackBar
          previewVideoPath={previewVideoPath}
        />,
      );
    });

    // the element on screen per camera (newer builds stack a standby element below it)
    const videos = () =>
      Array.from(host.querySelectorAll('video')).filter(
        (video) => video.dataset.lerobotRole !== 'standby',
      );
    await waitFor(() => videos().length > 0 && videos().every((video) => video.readyState >= 2));
    const firstFrameMs = performance.now() - openedAt;
    await waitFor(() => host.querySelector('[aria-label="Play/pause"]') !== null);

    const waitingEvents: number[] = [];
    videos().forEach((video) =>
      video.addEventListener('waiting', () => waitingEvents.push(performance.now())),
    );

    const playButton = host.querySelector<HTMLButtonElement>('[aria-label="Play/pause"]')!;
    const isPlaying = () => playButton.querySelector('.lucide-pause') !== null;
    // the viewer may autoplay the first episode; make sure it plays, from wherever it is
    await waitFor(() => !playButton.disabled);
    if (!isPlaying()) await act(async () => playButton.click());
    await waitFor(isPlaying);
    const startTimes = videos().map((video) => video.currentTime);
    const playedAt = performance.now();

    const drifts: number[] = [];
    const PLAY_MS = 60_000;
    while (performance.now() - playedAt < PLAY_MS) {
      await sleep(500);
      const times = videos().map((video, index) => video.currentTime - startTimes[index]);
      drifts.push(Math.max(...times) - Math.min(...times));
    }
    const advanced = videos()[0].currentTime - startTimes[0];
    const stillPlaying = isPlaying();

    // Preview → Original while playing: samples without a picture on screen, and time to switch
    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Video quality"]');
    let qualitySwitch: Record<string, unknown> = { available: false };
    if (toggle && previewVideoPath) {
      const isOriginal = () =>
        videos().every(
          (video) =>
            !(video.getAttribute('src') ?? '').includes('/preview/') && video.readyState >= 2,
        );
      let samples = 0;
      let blackSamples = 0;
      let sampling = true;
      const sample = () => {
        if (!sampling) return;
        samples += 1;
        if (videos().some((video) => video.readyState < 2 || !video.getAttribute('src'))) {
          blackSamples += 1;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      const switchedAt = performance.now();
      await act(async () => toggle.click());
      await waitFor(isOriginal, 60_000).catch(() => undefined);
      const switchMs = Math.round(performance.now() - switchedAt);
      await sleep(500);
      sampling = false;
      qualitySwitch = { switchMs, samples, blackSamples, done: isOriginal() };
    }
    if (isPlaying()) await act(async () => playButton.click());

    const parquetBytesRead = performance
      .getEntriesByType('resource')
      .filter((entry) => entry.name.includes('/data/') && entry.name.endsWith('.parquet'))
      .reduce((sum, entry) => sum + (entry as PerformanceResourceTiming).encodedBodySize, 0);
    const stallsAfterStart = waitingEvents.filter(
      (time) => time - playedAt > 3_000 && time - playedAt < PLAY_MS,
    ).length;
    const report = {
      cameras: videos().length,
      sources: videos().map((video) => video.currentSrc.replace(/^.*\/e2e-datasets\/large\//, '')),
      firstFrameMs: Math.round(firstFrameMs),
      parquetBytesRead,
      parquetBytesInFiles,
      playedWallSeconds: PLAY_MS / 1000,
      mediaSecondsAdvanced: Number(advanced.toFixed(2)),
      stallsAfterStart,
      stallsPerMinute: Number(((stallsAfterStart * 60_000) / (PLAY_MS - 3_000)).toFixed(2)),
      stillPlaying,
      qualitySwitch,
      maxDriftFrames: Number((Math.max(...drifts.slice(4)) * 30).toFixed(2)),
      finalDriftFrames: Number((drifts[drifts.length - 1] * 30).toFixed(2)),
      videoStates: videos().map((video) => ({
        readyState: video.readyState,
        paused: video.paused,
        time: Number(video.currentTime.toFixed(2)),
        bufferedEnd:
          video.buffered.length > 0
            ? Number(video.buffered.end(video.buffered.length - 1).toFixed(2))
            : 0,
      })),
    };
    console.log(`[large-playback] ${JSON.stringify(report)}`);

    expect(parquetBytesRead).toBeLessThan(parquetBytesInFiles / 4);
    expect(advanced).toBeGreaterThan((PLAY_MS / 1000) * 0.8);
    expect(report.finalDriftFrames).toBeLessThan(3);
  });
});
