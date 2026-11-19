import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
});

const load = () => import('../src/platform/workers/wasmConfig');

describe('setParquetWasmUrl', () => {
  it('keeps absolute and relative URL strings, URLs and null', async () => {
    const { setParquetWasmUrl, parquetWasmUrlOverride } = await load();
    setParquetWasmUrl('https://cdn.test/p.wasm');
    expect(parquetWasmUrlOverride()).toBe('https://cdn.test/p.wasm');
    setParquetWasmUrl('static/p.wasm');
    expect(parquetWasmUrlOverride()).toBe('static/p.wasm');
    setParquetWasmUrl(new URL('https://cdn.test/q.wasm'));
    expect(parquetWasmUrlOverride()).toBe('https://cdn.test/q.wasm');
    setParquetWasmUrl(null);
    expect(parquetWasmUrlOverride()).toBeNull();
  });

  it.each([[''], ['   '], ['http://['], [undefined], [42], [{}]])(
    'rejects %j by name and keeps the previous URL',
    async (value) => {
      const { setParquetWasmUrl, parquetWasmUrlOverride, INVALID_PARQUET_WASM_URL } = await load();
      setParquetWasmUrl('https://cdn.test/p.wasm');
      expect(() => setParquetWasmUrl(value as unknown as string)).toThrow(
        new RegExp(`^${INVALID_PARQUET_WASM_URL}: `),
      );
      expect(() => setParquetWasmUrl(value as unknown as string)).toThrow(TypeError);
      expect(parquetWasmUrlOverride()).toBe('https://cdn.test/p.wasm');
    },
  );

  it('tells listeners about a change, and only a change', async () => {
    const { setParquetWasmUrl, onParquetWasmUrlChange } = await load();
    const listener = vi.fn();
    const stop = onParquetWasmUrlChange(listener);
    setParquetWasmUrl('https://cdn.test/p.wasm');
    setParquetWasmUrl(new URL('https://cdn.test/p.wasm'));
    expect(listener).toHaveBeenCalledTimes(1);
    setParquetWasmUrl(null);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    setParquetWasmUrl('https://cdn.test/p.wasm');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
