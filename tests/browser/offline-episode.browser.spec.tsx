import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer, type LeRobotViewerError } from '@/components/LeRobotViewer';
import { createEpisodeSetDataSource } from '../../src/react/public-api';
import { FetchDataSource } from './fixtures';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const DATASET = '/tests/fixtures/datasets/lerobotv3';
const DATA = 'data/chunk-000/file-000.parquet';
const VIDEO = 'videos/observation.images.cam/chunk-000/file-000.mp4';

/** The browser's connectivity as the page sees it (navigator.onLine and its events). */
let browserOnline = true;
function setOnline(online: boolean) {
  browserOnline = online;
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

/**
 * An episode set whose recordings are signed by the host when first read, as
 * an embedding console does. The set's metadata is synthesized from the
 * manifest, so the dataset opens offline; the episode's files cannot be
 * signed until the connection is back (the host's request fails the way its
 * fetch wrapper reports it).
 */
async function episodeSet(options: { failOnline?: boolean } = {}) {
  const info = await (await fetch(`${DATASET}/meta/info.json`)).json();
  const file = (path: string) => ({
    logicalPath: path,
    presignedUrl: `${location.origin}${DATASET}/${path}`,
  });
  /** While true, signing fails online too (a host error), until the test clears it. */
  const calls = { resolve: 0, failOnline: options.failOnline ?? false };
  const source = createEpisodeSetDataSource(
    {
      fps: info.fps,
      features: info.features,
      recordings: [{ id: 'a' }],
      episodes: [{ recordingId: 'a', task: 'pick', fromRow: 0, toRow: 3, fromS: 0, toS: 0.3 }],
    },
    {
      resolve: async (ids) => {
        calls.resolve += 1;
        if (!browserOnline) throw new TypeError('Network request failed');
        if (calls.failOnline) throw new Error('sign recordings -> 503');
        return ids.map((id) => ({ id, files: [file(DATA), file(VIDEO)] }));
      },
    },
  );
  return { source, calls };
}

describe('an episode of a shown dataset that cannot load is named and retryable (walk m-2)', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await page.viewport(1024, 768);
    browserOnline = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => browserOnline });
    host = document.createElement('div');
    host.style.cssText = 'width:1024px;height:768px';
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    host.remove();
    delete (navigator as { onLine?: boolean }).onLine;
    browserOnline = true;
  });

  const alerts = () => Array.from(host.querySelectorAll<HTMLElement>('[role="alert"]'));
  const alertText = () =>
    alerts()
      .map((alert) => alert.textContent ?? '')
      .join(' | ');
  const retryButtons = () =>
    alerts().flatMap((alert) =>
      Array.from(alert.querySelectorAll<HTMLButtonElement>('button')).filter(
        (button) => button.textContent?.trim() === 'Retry',
      ),
    );
  const playable = () => {
    const video = host.querySelector('video');
    return video !== null && video.readyState >= 2;
  };
  const shown = () => /\d+ episodes?/.test(host.textContent ?? '');

  it('offline: "You\'re offline" with Retry, clear of the panels; back online the episode loads by itself', async () => {
    setOnline(false);
    const { source, calls } = await episodeSet();
    const errors: LeRobotViewerError[] = [];
    root.render(
      <LeRobotViewer
        dataSource={source}
        language="en"
        onFatalError={(error) => errors.push(error)}
      />,
    );
    await expect.poll(() => calls.resolve, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(alertText, { timeout: 30_000 }).toContain("You're offline");
    expect(shown()).toBe(true);
    expect(retryButtons().length).toBe(1);
    // Named, not the generic failure, and said once (not again in the sidebar).
    expect(host.textContent).not.toContain('Error loading data');
    expect(host.textContent).not.toContain('Network request failed');

    // The line sits above the panels, not over a panel's title (the camera name).
    await expect.poll(() => host.querySelector('.dv-dockview') !== null).toBe(true);
    const line = alerts()[0]!.getBoundingClientRect();
    const dock = host.querySelector('.dv-dockview')!.getBoundingClientRect();
    expect(line.bottom).toBeLessThanOrEqual(dock.top + 0.5);

    // Back online, no click: the episode and its camera load.
    setOnline(true);
    await expect.poll(playable, { timeout: 60_000 }).toBe(true);
    expect(alertText()).toBe('');
    // A shown dataset never goes to the host as a fatal error.
    expect(errors).toEqual([]);
  });

  it('a failure online names the episode and its cause; Retry loads it', async () => {
    const { source, calls } = await episodeSet({ failOnline: true });
    root.render(<LeRobotViewer dataSource={source} language="en" />);
    await expect
      .poll(alertText, { timeout: 30_000 })
      .toContain('This episode could not be loaded.');
    expect(alertText()).toContain('503');
    expect(alertText()).not.toContain("You're offline");
    // Retry is what loads it: nothing retries by itself online.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(playable()).toBe(false);
    expect(retryButtons().length).toBe(1);
    calls.failOnline = false;
    retryButtons()[0]!.click();
    await expect.poll(playable, { timeout: 60_000 }).toBe(true);
    expect(alertText()).toBe('');
  });

  it('a source swap that failed: Retry opens that source again (the shown dataset stays meanwhile)', async () => {
    let failing = true;
    let infoReads = 0;
    const next = new (class extends FetchDataSource {
      override async readText(path: string) {
        if (path === 'meta/info.json') {
          infoReads += 1;
          if (failing) throw new Error('fetch meta/info.json -> 503');
        }
        return super.readText(path);
      }
    })(DATASET);
    root.render(<LeRobotViewer dataSource={new FetchDataSource(DATASET)} language="en" />);
    await expect.poll(playable, { timeout: 60_000 }).toBe(true);
    root.render(<LeRobotViewer dataSource={next} language="en" />);
    await expect.poll(alertText, { timeout: 30_000 }).toContain('Failed to load the dataset.');
    expect(alertText()).toContain('503');
    expect(shown()).toBe(true);
    const reads = infoReads;
    failing = false;
    retryButtons()[0]!.click();
    await expect.poll(() => infoReads, { timeout: 10_000 }).toBeGreaterThan(reads);
    await expect.poll(alertText, { timeout: 30_000 }).toBe('');
    expect(shown()).toBe(true);
  });
});
