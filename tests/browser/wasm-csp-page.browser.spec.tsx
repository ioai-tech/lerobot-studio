import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer, type LeRobotViewerError } from '@/public-api';
import { FetchDataSource } from './fixtures';
import { spyOnPageWasm, wasmControl } from './wasmControl';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const FRAME_CODED = '/tests/fixtures/static/frame-coded-v3';

// Its own file: a page policy cannot be lifted once set.
it("opens a dataset on a host page whose CSP has no 'wasm-unsafe-eval' and no data: sources", async () => {
  await wasmControl({ mode: 'normal', reset: true });
  const policy = document.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "script-src 'self' 'unsafe-inline'; worker-src 'self'; connect-src 'self' ws:";
  document.head.prepend(policy);
  // The page itself may not compile WebAssembly.
  await expect(
    WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
  ).rejects.toThrow();

  const pageWasm = spyOnPageWasm();
  await page.viewport(1280, 800);
  const host = document.createElement('div');
  host.style.cssText = 'width:1280px;height:800px';
  document.body.append(host);
  const errors: LeRobotViewerError[] = [];
  const root = createRoot(host);
  root.render(
    <LeRobotViewer
      dataSource={new FetchDataSource(FRAME_CODED)}
      language="en"
      onFatalError={(error) => errors.push(error)}
    />,
  );
  try {
    await expect
      .poll(() => host.querySelector('[role="slider"][aria-label="Playback progress"]'), {
        timeout: 30_000,
      })
      .not.toBeNull();
    expect(errors).toEqual([]);
    expect(pageWasm.calls()).toBe(0);
    expect((await wasmControl()).wasmRequests).toBe(1);
  } finally {
    pageWasm.restore();
    root.unmount();
    host.remove();
  }
}, 60_000);
