import { afterEach, describe, expect, it, vi } from 'vitest';

const init = vi.fn(async () => undefined);
vi.mock('parquet-wasm', () => ({ default: init }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  init.mockClear();
});

const URL_ = 'https://cdn.test/assets/parquet_wasm_bg-abc.wasm';
const wasm = (type = 'application/wasm', status = 200) =>
  new Response(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]), {
    status,
    headers: { 'Content-Type': type },
  });

async function load() {
  const posted: unknown[] = [];
  const module = await import('../src/platform/workers/parquetWasmModule');
  const settled = () =>
    vi.waitFor(() => {
      if (!posted.some((m) => (m as { type: string }).type === 'parquet-wasm')) throw new Error();
    });
  return { ...module, posted, post: (m: unknown) => posted.push(m), settled };
}

describe('the worker-side parquet WASM load', () => {
  it('stream-compiles a response served as application/wasm, then starts the module', async () => {
    const compiled = {} as WebAssembly.Module;
    const streaming = vi.spyOn(WebAssembly, 'compileStreaming').mockResolvedValue(compiled);
    const bytes = vi.spyOn(WebAssembly, 'compile');
    const fetch = vi.fn(async () => wasm());
    vi.stubGlobal('fetch', fetch);
    const { handleInitMessage, initParquetWasm, post, posted, settled } = await load();
    expect(handleInitMessage({ type: 'init-wasm', url: URL_ }, post)).toBe(true);
    await expect(initParquetWasm()).resolves.toBeUndefined();
    await settled();
    expect(fetch).toHaveBeenCalledWith(URL_);
    expect(streaming).toHaveBeenCalledTimes(1);
    expect(bytes).not.toHaveBeenCalled();
    expect(init).toHaveBeenCalledWith({ module_or_path: compiled });
    expect(posted).toEqual([{ type: 'parquet-wasm', ok: true }]);
  });

  it('compiles from the bytes when the server sends another type', async () => {
    const compiled = {} as WebAssembly.Module;
    const streaming = vi.spyOn(WebAssembly, 'compileStreaming');
    const bytes = vi.spyOn(WebAssembly, 'compile').mockResolvedValue(compiled);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => wasm('application/octet-stream; charset=binary')),
    );
    const { handleInitMessage, initParquetWasm, post } = await load();
    handleInitMessage({ type: 'init-wasm', url: URL_ }, post);
    await initParquetWasm();
    expect(streaming).not.toHaveBeenCalled();
    expect(bytes).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith({ module_or_path: compiled });
  });

  it('names an HTTP failure and keeps it: later calls fail at once without downloading again', async () => {
    const fetch = vi.fn(async () => wasm('text/html', 404));
    vi.stubGlobal('fetch', fetch);
    const { handleInitMessage, initParquetWasm, post, posted, settled } = await load();
    handleInitMessage({ type: 'init-wasm', url: URL_ }, post);
    await expect(initParquetWasm()).rejects.toThrow(
      `PARQUET_ENGINE_UNAVAILABLE: the Parquet reader could not be loaded (HTTP 404 for ${URL_})`,
    );
    await expect(initParquetWasm()).rejects.toThrow('HTTP 404');
    await settled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(posted).toEqual([
      { type: 'parquet-wasm', ok: false, message: expect.stringContaining('HTTP 404') },
    ]);
  });

  it('names a refused or corrupt compile with the browser message', async () => {
    vi.spyOn(WebAssembly, 'compileStreaming').mockRejectedValue(
      new WebAssembly.CompileError("Refused to compile: 'wasm-unsafe-eval' is not allowed"),
    );
    const fetch = vi.fn(async () => wasm());
    vi.stubGlobal('fetch', fetch);
    const { handleInitMessage, initParquetWasm, post } = await load();
    handleInitMessage({ type: 'init-wasm', url: URL_ }, post);
    await expect(initParquetWasm()).rejects.toThrow(
      /PARQUET_ENGINE_UNAVAILABLE: .*could not compile .*CompileError: Refused to compile/,
    );
    await expect(initParquetWasm()).rejects.toThrow('could not compile');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('names a download that fails on the network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const { handleInitMessage, initParquetWasm, post } = await load();
    handleInitMessage({ type: 'init-wasm', url: URL_ }, post);
    await expect(initParquetWasm()).rejects.toThrow(
      /PARQUET_ENGINE_UNAVAILABLE: .*could not download .*TypeError: Failed to fetch/,
    );
  });

  it('waits for the URL, ignores other messages, and keeps the first URL', async () => {
    vi.spyOn(WebAssembly, 'compileStreaming').mockResolvedValue({} as WebAssembly.Module);
    const fetch = vi.fn(async () => wasm());
    vi.stubGlobal('fetch', fetch);
    const { handleInitMessage, initParquetWasm, post } = await load();
    const pending = initParquetWasm();
    expect(handleInitMessage({ type: 'preload-episode' }, post)).toBe(false);
    expect(handleInitMessage(null, post)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    handleInitMessage({ type: 'init-wasm', url: URL_ }, post);
    expect(handleInitMessage({ type: 'init-wasm', url: 'https://other.test/x.wasm' }, post)).toBe(
      true,
    );
    await pending;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(URL_);
  });
});
