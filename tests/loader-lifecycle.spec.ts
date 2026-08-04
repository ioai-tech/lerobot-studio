import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from '@/platform';

const mocks = vi.hoisted(() => ({
  worker: {
    readParquet: vi.fn(),
    readNumericColumns: vi.fn(),
    readFeatureData: vi.fn(),
    clearCache: vi.fn(),
  },
  terminateWorker: vi.fn(),
  validate: vi.fn(),
  loadEpisodes: vi.fn(),
  loadTasks: vi.fn(),
  getEpisodeDataPath: vi.fn(),
  getEpisodeVideoPath: vi.fn(),
  getAdapterForVersion: vi.fn(),
  getValidatorForVersion: vi.fn(),
}));

vi.mock('../src/platform/workers/workerManager.ts', () => ({
  createParquetWorker: () => mocks.worker,
  terminateWorker: mocks.terminateWorker,
}));

vi.mock('@/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core')>();
  return {
    ...original,
    getAdapterForVersion: mocks.getAdapterForVersion,
    getValidatorForVersion: mocks.getValidatorForVersion,
  };
});

import { LeRobotDataLoader } from '../src/platform/services/LeRobotDataLoader';

function source(overrides: Partial<DataSource> = {}): DataSource {
  return {
    exists: vi.fn(async () => true),
    readText: vi.fn(async () => JSON.stringify({ codebase_version: 'v3.0', features: {} })),
    readBytes: vi.fn(async () => new Uint8Array()),
    getObjectUrl: vi.fn(async (path: string) => `blob:${path}`),
    clear: vi.fn(async () => undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.worker.clearCache.mockResolvedValue(undefined);
  mocks.validate.mockResolvedValue({ hasError: false, items: [] });
  mocks.loadEpisodes.mockResolvedValue([]);
  mocks.loadTasks.mockResolvedValue({});
  mocks.getValidatorForVersion.mockReturnValue({ validate: mocks.validate });
  mocks.getAdapterForVersion.mockReturnValue({
    loadEpisodes: mocks.loadEpisodes,
    loadTasks: mocks.loadTasks,
    getEpisodeDataPath: mocks.getEpisodeDataPath,
    getEpisodeVideoPath: mocks.getEpisodeVideoPath,
  });
});

describe('LeRobotDataLoader version handling', () => {
  it('initializes a supported v3 dataset and resolves scalar episode task labels', async () => {
    const episodes = [
      { episode_index: 0, length: 1, tasks: [], task_index: 2 },
      { episode_index: 1, length: 1, tasks: ['keep'], task_index: undefined },
      { episode_index: 2, length: 1, tasks: [], task_index: Number.NaN },
    ];
    mocks.loadEpisodes.mockResolvedValueOnce(episodes);
    mocks.loadTasks.mockResolvedValueOnce({ 2: 'pick' });
    const loader = new LeRobotDataLoader(source());

    await expect(loader.initialize()).resolves.toMatchObject({ codebase_version: 'v3.0' });
    expect(loader.getVersionCapability()).toMatchObject({
      status: 'supported',
      normalizedVersion: 'v3.0',
      adapterVersion: 'v3.0',
    });
    expect(loader.getEpisodes()).toEqual([
      expect.objectContaining({ tasks: ['pick'] }),
      expect.objectContaining({ tasks: ['keep'] }),
      expect.objectContaining({ tasks: [] }),
    ]);
    expect(loader.getTasks()).toEqual({ 2: 'pick' });
  });

  it('accepts a read-only future v3 version while preserving its capability', async () => {
    const dataSource = source({
      readText: vi.fn(async () => JSON.stringify({ codebase_version: 'v3.1', features: {} })),
    });
    const loader = new LeRobotDataLoader(dataSource);

    await loader.initialize();
    expect(loader.getVersionCapability()).toMatchObject({
      status: 'read-only',
      normalizedVersion: 'v3.1',
      adapterVersion: 'v3.0',
    });
    expect(mocks.getAdapterForVersion).toHaveBeenCalledWith('v3.1');
  });

  it.each([
    ['not json', /failed to parse meta\/info\.json/i],
    [JSON.stringify({ codebase_version: 'v1.0' }), /unsupported lerobot codebase_version/i],
  ])('rejects invalid metadata %s and retains a validation report', async (contents, message) => {
    const loader = new LeRobotDataLoader(source({ readText: vi.fn(async () => contents) }));

    await expect(loader.initialize()).rejects.toThrow(message);
    expect(mocks.getValidatorForVersion).toHaveBeenCalledWith('v3.0');
    expect(loader.getValidationReport()).toEqual({ hasError: false, items: [] });
  });

  it('surfaces validator errors without loading episodes or tasks', async () => {
    mocks.validate.mockResolvedValueOnce({
      hasError: true,
      items: [
        { level: 'warning', message: 'warning' },
        { level: 'error', message: 'missing tasks' },
      ],
    });
    const loader = new LeRobotDataLoader(source());

    await expect(loader.initialize()).rejects.toThrow(/missing tasks/);
    expect(mocks.loadEpisodes).not.toHaveBeenCalled();
    expect(mocks.loadTasks).not.toHaveBeenCalled();
  });

  it('normalizes missing-file and non-Error initialization failures', async () => {
    const missing = new DOMException('missing', 'NotFoundError');
    await expect(
      new LeRobotDataLoader(
        source({ readText: vi.fn(async () => Promise.reject(missing)) }),
      ).initialize(),
    ).rejects.toThrow(/meta\/info\.json not found/i);

    await expect(
      new LeRobotDataLoader(
        source({ readText: vi.fn(async () => Promise.reject('offline')) }),
      ).initialize(),
    ).rejects.toThrow(/failed to initialize: offline/i);
  });
});

describe('LeRobotDataLoader resource release', () => {
  it('disposes worker and data source exactly once', async () => {
    const clear = vi.fn(async () => undefined);
    const loader = new LeRobotDataLoader(source({ clear }));

    await loader.dispose();
    await loader.dispose();

    expect(mocks.worker.clearCache).toHaveBeenCalledOnce();
    expect(mocks.terminateWorker).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
  });

  it('continues cleanup when worker and data-source release fail', async () => {
    mocks.worker.clearCache.mockRejectedValueOnce(new Error('worker gone'));
    const clear = vi.fn(async () => Promise.reject(new Error('source gone')));
    const loader = new LeRobotDataLoader(source({ clear }));

    await expect(loader.dispose()).resolves.toBeUndefined();
    expect(mocks.terminateWorker).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
  });

  it('continues data-source cleanup when worker termination itself fails', async () => {
    mocks.terminateWorker.mockImplementationOnce(() => {
      throw new Error('termination failed');
    });
    const clear = vi.fn(async () => undefined);
    const loader = new LeRobotDataLoader(source({ clear }));

    await expect(loader.dispose()).resolves.toBeUndefined();
    expect(mocks.worker.clearCache).toHaveBeenCalledOnce();
    expect(mocks.terminateWorker).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
  });

  it('releases parsed caches independently and tolerates worker cleanup failure', async () => {
    const loader = new LeRobotDataLoader(source());
    mocks.worker.clearCache.mockRejectedValueOnce(new Error('worker gone'));

    await expect(loader.releaseParsedCaches()).resolves.toBeUndefined();
    expect(mocks.worker.clearCache).toHaveBeenCalledOnce();
    expect(loader.isFileBytesCached('data/file.parquet')).toBe(false);
  });

  it('invalidates source object URLs and forwards uncached byte reads', async () => {
    const invalidateObjectUrl = vi.fn(async () => undefined);
    const readBytes = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const loader = new LeRobotDataLoader(source({ invalidateObjectUrl, readBytes }));

    await expect(loader.readFileBytes('data/file')).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await loader.invalidateFileUrl('video/file');

    expect(readBytes).toHaveBeenCalledWith('data/file');
    expect(invalidateObjectUrl).toHaveBeenCalledWith('video/file');
  });

  it('cleans failed URL loads so a later request can retry', async () => {
    const getObjectUrl = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce('blob:retry');
    const loader = new LeRobotDataLoader(source({ getObjectUrl }));

    await expect(loader.getFileUrl('video/file')).rejects.toThrow(/temporary failure/);
    await expect(loader.getFileUrl('video/file')).resolves.toBe('blob:retry');
    expect(getObjectUrl).toHaveBeenCalledTimes(2);
  });
});

describe('LeRobotDataLoader access guards and delegation', () => {
  it('rejects data reads before initialization and handles empty column requests', async () => {
    const loader = new LeRobotDataLoader(source());

    await expect(loader.loadAllNumericalData(0, ['timestamp'])).rejects.toThrow(/not initialized/i);
    await expect(loader.loadFeatureData(0, ['timestamp'])).rejects.toThrow(/not initialized/i);
    await expect(loader.loadEpisodeData(0)).rejects.toThrow(/not initialized/i);
    expect(loader.getEpisodeDataPath(0)).toBeNull();
    expect(loader.getEpisodeVideoPath(0, 'camera')).toBeNull();

    await loader.initialize();
    await expect(loader.loadAllNumericalData(0, [])).resolves.toEqual({});
    await expect(loader.loadFeatureData(0, [])).resolves.toEqual({});
  });

  it('delegates initialized data and video path resolution', async () => {
    mocks.getEpisodeDataPath.mockReturnValueOnce({
      path: 'data/chunk.parquet',
      startRow: 2,
      endRow: 4,
    });
    mocks.getEpisodeVideoPath.mockReturnValueOnce({
      path: 'videos/camera.mp4',
      from: 1,
      to: 2,
    });
    const loader = new LeRobotDataLoader(source());
    await loader.initialize();

    expect(loader.getEpisodeDataPath(0)).toEqual({
      path: 'data/chunk.parquet',
      startRow: 2,
      endRow: 4,
    });
    expect(loader.getEpisodeVideoPath(0, 'camera')).toEqual({
      path: 'videos/camera.mp4',
      from: 1,
      to: 2,
    });
    expect(mocks.getEpisodeVideoPath).toHaveBeenCalledWith(
      expect.objectContaining({ codebase_version: 'v3.0' }),
      [],
      0,
      'camera',
    );
  });
});
