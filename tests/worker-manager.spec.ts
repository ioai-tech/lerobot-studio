import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A stand-in Worker: records what the page posts, lets a test emit events. */
class FakeWorker extends EventTarget {
  static created: FakeWorker[] = [];
  static throwOnCreate: Error | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor(
    readonly url: string | URL,
    readonly options?: WorkerOptions,
  ) {
    super();
    if (FakeWorker.throwOnCreate) throw FakeWorker.throwOnCreate;
    FakeWorker.created.push(this);
  }
  postMessage(message: unknown) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(type: string, data?: unknown) {
    const event = new Event(type) as Event & { data?: unknown };
    event.data = data;
    this.dispatchEvent(event);
  }
  started() {
    this.emit('message', { type: 'parquet-worker-started' });
  }
}

beforeEach(() => {
  FakeWorker.created = [];
  FakeWorker.throwOnCreate = null;
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('location', { href: 'https://host.test/app/viewer?x=1' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const load = () => import('../src/platform/workers/workerManager');
const config = () => import('../src/platform/workers/wasmConfig');
const ENGINE = /^PARQUET_ENGINE_UNAVAILABLE: /;

describe('workerManager', () => {
  it('starts a module worker and posts it the absolute WASM URL, nothing else', async () => {
    const { createParquetWorker, resolveParquetWasmUrl } = await load();
    createParquetWorker();
    const [worker] = FakeWorker.created;
    expect(worker.options).toEqual({ type: 'module' });
    const url = resolveParquetWasmUrl();
    expect(url).toMatch(/^https?:\/\/.*parquet_wasm_bg.*\.wasm/);
    expect(worker.posted).toEqual([{ type: 'init-wasm', url }]);
  });

  it("posts the host's URL from setParquetWasmUrl, resolved against the page", async () => {
    (await config()).setParquetWasmUrl('static/parquet-0f1e.wasm');
    const { createParquetWorker } = await load();
    createParquetWorker();
    expect(FakeWorker.created[0].posted).toEqual([
      { type: 'init-wasm', url: 'https://host.test/app/static/parquet-0f1e.wasm' },
    ]);
  });

  it('fails a pending call and every later one, by name, when the worker script cannot load', async () => {
    const { createParquetWorker } = await load();
    const remote = createParquetWorker();
    const worker = FakeWorker.created[0];
    const pending = remote.clearCache();
    worker.emit('error');
    await expect(pending).rejects.toThrow(ENGINE);
    await expect(pending).rejects.toThrow('worker script could not load');
    const posts = worker.posted.length;
    await expect(remote.readParquet(new ArrayBuffer(1))).rejects.toThrow(ENGINE);
    expect(worker.posted).toHaveLength(posts); // nothing sent to a failed worker
  });

  it('keeps a worker whose handler threw after it started', async () => {
    const { createParquetWorker } = await load();
    const remote = createParquetWorker();
    const worker = FakeWorker.created[0];
    worker.started();
    worker.emit('error');
    void remote.clearCache();
    expect(worker.posted.at(-1)).toMatchObject({ type: 'APPLY', path: ['clearCache'] });
  });

  it('fails calls when the worker reports that the WASM could not load', async () => {
    const { createParquetWorker } = await load();
    const remote = createParquetWorker();
    const worker = FakeWorker.created[0];
    worker.started();
    const pending = remote.clearCache();
    worker.emit('message', {
      type: 'parquet-wasm',
      ok: false,
      message: 'PARQUET_ENGINE_UNAVAILABLE: the Parquet reader could not be loaded (HTTP 404)',
    });
    await expect(pending).rejects.toThrow(
      'PARQUET_ENGINE_UNAVAILABLE: the Parquet reader could not be loaded (HTTP 404)',
    );
  });

  it('fails calls on a message that cannot be read', async () => {
    const { createParquetWorker } = await load();
    const remote = createParquetWorker();
    const pending = remote.clearCache();
    FakeWorker.created[0].emit('messageerror');
    await expect(pending).rejects.toThrow(/PARQUET_ENGINE_UNAVAILABLE: .*could not be read/);
  });

  it('names a worker the browser refuses to construct', async () => {
    FakeWorker.throwOnCreate = new DOMException('blocked by CSP', 'SecurityError');
    const { createParquetImageWorker, terminateWorker } = await load();
    const { remote, raw, failed } = createParquetImageWorker();
    expect(raw).toBeNull();
    await expect(failed).rejects.toThrow(/could not start: SecurityError: blocked by CSP/);
    await expect(remote.init()).rejects.toThrow(ENGINE);
    expect(() => terminateWorker(remote as never)).not.toThrow();
  });

  it('terminates the worker behind a remote', async () => {
    const { createParquetWorker, terminateWorker } = await load();
    const remote = createParquetWorker();
    terminateWorker(remote as never);
    expect(FakeWorker.created[0].terminated).toBe(true);
  });

  describe('prewarming', () => {
    it('starts one worker that the next loader adopts', async () => {
      const { prewarmParquetWorker, createParquetWorker } = await load();
      prewarmParquetWorker();
      prewarmParquetWorker();
      expect(FakeWorker.created).toHaveLength(1);
      createParquetWorker();
      expect(FakeWorker.created).toHaveLength(1);
      createParquetWorker();
      expect(FakeWorker.created).toHaveLength(2);
    });

    it('terminates a prewarmed worker no loader adopted', async () => {
      vi.useFakeTimers();
      const { prewarmParquetWorker, SPARE_WORKER_IDLE_MS } = await load();
      prewarmParquetWorker();
      vi.advanceTimersByTime(SPARE_WORKER_IDLE_MS - 1);
      expect(FakeWorker.created[0].terminated).toBe(false);
      vi.advanceTimersByTime(1);
      expect(FakeWorker.created[0].terminated).toBe(true);
    });

    it('keeps an adopted worker past the idle time', async () => {
      vi.useFakeTimers();
      const { prewarmParquetWorker, createParquetWorker, SPARE_WORKER_IDLE_MS } = await load();
      prewarmParquetWorker();
      createParquetWorker();
      vi.advanceTimersByTime(SPARE_WORKER_IDLE_MS * 2);
      expect(FakeWorker.created[0].terminated).toBe(false);
    });

    it('drops a prewarmed worker that failed; the loader starts its own', async () => {
      const { prewarmParquetWorker, createParquetWorker } = await load();
      prewarmParquetWorker();
      FakeWorker.created[0].emit('error');
      await Promise.resolve();
      expect(FakeWorker.created[0].terminated).toBe(true);
      createParquetWorker();
      expect(FakeWorker.created).toHaveLength(2);
    });

    it('does not hand over a worker given another WASM URL', async () => {
      const { prewarmParquetWorker, createParquetWorker } = await load();
      prewarmParquetWorker();
      (await config()).setParquetWasmUrl('https://cdn.test/p.wasm');
      createParquetWorker();
      expect(FakeWorker.created).toHaveLength(2);
      expect(FakeWorker.created[0].terminated).toBe(true);
      expect(FakeWorker.created[1].posted[0]).toEqual({
        type: 'init-wasm',
        url: 'https://cdn.test/p.wasm',
      });
    });

    it('export workers never take the prewarmed one', async () => {
      const { prewarmParquetWorker, createParquetWorker } = await load();
      prewarmParquetWorker();
      createParquetWorker({ adoptPrewarmed: false });
      expect(FakeWorker.created).toHaveLength(2);
      expect(FakeWorker.created[0].terminated).toBe(false);
    });

    it('does nothing without Worker support (server rendering)', async () => {
      vi.stubGlobal('Worker', undefined);
      const { prewarmParquetWorker } = await load();
      expect(() => prewarmParquetWorker()).not.toThrow();
    });
  });
});
