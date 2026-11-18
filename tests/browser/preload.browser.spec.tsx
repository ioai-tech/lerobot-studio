import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer, preloadLeRobotViewer } from '@/public-api';
import { FetchDataSource } from './fixtures';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const FRAME_CODED = '/tests/fixtures/static/frame-coded-v3';
const isWasm = (input: RequestInfo | URL) =>
  String(input instanceof Request ? input.url : input).includes('parquet_wasm_bg');

let host: HTMLDivElement;
let root: Root;
const realFetch = window.fetch.bind(window);
let wasmFetches = 0;
let blockWasm = false;

beforeEach(async () => {
  wasmFetches = 0;
  blockWasm = false;
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    if (isWasm(input)) {
      wasmFetches += 1;
      if (blockWasm) throw new TypeError('wasm blocked by test');
    }
    return realFetch(input, init);
  });
  await page.viewport(1280, 800);
  host = document.createElement('div');
  host.style.cssText = 'width:1280px;height:800px';
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  root.unmount();
  host.remove();
  vi.restoreAllMocks();
});

const videos = () => Array.from(host.querySelectorAll('video'));

// First: a failed preload is not cached, so the next test starts afresh.
it('a failed preload surfaces when the viewer opens, by name', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  blockWasm = true;
  expect(() => preloadLeRobotViewer()).not.toThrow();
  root.render(<LeRobotViewer dataSource={new FetchDataSource(FRAME_CODED)} language="en" />);
  // Named as the reader failing, with its cause, never as an invalid file.
  await expect
    .poll(() => host.textContent ?? '', { timeout: 30_000 })
    .toContain('PARQUET_ENGINE_UNAVAILABLE');
  expect(host.textContent).toContain('wasm blocked by test');
  expect(host.textContent).not.toContain('could not be parsed as Parquet');
});

it('preloading twice fetches the WASM once, and the viewer reuses it', async () => {
  preloadLeRobotViewer();
  preloadLeRobotViewer();
  await expect.poll(() => wasmFetches, { timeout: 30_000 }).toBe(1);
  root.render(<LeRobotViewer dataSource={new FetchDataSource(FRAME_CODED)} language="en" />);
  await expect
    .poll(() => videos().length === 2 && videos().every((video) => video.readyState >= 2), {
      timeout: 60_000,
    })
    .toBe(true);
  expect(wasmFetches).toBe(1);
});
