import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { createEpisodeSetDataSource } from '../../src/react/public-api';
import type {
  AuxiliarySeries,
  AuxiliarySeriesWarning,
} from '../../src/platform/services/auxiliarySeries';
import { FetchDataSource } from './fixtures';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DATASET = '/tests/fixtures/datasets/lerobotv3';
const VIDEO = 'videos/observation.images.cam/chunk-000/file-000.mp4';

function waitFor(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
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

/**
 * A source that behaves like a signed-URL store: the first video URL it hands
 * out is dead until the viewer reports it failed; `rotate()` swaps URLs the
 * way a refresh does; `codec` rewrites the declared camera codec.
 */
class SignedFixtureSource extends FetchDataSource {
  invalidations = 0;
  generation = 0;
  /** While true, video URLs handed out are dead (an expired signature). */
  expired: boolean;
  private listeners = new Set<(paths: readonly string[]) => void>();

  constructor(
    private readonly options: {
      deadFirstVideoUrl?: boolean;
      codec?: string;
      /** Where the camera's video metadata lives (LeRobot v2.1 / older Hub datasets: `video_info`). */
      codecUnder?: 'info' | 'video_info';
    } = {},
  ) {
    super(DATASET);
    this.expired = Boolean(options.deadFirstVideoUrl);
  }

  override async readText(path: string): Promise<string> {
    const text = await super.readText(path);
    if (path !== 'meta/info.json' || !this.options.codec) return text;
    const info = JSON.parse(text);
    const camera = info.features['observation.images.cam'];
    const metadata = { ...camera.info, 'video.codec': this.options.codec };
    if (this.options.codecUnder === 'video_info') {
      delete camera.info;
      camera.video_info = metadata;
    } else {
      camera.info = metadata;
    }
    return JSON.stringify(info);
  }

  override async getObjectUrl(path: string): Promise<string> {
    if (path === VIDEO) {
      if (this.expired) return `${location.origin}/expired/${VIDEO}?gen=${this.generation}`;
      return `${location.origin}${DATASET}/${VIDEO}?gen=${this.generation}`;
    }
    return super.getObjectUrl(path);
  }

  invalidateObjectUrl(path: string): void {
    if (path !== VIDEO) return;
    this.invalidations++;
    this.expired = false;
    this.generation++;
  }

  subscribeUrlChanges(listener: (paths: readonly string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  rotate(): void {
    this.generation++;
    for (const listener of this.listeners) listener([VIDEO]);
  }
}

describe('browser: data foundations', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await page.viewport(1_280, 900);
    host = document.createElement('div');
    host.style.cssText = 'width:1200px;height:860px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  async function render(element: React.ReactElement) {
    await act(async () => root.render(element));
  }

  const video = () => host.querySelector<HTMLVideoElement>('video');

  it('renders a labelled region, never a main landmark', async () => {
    await render(<LeRobotViewer dataSource={new SignedFixtureSource()} language="en" />);
    await waitFor(() => host.querySelector('[data-chart-group]') !== null);
    expect(host.querySelector('main, [role="main"]')).toBeNull();
    const region = host.querySelector('.lerobot-root')!;
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-label')).toBe('Dataset viewer');
  }, 60_000);

  it('draws one chart per feature, titled by key, with declared dimension names', async () => {
    await render(<LeRobotViewer dataSource={new SignedFixtureSource()} language="en" />);
    // Groups show placeholders while their columns load; wait until all are drawn.
    await waitFor(
      () =>
        host.querySelectorAll('[data-chart-group]').length >= 2 &&
        host.querySelector('[data-testid="chart-groups"]')?.getAttribute('aria-busy') === 'false',
    );
    const titles = Array.from(host.querySelectorAll('[data-chart-group] h3')).map(
      (h) => h.textContent,
    );
    expect(titles).toEqual(expect.arrayContaining(['observation.state', 'action']));
    const chips = host.querySelectorAll('[data-chart-group="action"] button[aria-pressed]');
    expect(Array.from(chips).map((chip) => chip.textContent?.trim())).toEqual(['joint1']);
    expect(chips[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[data-chart-group="action"] [data-chart-playhead]')).not.toBeNull();
  }, 60_000);

  it('retries a dead video URL once and keeps the frame across a URL refresh', async () => {
    const source = new SignedFixtureSource({ deadFirstVideoUrl: true });
    // Nothing plays on its own, so the episode stays put.
    await render(<LeRobotViewer dataSource={source} language="en" showPlaybackBar={false} />);
    await waitFor(() => (video()?.readyState ?? 0) >= 2);
    expect(source.invalidations).toBe(1);
    await waitFor(() => host.querySelector('[data-chart-group="action"] .u-over') !== null);

    // Seek to a later frame by clicking the chart.
    const over = host.querySelector<HTMLElement>('[data-chart-group="action"] .u-over')!;
    const box = over.getBoundingClientRect();
    const at = { clientX: box.left + box.width * 0.8, clientY: box.top + box.height / 2 };
    await act(async () => {
      // A real click: uPlot treats a click without a matching mousedown as a drag.
      over.dispatchEvent(new MouseEvent('mouseenter', { ...at, bubbles: true }));
      over.dispatchEvent(new MouseEvent('mousemove', { ...at, bubbles: true }));
      over.dispatchEvent(new MouseEvent('mousedown', { ...at, bubbles: true, button: 0 }));
      over.dispatchEvent(new MouseEvent('mouseup', { ...at, bubbles: true, button: 0 }));
      over.dispatchEvent(new MouseEvent('click', { ...at, bubbles: true, button: 0 }));
    });
    await waitFor(() => (video()?.currentTime ?? 0) > 0.1 && !video()!.seeking);
    // The camera may still be converging on the clicked frame: take the time
    // once it has held still for 300 ms.
    let settled = { time: -1, since: performance.now() };
    await waitFor(() => {
      const time = video()!.currentTime;
      if (video()!.seeking || time !== settled.time) {
        settled = { time, since: performance.now() };
        return false;
      }
      return performance.now() - settled.since >= 300;
    });
    const before = video()!.currentTime;

    const oldSrc = video()!.src;
    await act(async () => source.rotate());
    await waitFor(() => video()!.src !== oldSrc && video()!.readyState >= 2 && !video()!.seeking);
    expect(video()!.src).toContain(`gen=${source.generation}`);
    expect(Math.abs(video()!.currentTime - before)).toBeLessThan(0.05);
    expect(video()!.paused).toBe(true);
    expect(source.invalidations).toBe(1);
  }, 60_000);

  it('recovers from a second expiry later in the session (the retry is per URL generation)', async () => {
    const source = new SignedFixtureSource({ deadFirstVideoUrl: true });
    await render(<LeRobotViewer dataSource={source} language="en" showPlaybackBar={false} />);
    await waitFor(() => (video()?.readyState ?? 0) >= 2);
    expect(source.invalidations).toBe(1);

    // An hour later the signature expires again and a refresh hands out a URL
    // that fails on load: the viewer must retry once more, not give up.
    source.expired = true;
    await act(async () => source.rotate());
    await waitFor(() => source.invalidations === 2);
    await waitFor(() => !source.expired && (video()?.readyState ?? 0) >= 2);
    expect(video()!.src).not.toContain('/expired/');
    expect(host.textContent).not.toContain('Error loading data');
  }, 60_000);

  it('names the camera and codec when the browser cannot decode it', async () => {
    const source = new SignedFixtureSource({ codec: 'hevc' });
    await render(<LeRobotViewer dataSource={source} language="en" />);
    await waitFor(() => host.querySelector('[data-testid="video-codec-unsupported"]') !== null);
    const notice = host.querySelector('[data-testid="video-codec-unsupported"]')!.textContent!;
    expect(notice).toMatch(/hevc/i);
    expect(notice).toContain('cam');
    expect(video()?.getAttribute('src') ?? '').toBe('');
  }, 60_000);

  /** A browser whose every decode check refuses AV1 (Safari on a Mac without AV1 decode). */
  function refuseAv1() {
    const refuses = (type: string) => type.includes('av01');
    const canPlayType = HTMLMediaElement.prototype.canPlayType;
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation(function (
      this: HTMLMediaElement,
      type: string,
    ) {
      return refuses(type) ? '' : canPlayType.call(this, type);
    });
    const isTypeSupported = MediaSource.isTypeSupported.bind(MediaSource);
    vi.spyOn(MediaSource, 'isTypeSupported').mockImplementation(
      (type) => !refuses(type) && isTypeSupported(type),
    );
    if (typeof VideoDecoder !== 'undefined') {
      const isConfigSupported = VideoDecoder.isConfigSupported.bind(VideoDecoder);
      vi.spyOn(VideoDecoder, 'isConfigSupported').mockImplementation(async (config) =>
        refuses(config.codec) ? { supported: false, config } : isConfigSupported(config),
      );
    }
  }

  it.each(['video_info', 'info'] as const)(
    'names an AV1 camera declared under %s when the browser refuses AV1',
    async (codecUnder) => {
      refuseAv1();
      const source = new SignedFixtureSource({ codec: 'av1', codecUnder });
      await render(<LeRobotViewer dataSource={source} language="en" />);
      await waitFor(() => host.querySelector('[data-testid="video-codec-unsupported"]') !== null);
      const notice = host.querySelector('[data-testid="video-codec-unsupported"]')!.textContent!;
      expect(notice).toContain('AV1');
      expect(notice).toContain('cam');
      expect(video()?.getAttribute('src') ?? '').toBe('');
    },
    60_000,
  );

  it('plays an H.264 camera declared under video_info', async () => {
    refuseAv1();
    const source = new SignedFixtureSource({ codec: 'h264', codecUnder: 'video_info' });
    await render(<LeRobotViewer dataSource={source} language="en" showPlaybackBar={false} />);
    await waitFor(() => (video()?.readyState ?? 0) >= 2);
    expect(host.querySelector('[data-testid="video-codec-unsupported"]')).toBeNull();
  }, 60_000);

  it('plots an auxiliary series, warns on a missing column and keeps data across a URL refresh', async () => {
    const warnings: AuxiliarySeriesWarning[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const series = (sig: number): AuxiliarySeries[] => [
      {
        id: 'extra',
        label: 'Extra sensor',
        files: [
          {
            logicalPath: 'extra.parquet',
            presignedUrl: `${location.origin}${DATASET}/data/chunk-000/file-000.parquet?sig=${sig}`,
          },
        ],
        timeColumn: 'timestamp',
        timeUnit: 's',
        columns: ['action', 'missing_column'],
      },
    ];
    const source = new SignedFixtureSource();
    const view = (sig: number) => (
      <LeRobotViewer
        dataSource={source}
        language="en"
        showPlaybackBar={false}
        auxiliarySeries={series(sig)}
        onAuxiliarySeriesWarning={(warning) => warnings.push(warning)}
      />
    );
    await render(view(1));
    await waitFor(() => host.querySelector('[data-chart-group="aux:extra"]') !== null);
    const group = host.querySelector('[data-chart-group="aux:extra"]')!;
    expect(group.querySelector('h3')!.textContent).toBe('Extra sensor');
    expect(group.textContent).toContain('missing_column');
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'COLUMN_MISSING',
        seriesId: 'extra',
        column: 'missing_column',
      }),
    ]);
    await waitFor(() => host.querySelector('[data-testid="raw-auxiliary-samples"]') !== null);
    expect(host.querySelector('[data-testid="raw-auxiliary-samples"]')!.textContent).toContain(
      'Extra sensor',
    );

    const reads = () =>
      fetchSpy.mock.calls.filter(([input]) => String(input).includes('file-000.parquet?sig='))
        .length;
    expect(reads()).toBe(1);
    await render(view(2));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(reads()).toBe(1);
    expect(host.querySelector('[data-chart-group="aux:extra"]')).not.toBeNull();
  }, 60_000);

  it('reads auxiliary series only after the episode charts, never competing with them', async () => {
    const events: string[] = [];
    class SlowDataSource extends SignedFixtureSource {
      override async readBytes(path: string) {
        if (path.startsWith('data/')) await new Promise((resolve) => setTimeout(resolve, 800));
        const bytes = await super.readBytes(path);
        if (path.startsWith('data/')) events.push('episode-data');
        return bytes;
      }
    }
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input).includes('aux=1')) events.push('aux');
      return realFetch(input, init);
    });
    await render(
      <LeRobotViewer
        dataSource={new SlowDataSource()}
        language="en"
        showPlaybackBar={false}
        auxiliarySeries={[
          {
            id: 'extra',
            label: 'Extra sensor',
            files: [
              {
                logicalPath: 'extra.parquet',
                presignedUrl: `${location.origin}${DATASET}/data/chunk-000/file-000.parquet?aux=1`,
              },
            ],
            timeColumn: 'timestamp',
            timeUnit: 's',
            columns: ['action'],
          },
        ]}
      />,
    );
    await waitFor(() => host.querySelector('[data-chart-group="aux:extra"] canvas') !== null);
    expect(events.indexOf('aux')).toBeGreaterThan(events.indexOf('episode-data'));
    expect(events.indexOf('episode-data')).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('shows an auxiliary series that loads after the dataset charts with its dimensions on', async () => {
    const realFetch = globalThis.fetch.bind(globalThis);
    let releaseAux!: () => void;
    const auxGate = new Promise<void>((resolve) => (releaseAux = resolve));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('?aux=1')) await auxGate;
      return realFetch(input, init);
    });
    const series: AuxiliarySeries[] = [
      {
        id: 'late',
        label: 'Late sensor',
        files: [
          {
            logicalPath: 'late.parquet',
            presignedUrl: `${location.origin}${DATASET}/data/chunk-000/file-000.parquet?aux=1`,
          },
        ],
        timeColumn: 'timestamp',
        timeUnit: 's',
        columns: ['action'],
      },
    ];
    await render(
      <LeRobotViewer
        dataSource={new SignedFixtureSource()}
        language="en"
        showPlaybackBar={false}
        auxiliarySeries={series}
      />,
    );
    const chip = (group: string) =>
      host.querySelector<HTMLButtonElement>(`[data-chart-group="${group}"] button[aria-pressed]`);
    await waitFor(() => chip('action')?.getAttribute('aria-pressed') === 'true');
    releaseAux();
    await waitFor(() => chip('aux:late') !== null);
    // Defaults apply in the effect after the group first renders.
    await waitFor(() => chip('aux:late')!.getAttribute('aria-pressed') === 'true', 3_000);
    expect(chip('action')!.getAttribute('aria-pressed')).toBe('true');
  }, 60_000);

  it('reports an auxiliary-series warning once, not on every render', async () => {
    const info = await (await fetch(`${DATASET}/meta/info.json`)).json();
    const file = (path: string) => ({
      logicalPath: path,
      presignedUrl: `${location.origin}${DATASET}/${path}`,
    });
    const source = createEpisodeSetDataSource({
      fps: info.fps,
      features: info.features,
      recordings: [{ id: 'a', files: [file('data/chunk-000/file-000.parquet'), file(VIDEO)] }],
      episodes: [{ recordingId: 'a', task: 'pick', fromRow: 0, toRow: 3, fromS: 0, toS: 0.3 }],
    });
    const warnings: AuxiliarySeriesWarning[] = [];
    // A new series array on every render, as inline props are.
    const view = () => (
      <LeRobotViewer
        dataSource={source}
        language="en"
        showPlaybackBar={false}
        auxiliarySeries={[
          {
            id: 'extra',
            label: 'Extra',
            files: [file('data/chunk-000/file-000.parquet')],
            timeColumn: 'timestamp',
            timeUnit: 's',
          },
        ]}
        onAuxiliarySeriesWarning={(warning) => warnings.push(warning)}
      />
    );
    await render(view());
    await waitFor(() => host.querySelector('[data-chart-group="action"]') !== null);
    for (let i = 0; i < 4; i++) {
      await render(view());
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(warnings.map((warning) => warning.code)).toEqual(['EPISODE_SET_UNSUPPORTED']);
  }, 60_000);

  it('pauses exactly: the slider frame equals every camera frame, pause after pause', async () => {
    const fps = 30;
    await render(
      <LeRobotViewer
        // Committed, not generated: made once with
        // scripts/bench/generate-frame-coded-dataset.mjs --minutes 0.2 --cameras 2.
        dataSource={new FetchDataSource('/tests/fixtures/static/frame-coded-v3')}
        language="en"
      />,
    );
    const videos = () => Array.from(host.querySelectorAll('video'));
    const slider = () => host.querySelector<HTMLElement>('[role="slider"]')!;
    const button = () => host.querySelector<HTMLButtonElement>('button[aria-label="Play/pause"]')!;
    // The play state as the UI shows it.
    const uiPlaying = () => button()?.querySelector('.lucide-pause') != null;
    const playing = () => uiPlaying() && videos().some((v) => !v.paused);
    await waitFor(() => videos().length === 2 && videos().every((v) => v.readyState >= 2));
    await waitFor(() => button() !== null && !button().disabled);
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!uiPlaying()) await act(async () => button().click());

    for (let cycle = 0; cycle < 5; cycle++) {
      await waitFor(() => playing());
      await new Promise((resolve) => setTimeout(resolve, 250 + 97 * cycle));
      await act(async () => button().click());
      await waitFor(
        () =>
          videos().every((v) => v.paused && !v.seeking && v.readyState >= 2) &&
          slider().getAttribute('aria-valuenow') != null,
      );
      // Let any settle-seek land.
      await new Promise((resolve) => setTimeout(resolve, 150));
      await waitFor(() => videos().every((v) => !v.seeking));
      const sliderFrame = Number(slider().getAttribute('aria-valuenow'));
      const cameraFrames = videos().map((v) => Math.floor(v.currentTime * fps + 1e-3));
      expect(cameraFrames, `cycle ${cycle}`).toEqual([sliderFrame, sliderFrame]);
      if (cycle < 4) await act(async () => button().click());
    }
  }, 120_000);
});
