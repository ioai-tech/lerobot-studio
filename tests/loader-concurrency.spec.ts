import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from '@ioai/lerobot-studio-platform';

const { mockWorker, terminateWorkerMock } = vi.hoisted(() => ({
  mockWorker: {
    readParquet: vi.fn(async () => new Uint8Array()),
    readNumericColumns: vi.fn(async () => ({})),
    readFeatureData: vi.fn(async () => ({})),
    clearCache: vi.fn(async () => undefined),
  },
  terminateWorkerMock: vi.fn(),
}));

vi.mock('../packages/platform/src/workers/workerManager.ts', () => ({
  createParquetWorker: () => mockWorker,
  terminateWorker: terminateWorkerMock,
}));

import { LeRobotDataLoader } from '@ioai/lerobot-studio-platform';

describe('LeRobotDataLoader concurrency', () => {
  it('deduplicates concurrent getFileUrl requests for same path', async () => {
    const getObjectUrl = vi.fn(
      async (path: string) =>
        await new Promise<string>((resolve) => {
          setTimeout(() => resolve(`blob:${path}`), 10);
        }),
    );

    const source: DataSource = {
      exists: async () => true,
      readText: async () => '',
      readBytes: async () => new Uint8Array(),
      getObjectUrl,
      clear: async () => undefined,
    };

    const loader = new LeRobotDataLoader(source);
    const path = 'videos/chunk-000/observation.images.cam_high/episode_000000.mp4';

    const [url1, url2, url3] = await Promise.all([
      loader.getFileUrl(path),
      loader.getFileUrl(path),
      loader.getFileUrl(path),
    ]);

    expect(url1).toBe(`blob:${path}`);
    expect(url2).toBe(url1);
    expect(url3).toBe(url1);
    expect(getObjectUrl).toHaveBeenCalledTimes(1);

    const url4 = await loader.getFileUrl(path);
    expect(url4).toBe(url1);
    expect(getObjectUrl).toHaveBeenCalledTimes(1);

    await loader.dispose();
    expect(mockWorker.clearCache).toHaveBeenCalled();
    expect(terminateWorkerMock).toHaveBeenCalled();
  });
});
