import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from '@/platform';

const { mockWorker, terminateWorkerMock } = vi.hoisted(() => ({
  mockWorker: {
    readParquet: vi.fn(async () => new Uint8Array()),
    readNumericColumns: vi.fn(async () => ({})),
    readFeatureData: vi.fn(async () => ({})),
    clearCache: vi.fn(async () => undefined),
  },
  terminateWorkerMock: vi.fn(),
}));

vi.mock('../src/platform/workers/workerManager.ts', () => ({
  createParquetWorker: () => mockWorker,
  terminateWorker: terminateWorkerMock,
}));

import { LeRobotDataLoader } from '@/platform';

describe('LeRobotDataLoader.invalidateFileUrl', () => {
  it('clears loader cache and forwards to DataSource.invalidateObjectUrl', async () => {
    const created: string[] = [];
    const getObjectUrl = vi.fn(async (_path: string) => {
      const url = URL.createObjectURL(new Blob([], { type: 'video/mp4' }));
      created.push(url);
      return url;
    });
    const invalidateObjectUrl = vi.fn(async (_path: string) => {
      // simulate DataSource releasing the blob for that path
      const u = created.shift();
      if (u) URL.revokeObjectURL(u);
    });

    const source: DataSource = {
      exists: async () => true,
      readText: async () => '',
      readBytes: async () => new Uint8Array(),
      getObjectUrl,
      clear: async () => undefined,
      invalidateObjectUrl,
    };

    const loader = new LeRobotDataLoader(source);
    const path = 'videos/chunk-000/observation.images.cam/episode_000001.mp4';

    const u1 = await loader.getFileUrl(path);
    expect(getObjectUrl).toHaveBeenCalledTimes(1);

    await loader.invalidateFileUrl(path);
    expect(invalidateObjectUrl).toHaveBeenCalledWith(path);

    const u2 = await loader.getFileUrl(path);
    expect(getObjectUrl).toHaveBeenCalledTimes(2);
    expect(u2).not.toBe(u1);

    await loader.dispose();
  });
});
