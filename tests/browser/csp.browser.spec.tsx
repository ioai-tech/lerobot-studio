import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { FetchDataSource } from './fixtures';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

// Committed, not generated: two cameras, 360 frames.
const FRAME_CODED = '/tests/fixtures/static/frame-coded-v3';

// Its own file: a page policy cannot be lifted once set.
it("opens a dataset on a host page whose CSP has no 'wasm-unsafe-eval'", async () => {
  // A host that allows its scripts and workers, but no WebAssembly compiled on the page.
  const policy = document.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "script-src 'self' 'unsafe-inline' blob: data:; worker-src 'self' blob: data:";
  document.head.prepend(policy);
  await expect(
    WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
  ).rejects.toThrow();

  const compileStreaming = vi.spyOn(WebAssembly, 'compileStreaming');
  const compile = vi.spyOn(WebAssembly, 'compile');
  const fetches = vi.spyOn(window, 'fetch');
  await page.viewport(1280, 800);
  const host = document.createElement('div');
  host.style.cssText = 'width:1280px;height:800px';
  document.body.append(host);
  const errors: string[] = [];
  const root = createRoot(host);
  root.render(
    <LeRobotViewer
      dataSource={new FetchDataSource(FRAME_CODED)}
      language="en"
      onFatalError={(error) => errors.push(`${error.code}: ${error.message}`)}
    />,
  );
  try {
    await expect
      .poll(() => host.querySelector('[role="slider"][aria-label="Playback progress"]'), {
        timeout: 30_000,
      })
      .not.toBeNull();
    expect(errors).toEqual([]);
    expect(host.textContent).not.toContain('PARQUET_ENGINE_UNAVAILABLE');
    // The page tried once and was refused; the workers compiled the same
    // download (one WASM fetch).
    expect(compileStreaming.mock.calls.length + compile.mock.calls.length).toBe(1);
    const wasmFetches = fetches.mock.calls.filter(([input]) => {
      const url = String(input instanceof Request ? input.url : input);
      return url.startsWith('data:application/wasm') || url.includes('parquet_wasm_bg');
    });
    expect(wasmFetches).toHaveLength(1);
  } finally {
    root.unmount();
    host.remove();
  }
}, 60_000);
