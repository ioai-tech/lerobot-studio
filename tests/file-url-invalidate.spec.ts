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
import { sanitizeMp4ForBrowserSeek } from '../src/platform/utils/mp4SeekSanitizer';
import { buildBrokenAvcMp4 } from './helpers/brokenAvcMp4';

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

  it('serves a sanitized blob URL when the MP4 sync table marks P-frames as keyframes', async () => {
    const broken = buildBrokenAvcMp4();
    const sanitized = sanitizeMp4ForBrowserSeek(broken);
    expect(sanitized).not.toBe(broken);

    const created: string[] = [];
    const source: DataSource = {
      exists: async () => true,
      readText: async () => '',
      readBytes: async () => broken,
      getObjectUrl: async () => {
        const url = URL.createObjectURL(new Blob([broken], { type: 'video/mp4' }));
        created.push(url);
        return url;
      },
      clear: async () => undefined,
      invalidateObjectUrl: async () => {
        const url = created.shift();
        if (url) URL.revokeObjectURL(url);
      },
    };

    const loader = new LeRobotDataLoader(source);
    const playable = await loader.getFileUrl(
      'videos/observation.images.head/chunk-000/file-000.mp4',
    );
    expect(playable).not.toBe(created[0]);
    expect(playable.startsWith('blob:')).toBe(true);

    await loader.dispose();
  });
});
