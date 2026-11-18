import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../src/platform/workers/wasmUrl');
});

const wasmResponse = (type = 'application/wasm', status = 200) =>
  new Response(new Uint8Array([0, 97, 115, 109]), {
    status,
    headers: { 'Content-Type': type },
  });

async function workerManager() {
  vi.doMock('../src/platform/workers/wasmUrl', () => ({ wasmUrl: 'https://cdn.test/p.wasm' }));
  return import('../src/platform/workers/workerManager');
}

describe('compileWasmResponse', () => {
  it('compiles while streaming a response served as application/wasm', async () => {
    const { compileWasmResponse } = await workerManager();
    const module = {} as WebAssembly.Module;
    const streaming = vi.spyOn(WebAssembly, 'compileStreaming').mockResolvedValue(module);
    const bytes = vi.spyOn(WebAssembly, 'compile');
    await expect(compileWasmResponse(wasmResponse())).resolves.toBe(module);
    expect(streaming).toHaveBeenCalledTimes(1);
    expect(bytes).not.toHaveBeenCalled();
  });

  it('compiles from the bytes when the server sends another type', async () => {
    const { compileWasmResponse } = await workerManager();
    const module = {} as WebAssembly.Module;
    const streaming = vi.spyOn(WebAssembly, 'compileStreaming');
    const bytes = vi.spyOn(WebAssembly, 'compile').mockResolvedValue(module);
    await expect(compileWasmResponse(wasmResponse('application/octet-stream'))).resolves.toBe(
      module,
    );
    expect(streaming).not.toHaveBeenCalled();
    expect(bytes).toHaveBeenCalledTimes(1);
  });

  it('names a failed fetch', async () => {
    const { compileWasmResponse } = await workerManager();
    await expect(compileWasmResponse(wasmResponse('application/wasm', 404))).rejects.toThrow(
      'Failed to fetch WASM: 404',
    );
  });
});

describe('loadParquetWasmModule', () => {
  it('fetches and compiles once for every caller, and retries after a failure', async () => {
    const module = {} as WebAssembly.Module;
    vi.spyOn(WebAssembly, 'compileStreaming').mockResolvedValue(module);
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockImplementation(async () => wasmResponse());
    vi.stubGlobal('fetch', fetch);
    const { loadParquetWasmModule } = await workerManager();
    await expect(loadParquetWasmModule()).rejects.toThrow('network down');
    const first = loadParquetWasmModule();
    expect(loadParquetWasmModule()).toBe(first);
    await expect(first).resolves.toBe(module);
    await expect(loadParquetWasmModule()).resolves.toBe(module);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('preloadLeRobotViewer', () => {
  it('does nothing outside a browser (server rendering)', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.doMock('../src/platform/workers/workerManager', () => ({
      loadParquetWasmModule: vi.fn(),
    }));
    const { preloadLeRobotViewer } = await import('../src/react/preload');
    const { loadParquetWasmModule } = await import('../src/platform/workers/workerManager');
    expect(() => preloadLeRobotViewer()).not.toThrow();
    expect(loadParquetWasmModule).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    vi.doUnmock('../src/platform/workers/workerManager');
  });

  it('never throws and leaves no unhandled rejection, also when loading fails', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    const load = vi
      .fn<() => Promise<WebAssembly.Module>>()
      .mockImplementationOnce(() => {
        throw new Error('synchronous failure');
      })
      .mockRejectedValue(new Error('Failed to fetch WASM: 503'));
    vi.doMock('../src/platform/workers/workerManager', () => ({ loadParquetWasmModule: load }));
    const { preloadLeRobotViewer } = await import('../src/react/preload');
    expect(() => preloadLeRobotViewer()).not.toThrow();
    expect(() => preloadLeRobotViewer()).not.toThrow();
    // No unhandled rejection: the failure is reported when the viewer opens.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(load).toHaveBeenCalledTimes(2);
    vi.doUnmock('../src/platform/workers/workerManager');
  });
});
