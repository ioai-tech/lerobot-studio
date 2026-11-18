import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer } from '@/components/LeRobotViewer';
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

  constructor(private readonly options: { deadFirstVideoUrl?: boolean; codec?: string } = {}) {
    super(DATASET);
    this.expired = Boolean(options.deadFirstVideoUrl);
  }

  override async readText(path: string): Promise<string> {
    const text = await super.readText(path);
    if (path !== 'meta/info.json' || !this.options.codec) return text;
    const info = JSON.parse(text);
    info.features['observation.images.cam'].info['video.codec'] = this.options.codec;
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
    await waitFor(() => host.querySelectorAll('[data-chart-group]').length >= 2);
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
    // Without the playback bar nothing autoplays, so the episode stays put.
    await render(<LeRobotViewer dataSource={source} language="en" showPlaybackBar={false} />);
    await waitFor(() => (video()?.readyState ?? 0) >= 2);
    expect(source.invalidations).toBe(1);

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

  it('pauses exactly: the slider frame equals every camera frame, pause after pause', async () => {
    const fps = 30;
    await render(
      <LeRobotViewer
        dataSource={new FetchDataSource('/tests/fixtures/datasets/frame-coded-v3')}
        language="en"
      />,
    );
    const videos = () => Array.from(host.querySelectorAll('video'));
    const slider = () => host.querySelector<HTMLElement>('[role="slider"]')!;
    const button = () => host.querySelector<HTMLButtonElement>('button[aria-label="Play/pause"]')!;
    const playing = () => videos().some((v) => !v.paused);
    await waitFor(() => videos().length === 2 && videos().every((v) => v.readyState >= 2));
    await waitFor(() => button() !== null && !button().disabled);
    if (!playing()) await act(async () => button().click());

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
