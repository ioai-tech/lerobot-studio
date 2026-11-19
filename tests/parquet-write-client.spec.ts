import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as arrow from 'apache-arrow';

const remote = {
  writeParquet: vi.fn(async (ipc: Uint8Array) => new Uint8Array([ipc.byteLength])),
};
const createParquetWorker = vi.fn(() => remote);
const terminateWorker = vi.fn();
vi.mock('../src/platform/workers/workerManager', () => ({ createParquetWorker, terminateWorker }));

beforeEach(() => {
  vi.useFakeTimers();
  remote.writeParquet.mockClear();
  createParquetWorker.mockClear();
  terminateWorker.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

const table = () => new arrow.Table({ x: arrow.vectorFromArray([1, 2, 3]) });

describe('export Parquet writing', () => {
  it('writes in its own Parquet worker (never the prewarmed one), shared by every write', async () => {
    const { writeParquetBytes } = await import('../src/platform/export/parquetWriteClient');
    const ipc = arrow.tableToIPC(table(), 'stream');
    await writeParquetBytes(ipc, 'snappy');
    await writeParquetBytes(arrow.tableToIPC(table(), 'stream'));
    expect(createParquetWorker).toHaveBeenCalledTimes(1);
    expect(createParquetWorker).toHaveBeenCalledWith({ adoptPrewarmed: false });
    expect(remote.writeParquet).toHaveBeenNthCalledWith(1, expect.any(Uint8Array), 'snappy');
    expect(remote.writeParquet).toHaveBeenNthCalledWith(2, expect.any(Uint8Array), undefined);
  });

  it('terminates the worker once no write came for the idle time', async () => {
    const { writeParquetBytes, EXPORT_WORKER_IDLE_MS } =
      await import('../src/platform/export/parquetWriteClient');
    await writeParquetBytes(arrow.tableToIPC(table(), 'stream'));
    vi.advanceTimersByTime(EXPORT_WORKER_IDLE_MS - 1);
    expect(terminateWorker).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(terminateWorker).toHaveBeenCalledTimes(1);
    await writeParquetBytes(arrow.tableToIPC(table(), 'stream'));
    expect(createParquetWorker).toHaveBeenCalledTimes(2);
  });

  it('drops a worker whose Parquet reader could not load, so the next export starts afresh', async () => {
    const { writeParquetBytes } = await import('../src/platform/export/parquetWriteClient');
    remote.writeParquet.mockRejectedValueOnce(
      new Error('PARQUET_ENGINE_UNAVAILABLE: the Parquet reader could not be loaded (HTTP 404)'),
    );
    await expect(writeParquetBytes(arrow.tableToIPC(table(), 'stream'))).rejects.toThrow(
      'PARQUET_ENGINE_UNAVAILABLE',
    );
    expect(terminateWorker).toHaveBeenCalledTimes(1);
    await writeParquetBytes(arrow.tableToIPC(table(), 'stream'));
    expect(createParquetWorker).toHaveBeenCalledTimes(2);
  });

  it('keeps the worker after an error about the data', async () => {
    const { writeParquetBytes } = await import('../src/platform/export/parquetWriteClient');
    remote.writeParquet.mockRejectedValueOnce(new Error('Invalid IPC stream'));
    await expect(writeParquetBytes(new Uint8Array([1, 2]))).rejects.toThrow('Invalid IPC stream');
    expect(terminateWorker).not.toHaveBeenCalled();
  });

  it('drops an idle worker at once when the host changes the WASM URL', async () => {
    const { writeParquetBytes } = await import('../src/platform/export/parquetWriteClient');
    const { setParquetWasmUrl } = await import('../src/platform/workers/wasmConfig');
    await writeParquetBytes(arrow.tableToIPC(table(), 'stream'));
    setParquetWasmUrl('https://cdn.test/p.wasm');
    expect(terminateWorker).toHaveBeenCalledTimes(1);
    setParquetWasmUrl('https://cdn.test/p.wasm'); // no change, nothing to drop
    await writeParquetBytes(arrow.tableToIPC(table(), 'stream'));
    expect(createParquetWorker).toHaveBeenCalledTimes(2);
    setParquetWasmUrl(null);
  });

  it('lets writes in flight finish on a changed URL, then drops the worker without the idle wait', async () => {
    const { writeParquetBytes } = await import('../src/platform/export/parquetWriteClient');
    const { setParquetWasmUrl } = await import('../src/platform/workers/wasmConfig');
    let finish: (bytes: Uint8Array) => void = () => undefined;
    remote.writeParquet.mockImplementationOnce(
      () => new Promise<Uint8Array>((resolve) => (finish = resolve)),
    );
    const write = writeParquetBytes(arrow.tableToIPC(table(), 'stream'));
    setParquetWasmUrl('https://cdn.test/p.wasm');
    expect(terminateWorker).not.toHaveBeenCalled();
    finish(new Uint8Array([1]));
    await expect(write).resolves.toEqual(new Uint8Array([1]));
    expect(terminateWorker).toHaveBeenCalledTimes(1);
    setParquetWasmUrl(null);
  });
});
