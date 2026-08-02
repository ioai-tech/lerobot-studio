import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from '@/platform';

const { mockWorker, createParquetImageWorker, terminateWorker } = vi.hoisted(() => {
  const mockWorker = {
    init: vi.fn(async () => {}),
    loadFile: vi.fn(async (_filePath: string, _buffer: ArrayBuffer, columns?: string[]) => ({
      columns: columns ?? [],
      numRows: 32,
    })),
    getImageCached: vi.fn(async () => new Uint8Array([255, 216, 255]).buffer),
    clearCache: vi.fn(async () => {}),
  };
  return {
    mockWorker,
    createParquetImageWorker: vi.fn(() => ({
      remote: mockWorker,
      raw: { addEventListener: vi.fn(), removeEventListener: vi.fn(), postMessage: vi.fn() },
    })),
    terminateWorker: vi.fn(),
  };
});

vi.mock('../src/platform/workers/workerManager.ts', () => ({
  createParquetImageWorker,
  terminateWorker,
}));

import { createParquetImageService, ParquetImageService } from '@/platform';

describe('ParquetImageService concurrency', () => {
  beforeEach(async () => {
    mockWorker.init.mockClear();
    mockWorker.loadFile.mockClear();
    mockWorker.getImageCached.mockClear();
    mockWorker.clearCache.mockClear();
    createParquetImageWorker.mockClear();
    terminateWorker.mockClear();

    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${Math.random()}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await ParquetImageService.clearAllCache();
    const dataSource: DataSource = {
      exists: async () => true,
      readText: async () => '',
      readBytes: async () => new Uint8Array([1, 2, 3]),
      getObjectUrl: async () => 'blob:source',
      clear: () => {},
    };
    ParquetImageService.setDataSource(dataSource);
  });

  it('loads union columns for concurrent same-file requests', async () => {
    const filePath = 'data/chunk-000/episode_000000.parquet';
    await Promise.all([
      ParquetImageService.getImageUrl(filePath, 'observation.images.cam_high', 0),
      ParquetImageService.getImageUrl(filePath, 'observation.images.cam_right_wrist', 0),
    ]);

    expect(mockWorker.loadFile).toHaveBeenCalledTimes(2);
    expect(mockWorker.loadFile).toHaveBeenNthCalledWith(1, filePath, expect.any(ArrayBuffer), [
      'observation.images.cam_high',
    ]);
    expect(mockWorker.loadFile).toHaveBeenNthCalledWith(2, filePath, expect.any(ArrayBuffer), [
      'observation.images.cam_high',
      'observation.images.cam_right_wrist',
    ]);
    expect(mockWorker.getImageCached).toHaveBeenCalledTimes(2);
  });

  it('serializes clearAllCache against in-flight image requests', async () => {
    mockWorker.getImageCached.mockImplementationOnce(
      async () =>
        await new Promise<ArrayBuffer>((resolve) => {
          setTimeout(() => resolve(new Uint8Array([255, 216, 255]).buffer), 10);
        }),
    );

    const filePath = 'data/chunk-000/episode_000000.parquet';
    const imagePromise = ParquetImageService.getImageUrl(
      filePath,
      'observation.images.cam_high',
      1,
    );
    const clearPromise = ParquetImageService.clearAllCache();

    await expect(Promise.all([imagePromise, clearPromise])).resolves.toHaveLength(2);
    expect(mockWorker.clearCache).toHaveBeenCalled();
  });

  it('deduplicates same cache key requests with single-flight', async () => {
    mockWorker.getImageCached.mockImplementationOnce(
      async () =>
        await new Promise<ArrayBuffer>((resolve) => {
          setTimeout(() => resolve(new Uint8Array([255, 216, 255]).buffer), 15);
        }),
    );

    const filePath = 'data/chunk-000/episode_000000.parquet';
    const [url1, url2] = await Promise.all([
      ParquetImageService.getImageUrl(filePath, 'observation.images.cam_high', 2),
      ParquetImageService.getImageUrl(filePath, 'observation.images.cam_high', 2),
    ]);
    expect(url1).toBe(url2);
    expect(mockWorker.getImageCached).toHaveBeenCalledTimes(1);
  });

  it('creates independent workers and caches for each provider-owned service', async () => {
    const dataSource: DataSource = {
      exists: async () => true,
      readText: async () => '',
      readBytes: async () => new Uint8Array([1, 2, 3]),
      getObjectUrl: async () => 'blob:source',
      clear: () => {},
    };
    const first = createParquetImageService();
    const second = createParquetImageService();
    first.setDataSource(dataSource);
    second.setDataSource(dataSource);

    expect(first).not.toBe(second);
    await Promise.all([
      first.getImageUrl('data/chunk-000/episode_000000.parquet', 'camera', 0),
      second.getImageUrl('data/chunk-000/episode_000000.parquet', 'camera', 0),
    ]);

    expect(createParquetImageWorker).toHaveBeenCalledTimes(2);
    await Promise.all([first.dispose(), second.dispose()]);
    expect(terminateWorker).toHaveBeenCalledTimes(2);
  });
});
