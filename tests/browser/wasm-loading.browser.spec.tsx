import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import {
  LeRobotViewer,
  preloadLeRobotViewer,
  setParquetWasmUrl,
  type LeRobotViewerError,
} from '@/public-api';
import { FetchDataSource } from './fixtures';
import { recordWorkers, spyOnPageWasm, wasmControl } from './wasmControl';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

// Committed, not generated: two cameras, 360 frames.
const FRAME_CODED = '/tests/fixtures/static/frame-coded-v3';

let host: HTMLDivElement;
let root: Root;
let errors: LeRobotViewerError[];

beforeEach(async () => {
  await wasmControl({ mode: 'normal', reset: true });
  errors = [];
  await page.viewport(1280, 800);
  host = document.createElement('div');
  host.style.cssText = 'width:1280px;height:800px';
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  root.unmount();
  host.remove();
  setParquetWasmUrl(null);
  vi.restoreAllMocks();
  await wasmControl({ mode: 'normal', reset: true });
});

const slider = () => host.querySelector('[role="slider"][aria-label="Playback progress"]');
const open = (key: string) =>
  root.render(
    <LeRobotViewer
      key={key}
      dataSource={new FetchDataSource(FRAME_CODED)}
      language="en"
      onFatalError={(error) => errors.push(error)}
    />,
  );

it('opens a dataset with the WASM downloaded and compiled only in a worker, once', async () => {
  const pageWasm = spyOnPageWasm();
  try {
    open('a');
    await expect.poll(slider, { timeout: 30_000 }).not.toBeNull();
    expect(errors).toEqual([]);
    expect(pageWasm.calls()).toBe(0);
    expect((await wasmControl()).wasmRequests).toBe(1);
  } finally {
    pageWasm.restore();
  }
});

it('names a missing WASM, downloads it once per open, and opens once it is back', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await wasmControl({ mode: 'missing' });
  open('a');
  await expect.poll(() => errors.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(errors[0].code).toBe('PARQUET_ENGINE_UNAVAILABLE');
  expect(errors[0].message).toContain('HTTP 404');
  expect(errors[0].message).not.toContain('could not be parsed as Parquet');
  // No retry loop: the failed worker answers every read with the same error.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect((await wasmControl()).wasmRequests).toBe(1);

  await wasmControl({ mode: 'normal' });
  errors = [];
  open('b');
  await expect.poll(slider, { timeout: 30_000 }).not.toBeNull();
  expect(errors).toEqual([]);
  expect((await wasmControl()).wasmRequests).toBe(2);
});

it('names a corrupt WASM, and the next open downloads it again and opens', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await wasmControl({ mode: 'corrupt' });
  open('a');
  await expect.poll(() => errors.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(errors[0].code).toBe('PARQUET_ENGINE_UNAVAILABLE');
  expect(errors[0].message).toContain('could not compile');
  expect((await wasmControl()).wasmRequests).toBe(1);

  await wasmControl({ mode: 'normal' });
  errors = [];
  open('b');
  await expect.poll(slider, { timeout: 30_000 }).not.toBeNull();
  expect(errors).toEqual([]);
  expect((await wasmControl()).wasmRequests).toBe(2);
});

it("uses the host's own copy set with setParquetWasmUrl, never the packaged file", async () => {
  setParquetWasmUrl('/__wasm-test/self-hosted.wasm');
  open('a');
  await expect.poll(slider, { timeout: 30_000 }).not.toBeNull();
  expect(errors).toEqual([]);
  const state = await wasmControl();
  expect(state.selfHostedRequests).toBe(1);
  expect(state.wasmRequests).toBe(0);
});

it('preloadLeRobotViewer starts one worker ahead of the viewer, which the viewer adopts', async () => {
  const workers = recordWorkers();
  const pageWasm = spyOnPageWasm();
  try {
    preloadLeRobotViewer();
    preloadLeRobotViewer();
    // The download starts before any data source exists.
    await expect.poll(async () => (await wasmControl()).wasmRequests, { timeout: 30_000 }).toBe(1);
    open('a');
    await expect.poll(slider, { timeout: 30_000 }).not.toBeNull();
    expect(errors).toEqual([]);
    expect(workers.scripts.filter((url) => url.includes('parquet.worker'))).toHaveLength(1);
    expect((await wasmControl()).wasmRequests).toBe(1);
    expect(pageWasm.calls()).toBe(0);
  } finally {
    workers.restore();
    pageWasm.restore();
  }
});
