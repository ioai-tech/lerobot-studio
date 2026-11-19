import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from '@/core';

/** A stand-in Worker that never answers a call: only its events tell the page anything. */
class SilentWorker extends EventTarget {
  static created: SilentWorker[] = [];
  constructor() {
    super();
    SilentWorker.created.push(this);
  }
  postMessage() {}
  terminate() {}
  emit(type: string, data?: unknown) {
    const event = new Event(type) as Event & { data?: unknown };
    event.data = data;
    this.dispatchEvent(event);
  }
}

const dataSource: DataSource = {
  exists: async () => true,
  readText: async () => '',
  readBytes: async () => new Uint8Array([1, 2, 3]),
  getObjectUrl: async () => 'blob:source',
  clear: () => {},
};

// Transform the platform once up front; each test imports it fresh.
beforeAll(async () => {
  await import('@/platform');
  vi.resetModules();
}, 60_000);

beforeEach(() => {
  SilentWorker.created = [];
  vi.stubGlobal('Worker', SilentWorker);
  vi.stubGlobal('location', { href: 'https://host.test/viewer' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const failures: Array<[string, (worker: SilentWorker) => void]> = [
  ['its script is blocked', (worker) => worker.emit('error')],
  [
    'a message from it cannot be read',
    (worker) => {
      worker.emit('message', { type: 'parquet-worker-started' });
      worker.emit('messageerror');
    },
  ],
];

describe.each(failures)('ParquetImageService, once its worker failed because %s', (_, fail) => {
  it('fails the pending preload, then every later call at once, without posting to the worker', async () => {
    const { createParquetImageService } = await import('@/platform');
    const service = createParquetImageService();
    service.setDataSource(dataSource);

    const first = service.preloadEpisode('camera', 0, 10, 'episode-0');
    await vi.waitFor(() => expect(SilentWorker.created).toHaveLength(1));
    fail(SilentWorker.created[0]);
    await expect(first).rejects.toThrow(/^PARQUET_ENGINE_UNAVAILABLE: /);

    const post = vi.spyOn(SilentWorker.created[0], 'postMessage');
    // Each must settle on its own: a hang fails the test by timeout.
    await expect(service.getFrameBitmap('camera', 0, 0)).resolves.toBeNull();
    await expect(service.preloadEpisode('camera', 0, 10, 'episode-1')).rejects.toThrow(
      /^PARQUET_ENGINE_UNAVAILABLE: /,
    );
    await expect(service.getImageUrl('data/e.parquet', 'camera', 0)).rejects.toThrow(
      /^PARQUET_ENGINE_UNAVAILABLE: /,
    );
    expect(post).not.toHaveBeenCalled();
    expect(SilentWorker.created).toHaveLength(1);
    await service.dispose();
  }, 10_000);
});
