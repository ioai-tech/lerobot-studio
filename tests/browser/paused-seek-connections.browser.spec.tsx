import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, inject, it } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { FetchDataSource } from './fixtures';
import type { RangeServerStats } from './support/rangeServer';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

// One episode of 360 frames at 30 fps (12 s); its cameras are replaced below.
const FRAME_CODED = '/tests/fixtures/static/frame-coded-v3';
const provided = inject('rangeServer');
// Skipped only where ffmpeg is missing outside CI (see the global setup).
const server = provided!;

/**
 * The frame-coded recording with `cameras` cameras, each a 12 s, ~32 MB H.264
 * file on the slow range server: one storage host for every camera, as
 * behind signed URLs.
 */
class ManyCameras extends FetchDataSource {
  private readonly open = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  constructor(private readonly cameras: number) {
    super(FRAME_CODED);
  }
  override async readText(path: string) {
    const text = await super.readText(path);
    if (path !== 'meta/info.json') return text;
    const info = JSON.parse(text) as { features: Record<string, Record<string, unknown>> };
    const template = info.features['observation.images.cam0']!;
    delete info.features['observation.images.cam0'];
    delete info.features['observation.images.cam1'];
    for (let index = 0; index < this.cameras; index++) {
      info.features[`observation.images.c${index}`] = { ...template, shape: [240, 320, 3] };
    }
    return JSON.stringify(info);
  }
  override async getObjectUrl(path: string, mime?: string) {
    const camera = /^videos\/([^/]+)\//.exec(path)?.[1];
    // A URL of its own per open: nothing comes from the browser's media cache.
    if (camera) return `${server.media}/v/${camera}.mp4?open=${this.open}`;
    return super.getObjectUrl(path, mime);
  }
}

let host: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
});

const stats = async (): Promise<RangeServerStats> =>
  (await fetch(`${server.control}/stats`)).json() as Promise<RangeServerStats>;
const videos = () => Array.from(host!.querySelectorAll('video'));
const slider = () =>
  host!.querySelector<HTMLElement>('[role="slider"][aria-label="Playback progress"]')!;
const playPause = () => host!.querySelector<HTMLButtonElement>('button[aria-label="Play/pause"]')!;
const playing = () => playPause().querySelector('.lucide-pause') !== null;
/** The default layout shows at most six cameras. */
const shown = (cameras: number) => Math.min(cameras, 6);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openPaused(cameras: number) {
  await fetch(`${server.control}/reset`);
  await page.viewport(1600, 900);
  host = document.createElement('div');
  host.style.cssText = 'width:1600px;height:900px';
  document.body.append(host);
  root = createRoot(host);
  // A deep link lands paused on its frame.
  root.render(
    <LeRobotViewer
      dataSource={new ManyCameras(cameras)}
      language="en"
      initialSelection={{ episodeIndex: 0, timeS: 0.1 }}
    />,
  );
  await expect
    .poll(
      () =>
        playPause() !== null &&
        slider() !== null &&
        videos().length === shown(cameras) &&
        videos().every((v) => v.readyState >= 2),
      {
        timeout: 60_000,
      },
    )
    .toBe(true);
  expect(playing()).toBe(false);
}

/** Click the timeline at `fraction`; ms until every camera shows the new frame. */
async function seek(fraction: number): Promise<number> {
  const box = slider().getBoundingClientRect();
  const target = fraction * server.durationS;
  const started = performance.now();
  await page.elementLocator(slider()).click({
    position: { x: Math.round(box.width * fraction), y: Math.round(box.height / 2) },
  });
  await expect
    .poll(
      () =>
        videos().every(
          (v) => !v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - target) < 0.5,
        ),
      { timeout: 60_000, interval: 25 },
    )
    .toBe(true);
  return performance.now() - started;
}

/**
 * A paused camera stops reading once the shown frame is in (a bounded read,
 * about 2.5 s of this video), leaving the storage host's six connections
 * free; one that reads ahead holds its connection for the whole file.
 */
async function expectReadersIdle() {
  // A bounded read ends about 2 s after the frame is in; reading ahead what is
  // left of the file takes 9 s or more at this server's rate.
  await expect.poll(async () => (await stats()).open, { timeout: 5_000 }).toBe(0);
}

// A seek reads about a second of video at the seek point; the server sends
// 2.5 MB/s per connection, a camera's second is about 2.7 MB.
const SEEK_BUDGET_MS = 4_000;

describe.skipIf(!provided)('cameras on one slow storage host', () => {
  for (const cameras of [4, 6]) {
    it(`${cameras} cameras opened paused stop reading once their frame is in`, async () => {
      await openPaused(cameras);
      await expectReadersIdle();
      // Each camera read about 2.5 s of video for its frame, not the file ahead (32 MB).
      const read = (await stats()).requests.reduce((sum, row) => sum + row.bytes, 0);
      expect(read / shown(cameras)).toBeLessThan(10 * 1024 * 1024);
    });
  }

  for (const cameras of [4, 6, 8]) {
    it(`${cameras} cameras opened paused: the first seek is not starved and readers stop`, async () => {
      await openPaused(cameras);
      // A person looks, then scrubs: the cameras are still reading.
      await pause(1500);
      expect(await seek(0.9)).toBeLessThan(SEEK_BUDGET_MS);
      expect(await seek(0.3)).toBeLessThan(SEEK_BUDGET_MS);
      // 8.4 s of file lies ahead of 0.3: a camera that reads ahead is still
      // reading when the check ends; one that reads the shown frame has let go.
      await expectReadersIdle();
    });
  }

  it('6 cameras played then paused: readers stop on pause, and the seek is not starved', async () => {
    await openPaused(6);
    playPause().click();
    await expect.poll(playing, { timeout: 10_000 }).toBe(true);
    await pause(2000);
    playPause().click();
    await expect.poll(playing, { timeout: 10_000 }).toBe(false);
    // Paused near 2 s with 10 s of file ahead: the readers stop without a seek.
    await expectReadersIdle();
    expect(await seek(0.3)).toBeLessThan(SEEK_BUDGET_MS);
  });
});
