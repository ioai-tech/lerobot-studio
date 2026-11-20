import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer, type LeRobotViewerError } from '@/components/LeRobotViewer';
import { zipSync } from 'fflate';
import { FileListDirectoryDataSource, ZipDataSourceLocal, type DataSource } from '@/platform';
import { fileNotFoundError } from '@/core';
import { FetchDataSource } from './fixtures';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const FIXTURE = '/tests/fixtures/datasets/lerobotv3';

/** The browser's connectivity as the page sees it (navigator.onLine and its events). */
let browserOnline = true;
function setOnline(online: boolean) {
  browserOnline = online;
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

/**
 * Offline, reads fail the way the browser fails them (`TypeError: Failed to
 * fetch`), or, with `hang`, wait until the browser is back online (a host
 * whose reads wait for the connection).
 */
class OfflineAwareSource extends FetchDataSource {
  reads = 0;
  constructor(
    private readonly mode: 'fail' | 'hang',
    base = FIXTURE,
  ) {
    super(base);
  }
  private async gate() {
    this.reads += 1;
    if (browserOnline) return;
    if (this.mode === 'fail') throw new TypeError('Failed to fetch');
    await new Promise<void>((resolve) =>
      window.addEventListener('online', () => resolve(), { once: true }),
    );
  }
  override async exists(path: string) {
    await this.gate();
    return super.exists(path);
  }
  override async readText(path: string) {
    await this.gate();
    return super.readText(path);
  }
  override async readBytes(path: string) {
    await this.gate();
    return super.readBytes(path);
  }
}

/** Reads every file except one, which fails like a lost connection. */
class OneFileUnreadable extends FetchDataSource {
  constructor(private readonly unreadable: string) {
    super(FIXTURE);
  }
  override async readBytes(path: string) {
    if (path === this.unreadable) throw new TypeError('Failed to fetch');
    return super.readBytes(path);
  }
}

/** A v2 dataset whose one text file answers with an HTTP status, or is not in the dataset. */
class V2TextStatus extends FetchDataSource {
  constructor(
    private readonly path: string,
    private readonly status: number | 'missing',
  ) {
    super('/tests/fixtures/datasets/lerobotv2');
  }
  override async readText(path: string) {
    if (path === this.path) {
      if (this.status === 'missing') throw fileNotFoundError(path);
      throw new Error(`fetch ${path} -> ${this.status}`);
    }
    return super.readText(path);
  }
}

const V2_FILES = [
  'meta/info.json',
  'meta/episodes.jsonl',
  'meta/episodes_stats.jsonl',
  'meta/tasks.jsonl',
  'data/chunk-000/episode_000000.parquet',
  'data/chunk-000/episode_000001.parquet',
];

/** The v2 fixture as selected files under one folder, without `omit`. */
async function v2Files(omit: string): Promise<Array<{ path: string; bytes: Uint8Array }>> {
  return Promise.all(
    V2_FILES.filter((path) => path !== omit).map(async (path) => ({
      path,
      bytes: new Uint8Array(
        await (await fetch(`/tests/fixtures/datasets/lerobotv2/${path}`)).arrayBuffer(),
      ),
    })),
  );
}

/** Fails every read, online or not, and counts them. */
class AlwaysFailing extends FetchDataSource {
  reads = 0;
  constructor() {
    super(FIXTURE);
  }
  override async exists() {
    this.reads += 1;
    throw new TypeError('Failed to fetch');
  }
  override async readText(): Promise<string> {
    this.reads += 1;
    throw new TypeError('Failed to fetch');
  }
  override async readBytes(): Promise<Uint8Array> {
    this.reads += 1;
    throw new TypeError('Failed to fetch');
  }
}

/** A host that renders its own fallback instead of the viewer on a fatal error (as the EmbodiFlow console does). */
function UnmountingHost({
  source,
  onFatal,
}: {
  source: DataSource;
  onFatal: (error: LeRobotViewerError) => void;
}) {
  const [fatal, setFatal] = React.useState<LeRobotViewerError | null>(null);
  if (fatal) return <p data-testid="host-fallback">{fatal.code}</p>;
  return (
    <LeRobotViewer
      dataSource={source}
      language="en"
      onFatalError={(error) => {
        onFatal(error);
        setFatal(error);
      }}
    />
  );
}

describe('an open that cannot reach the data ends in a named, retryable state (s10 F-32)', () => {
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

  const alertText = () => host.querySelector('[role="alert"]')?.textContent ?? '';
  const loaded = () => /\d+ episodes?/.test(host.textContent ?? '');

  it('offline before the data loads: "You\'re offline" with Retry at once, never a spinner; loads when back online', async () => {
    setOnline(false);
    const source = new OfflineAwareSource('hang');
    root.render(<LeRobotViewer dataSource={source} language="en" />);
    await expect.poll(alertText, { timeout: 5_000 }).toContain("You're offline");
    expect(
      Array.from(host.querySelectorAll('button')).some((button) => button.textContent === 'Retry'),
    ).toBe(true);
    // Still offline a while later: the named state stays, no spinner comes back.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(alertText()).toContain("You're offline");
    expect(host.querySelector('.animate-spin')).toBeNull();

    setOnline(true);
    await expect.poll(loaded, { timeout: 60_000 }).toBe(true);
    expect(alertText()).toBe('');
  });

  it('reads that failed offline run again by themselves once the browser is back online', async () => {
    setOnline(false);
    const source = new OfflineAwareSource('fail');
    root.render(<LeRobotViewer dataSource={source} language="en" />);
    await expect.poll(alertText, { timeout: 10_000 }).toContain("You're offline");
    await expect.poll(() => source.reads).toBeGreaterThan(0);
    setOnline(true);
    // No click: the open runs again.
    await expect.poll(loaded, { timeout: 60_000 }).toBe(true);
  });

  it('a host is told NETWORK_OFFLINE (recoverable), not a dataset failure', async () => {
    setOnline(false);
    const errors: LeRobotViewerError[] = [];
    root.render(
      <LeRobotViewer
        dataSource={new OfflineAwareSource('fail')}
        language="en"
        onFatalError={(error) => errors.push(error)}
      />,
    );
    await expect.poll(() => errors.at(-1)?.code, { timeout: 10_000 }).toBe('NETWORK_OFFLINE');
    expect(errors.at(-1)?.recoverable).toBe(true);
    // The failure behind it travels with it: the named read failure, and its cause.
    const cause = errors.at(-1)?.cause as Error | undefined;
    expect(cause?.message).toContain('DATASET_READ_FAILED: could not read meta/info.json');
    expect((cause?.cause as Error | undefined)?.message).toBe('Failed to fetch');
  });

  it('a metadata file that cannot be read is named as unreadable, not as invalid Parquet', async () => {
    const path = 'meta/episodes/chunk-000/file-000.parquet';
    root.render(<LeRobotViewer dataSource={new OneFileUnreadable(path)} language="en" />);
    await expect.poll(alertText, { timeout: 60_000 }).toContain('Failed to load the dataset.');
    expect(alertText()).toContain(`could not read ${path}`);
    expect(alertText()).not.toContain('could not be parsed as Parquet');
    expect(alertText()).not.toContain('数据集格式校验未通过');
  });

  it('navigator.onLine wrongly false on a working network: a host that unmounts on fatal errors still gets the dataset', async () => {
    // No offline event: some proxies / VPNs leave navigator.onLine false while reads work.
    browserOnline = false;
    const errors: LeRobotViewerError[] = [];
    root.render(
      <UnmountingHost source={new FetchDataSource(FIXTURE)} onFatal={(e) => errors.push(e)} />,
    );
    await expect.poll(loaded, { timeout: 60_000 }).toBe(true);
    expect(errors).toEqual([]);
    expect(host.querySelector('[data-testid="host-fallback"]')).toBeNull();
  });

  it('standalone with navigator.onLine wrongly false: "You\'re offline" until the dataset arrives, then the dataset', async () => {
    browserOnline = false;
    root.render(<LeRobotViewer dataSource={new FetchDataSource(FIXTURE)} language="en" />);
    await expect.poll(loaded, { timeout: 60_000 }).toBe(true);
    expect(alertText()).toBe('');
  });

  it('an episode that cannot load (offline) keeps the shown dataset; a host is not told anything', async () => {
    const errors: LeRobotViewerError[] = [];
    // The metadata reads work; the episode data reads fail like a lost connection.
    const source = new (class extends FetchDataSource {
      override async readBytes(path: string) {
        if (path.startsWith('data/')) throw new TypeError('Failed to fetch');
        return super.readBytes(path);
      }
    })(FIXTURE);
    root.render(
      <LeRobotViewer
        dataSource={source}
        language="en"
        onFatalError={(error) => errors.push(error)}
      />,
    );
    await expect.poll(loaded, { timeout: 60_000 }).toBe(true);
    setOnline(false);
    await expect
      .poll(() => host.textContent ?? '', { timeout: 20_000 })
      .toContain('Failed to fetch');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(loaded()).toBe(true);
    expect(alertText()).not.toContain("You're offline");
    expect(errors).toEqual([]);
  });

  it('back online, a failed open runs again once; a failure online then stays, with no retry loop', async () => {
    setOnline(false);
    const source = new AlwaysFailing();
    root.render(<LeRobotViewer dataSource={source} language="en" />);
    await expect.poll(alertText, { timeout: 10_000 }).toContain("You're offline");
    await expect.poll(() => source.reads).toBeGreaterThan(0);
    const offlineReads = source.reads;
    setOnline(true);
    await expect.poll(() => source.reads, { timeout: 10_000 }).toBeGreaterThan(offlineReads);
    await expect.poll(alertText, { timeout: 10_000 }).toContain('Failed to load the dataset.');
    const afterRetry = source.reads;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(source.reads).toBe(afterRetry);
  });

  it('Retry resolves a URL source again after its preflight failed', async () => {
    const url = 'https://example.invalid/dataset.zip';
    let preflights = 0;
    const realFetch = window.fetch;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input instanceof Request ? input.url : input) === url) {
        preflights += 1;
        throw new TypeError('Failed to fetch');
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      root.render(<LeRobotViewer dataSource={url} language="en" />);
      await expect.poll(() => preflights, { timeout: 10_000 }).toBeGreaterThan(0);
      const retry = () =>
        Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
          (button) => button.textContent === 'Retry',
        );
      await expect.poll(() => retry() != null, { timeout: 10_000 }).toBe(true);
      const before = preflights;
      retry()!.click();
      await expect.poll(() => preflights, { timeout: 10_000 }).toBeGreaterThan(before);
    } finally {
      window.fetch = realFetch;
    }
  });

  it('a v2 metadata text file that answers 503 is named as unreadable, not as an invalid dataset', async () => {
    root.render(
      <LeRobotViewer dataSource={new V2TextStatus('meta/episodes.jsonl', 503)} language="en" />,
    );
    await expect.poll(alertText, { timeout: 60_000 }).toContain('Failed to load the dataset.');
    expect(alertText()).toContain('DATASET_READ_FAILED: could not read meta/episodes.jsonl');
    expect(alertText()).not.toContain('数据集格式校验未通过');
  });

  it('a v2 metadata file that a custom source reports missing stays a dataset validation failure', async () => {
    root.render(
      <LeRobotViewer
        dataSource={new V2TextStatus('meta/episodes.jsonl', 'missing')}
        language="en"
      />,
    );
    await expect.poll(alertText, { timeout: 60_000 }).toContain('Failed to load the dataset.');
    expect(alertText()).not.toContain('DATASET_READ_FAILED');
  });

  it('a ZIP without a required file is an invalid dataset, not a failed read', async () => {
    const files = await v2Files('meta/episodes.jsonl');
    const zip = zipSync(Object.fromEntries(files.map(({ path, bytes }) => [`ds/${path}`, bytes])));
    const source = new ZipDataSourceLocal(new File([zip], 'ds.zip', { type: 'application/zip' }));
    // An absent optional file is the same typed miss (never a failed read).
    await expect(source.readText('meta/subtasks.jsonl')).rejects.toMatchObject({
      name: 'NotFoundError',
    });
    root.render(<LeRobotViewer dataSource={source} language="en" />);
    await expect.poll(alertText, { timeout: 60_000 }).toContain('Failed to load the dataset.');
    expect(alertText()).toContain('meta/episodes.jsonl does not exist or cannot be read');
    expect(alertText()).not.toContain('DATASET_READ_FAILED');
  });

  it('a folder without a required file is an invalid dataset, not a failed read', async () => {
    const files = await v2Files('meta/episodes.jsonl');
    const source = new FileListDirectoryDataSource(
      files.map(({ path, bytes }) => ({
        file: new File([bytes], path.split('/').pop()!),
        path: `ds/${path}`,
      })),
    );
    root.render(<LeRobotViewer dataSource={source} language="en" />);
    await expect.poll(alertText, { timeout: 60_000 }).toContain('Failed to load the dataset.');
    expect(alertText()).toContain('meta/episodes.jsonl does not exist or cannot be read');
    expect(alertText()).not.toContain('DATASET_READ_FAILED');
  });
});
