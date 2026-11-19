import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer, type LeRobotViewerError } from '@/public-api';
import { FetchDataSource } from './fixtures';
import { wasmControl } from './wasmControl';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const FRAME_CODED = '/tests/fixtures/static/frame-coded-v3';

it("names a worker script CSP without 'wasm-unsafe-eval', without retrying the download", async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await wasmControl({ mode: 'worker-csp', reset: true });
  await page.viewport(1280, 800);
  const host = document.createElement('div');
  host.style.cssText = 'width:1280px;height:800px';
  document.body.append(host);
  const errors: LeRobotViewerError[] = [];
  const root = createRoot(host);
  try {
    root.render(
      <LeRobotViewer
        dataSource={new FetchDataSource(FRAME_CODED)}
        language="en"
        onFatalError={(error) => errors.push(error)}
      />,
    );
    await expect.poll(() => errors.length, { timeout: 30_000 }).toBeGreaterThan(0);
    expect(errors[0].code).toBe('PARQUET_ENGINE_UNAVAILABLE');
    expect(errors[0].message).toContain('could not compile');
    expect(errors[0].message).not.toContain('could not be parsed as Parquet');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect((await wasmControl()).wasmRequests).toBe(1);
  } finally {
    root.unmount();
    host.remove();
    await wasmControl({ mode: 'normal', reset: true });
  }
}, 60_000);

it('leaves the worker scripts without that policy once the mode is back to normal', async () => {
  // The policy run must not leave a cached worker script whose headers (kept
  // on a 304) carry the policy into every later open and test file.
  await wasmControl({ mode: 'normal', reset: true });
  await page.viewport(1280, 800);
  const host = document.createElement('div');
  host.style.cssText = 'width:1280px;height:800px';
  document.body.append(host);
  const errors: LeRobotViewerError[] = [];
  const root = createRoot(host);
  try {
    root.render(
      <LeRobotViewer
        dataSource={new FetchDataSource(FRAME_CODED)}
        language="en"
        onFatalError={(error) => errors.push(error)}
      />,
    );
    await expect
      .poll(() => host.querySelector('[role="slider"][aria-label="Playback progress"]'), {
        timeout: 30_000,
      })
      .not.toBeNull();
    expect(errors).toEqual([]);
  } finally {
    root.unmount();
    host.remove();
  }
}, 60_000);
