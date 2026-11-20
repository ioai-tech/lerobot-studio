import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer, type LeRobotViewerError } from '@/components/LeRobotViewer';
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
  constructor(private readonly mode: 'fail' | 'hang') {
    super(FIXTURE);
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
  });

  it('a metadata file that cannot be read is named as unreadable, not as invalid Parquet', async () => {
    const path = 'meta/episodes/chunk-000/file-000.parquet';
    root.render(<LeRobotViewer dataSource={new OneFileUnreadable(path)} language="en" />);
    await expect.poll(alertText, { timeout: 60_000 }).toContain('Failed to load the dataset.');
    expect(alertText()).toContain(`could not read ${path}`);
    expect(alertText()).not.toContain('could not be parsed as Parquet');
    expect(alertText()).not.toContain('数据集格式校验未通过');
  });
});
