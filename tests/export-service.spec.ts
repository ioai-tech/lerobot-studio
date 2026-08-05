import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  writeMetadata: vi.fn(),
  validateMetadataForExport: vi.fn(),
  exportDataFiles: vi.fn(),
  exportVideosByTarget: vi.fn(),
  exportImageFeaturesAsVideo: vi.fn(),
  getImageFeatureKeys: vi.fn(),
  rewriteFeaturesForImageToVideo: vi.fn(),
  computeDatasetStats: vi.fn(),
  computeSplits: vi.fn(),
  splitsIndicesToInfoSplits: vi.fn(),
}));

vi.mock('../src/platform/export/MetadataExporter', () => ({
  writeMetadata: mocks.writeMetadata,
  validateMetadataForExport: mocks.validateMetadataForExport,
}));
vi.mock('../src/platform/export/DataProcessor', () => ({
  exportDataFiles: mocks.exportDataFiles,
}));
vi.mock('../src/platform/export/VideoExporter', () => ({
  exportVideosByTarget: mocks.exportVideosByTarget,
}));
vi.mock('../src/platform/export/ImageVideoExporter', () => ({
  exportImageFeaturesAsVideo: mocks.exportImageFeaturesAsVideo,
  getImageFeatureKeys: mocks.getImageFeatureKeys,
  rewriteFeaturesForImageToVideo: mocks.rewriteFeaturesForImageToVideo,
}));
vi.mock('@/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core')>();
  return {
    ...original,
    computeDatasetStats: mocks.computeDatasetStats,
    computeSplits: mocks.computeSplits,
    splitsIndicesToInfoSplits: mocks.splitsIndicesToInfoSplits,
  };
});

import { ExportService } from '../src/platform/export/ExportService';
import { classifyLeRobotVersion } from '@/core';

const info = { codebase_version: 'v3.0', features: { camera: { dtype: 'image' } } } as any;
const episodes = [{ episode_index: 0, length: 2, tasks: ['pick'] }] as any;

function adapter() {
  return { clear: vi.fn(), finalize: vi.fn() } as any;
}

function loader(version = 'v3.0') {
  return { getVersionCapability: () => classifyLeRobotVersion(version) } as any;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getImageFeatureKeys.mockReturnValue([]);
  mocks.exportVideosByTarget.mockResolvedValue(new Map());
  mocks.exportImageFeaturesAsVideo.mockResolvedValue({ videoOffsets: new Map() });
  mocks.rewriteFeaturesForImageToVideo.mockReturnValue(info);
  mocks.computeDatasetStats.mockResolvedValue({ stats: true });
  mocks.computeSplits.mockReturnValue({ train: [0] });
  mocks.splitsIndicesToInfoSplits.mockReturnValue({ train: '0:1' });
});

describe('ExportService', () => {
  it('exports metadata-only datasets and finalizes the requested format', async () => {
    const target = adapter();
    const progress = vi.fn();
    await new ExportService(loader(), target).exportMetadataOnly(
      info,
      episodes,
      { 0: 'pick' },
      {
        format: 'zip',
        targetVersion: 'v3.0',
        onProgress: progress,
        splitsConfig: { train: 1 } as any,
      },
    );

    expect(target.clear).toHaveBeenCalledOnce();
    expect(mocks.writeMetadata).toHaveBeenCalledOnce();
    expect(target.finalize).toHaveBeenCalledWith('zip');
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'complete' }));
  });

  it('exports image, video, metadata, data and split artifacts in v3', async () => {
    const target = adapter();
    const rewrittenInfo = {
      ...info,
      features: { camera: { dtype: 'video', shape: [3, 64, 64], names: null } },
    };
    mocks.getImageFeatureKeys.mockReturnValue(['camera']);
    mocks.rewriteFeaturesForImageToVideo.mockReturnValue(rewrittenInfo);
    mocks.exportImageFeaturesAsVideo.mockResolvedValue({
      videoOffsets: new Map([[0, { camera: { from: 0, to: 2 } }]]),
    });
    mocks.exportVideosByTarget.mockResolvedValue(new Map([[0, { wrist: { from: 0, to: 2 } }]]));
    const progress = vi.fn();

    await new ExportService(loader(), target).exportWithData(
      info,
      episodes,
      { 0: 'pick' },
      {
        format: 'directory',
        targetVersion: 'v3.0',
        includeData: true,
        includeVideos: true,
        onProgress: progress,
        splitsConfig: { train: 1 } as any,
      },
    );

    expect(mocks.exportImageFeaturesAsVideo).toHaveBeenCalledOnce();
    expect(mocks.exportVideosByTarget).toHaveBeenCalledWith(
      expect.anything(),
      info,
      episodes,
      'v3.0',
      target,
      expect.any(Function),
      { signal: undefined },
    );
    expect(mocks.computeDatasetStats).toHaveBeenCalledOnce();
    expect(mocks.computeDatasetStats).toHaveBeenCalledWith(
      expect.anything(),
      rewrittenInfo,
      episodes,
      expect.objectContaining({ resolveNumericRow: expect.any(Function) }),
    );
    expect(mocks.computeDatasetStats.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.exportImageFeaturesAsVideo.mock.invocationCallOrder[0],
    );
    const metadataArgs = mocks.writeMetadata.mock.calls[0];
    expect(metadataArgs.slice(0, 6)).toEqual([
      rewrittenInfo,
      episodes,
      { 0: 'pick' },
      'v3.0',
      target,
      expect.any(Function),
    ]);
    expect(metadataArgs[6]).toEqual(expect.any(Map));
    expect(metadataArgs[8]).toEqual({ stats: true });
    expect(metadataArgs[9]).toEqual({ train: '0:1' });
    expect(mocks.exportDataFiles).toHaveBeenCalledWith(
      expect.anything(),
      rewrittenInfo,
      episodes,
      'v3.0',
      target,
      expect.any(Function),
      undefined,
      expect.objectContaining({
        excludeColumns: new Set(['camera']),
        tasks: { 0: 'pick' },
        taskPlan: expect.any(Object),
      }),
    );
    expect(target.finalize).toHaveBeenCalledWith('directory');
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ percent: 100 }));
  });

  it('does not mutate an adapter when cancellation precedes export', async () => {
    const target = adapter();
    const controller = new AbortController();
    controller.abort();

    await expect(
      new ExportService(loader(), target).exportWithData(
        info,
        episodes,
        {},
        {
          format: 'zip',
          includeData: false,
          includeVideos: false,
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(target.clear).not.toHaveBeenCalled();
  });

  it('does not mutate an adapter when training stats validation fails', async () => {
    const target = adapter();
    mocks.computeDatasetStats.mockRejectedValueOnce(new Error('missing required visual stats'));

    await expect(
      new ExportService(loader(), target).exportWithData(
        info,
        episodes,
        { 0: 'pick' },
        {
          format: 'directory',
          targetVersion: 'v3.0',
          includeData: true,
          includeVideos: true,
        },
      ),
    ).rejects.toThrow(/missing required visual stats/);

    expect(target.clear).not.toHaveBeenCalled();
    expect(mocks.exportImageFeaturesAsVideo).not.toHaveBeenCalled();
    expect(mocks.exportVideosByTarget).not.toHaveBeenCalled();
    expect(mocks.writeMetadata).not.toHaveBeenCalled();
    expect(mocks.exportDataFiles).not.toHaveBeenCalled();
  });

  it('keeps the target untouched when cancellation happens during preflight statistics', async () => {
    const target = adapter();
    const controller = new AbortController();
    mocks.computeDatasetStats.mockImplementationOnce(async (_loader, _info, _episodes, options) => {
      options.onProgress?.(1, 1);
      controller.abort();
      return { stats: true };
    });

    await expect(
      new ExportService(loader(), target).exportWithData(
        info,
        episodes,
        { 0: 'pick' },
        {
          format: 'zip',
          targetVersion: 'v3.0',
          includeData: true,
          includeVideos: false,
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(target.clear).not.toHaveBeenCalled();
    expect(mocks.validateMetadataForExport).not.toHaveBeenCalled();
    expect(mocks.writeMetadata).not.toHaveBeenCalled();
    expect(target.finalize).not.toHaveBeenCalled();
  });

  it('never finalizes or reports completion after a metadata write failure', async () => {
    const target = adapter();
    const progress = vi.fn();
    mocks.writeMetadata.mockRejectedValueOnce(new Error('disk full'));

    await expect(
      new ExportService(loader(), target).exportWithData(
        info,
        episodes,
        {},
        {
          format: 'directory',
          targetVersion: 'v3.0',
          includeData: false,
          includeVideos: false,
          onProgress: progress,
        },
      ),
    ).rejects.toThrow(/disk full/);

    expect(target.clear).toHaveBeenCalledOnce();
    expect(target.finalize).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'complete' }));
  });

  it('never finalizes after data export failure', async () => {
    const target = adapter();
    mocks.exportDataFiles.mockRejectedValueOnce(new Error('parquet write failed'));

    await expect(
      new ExportService(loader(), target).exportWithData(
        info,
        episodes,
        {},
        {
          format: 'zip',
          targetVersion: 'v3.0',
          includeData: true,
          includeVideos: false,
        },
      ),
    ).rejects.toThrow(/parquet write failed/);

    expect(mocks.writeMetadata).not.toHaveBeenCalled();
    expect(target.finalize).not.toHaveBeenCalled();
  });

  it('maps statistics indices and bounds delegated progress', async () => {
    const target = adapter();
    const progress = vi.fn();
    const multiTaskEpisodes = [{ episode_index: 0, length: 2, tasks: ['pick', 'place'] }] as any;
    let resolveNumericRow: ((featureKey: string, context: any) => number | undefined) | undefined;
    mocks.computeDatasetStats.mockImplementationOnce(async (_loader, _info, _episodes, options) => {
      resolveNumericRow = options.resolveNumericRow;
      options.onProgress?.(1, 0);
      return { stats: true };
    });
    mocks.exportDataFiles.mockImplementationOnce(async (...args) => {
      args[5]?.({ phase: 'data', current: 2, total: 1, message: 'data', cancelable: true });
      return { chunksSize: 1000 };
    });
    mocks.writeMetadata.mockImplementationOnce(async (...args) => {
      args[5]?.({ phase: 'metadata', current: 1, total: 0, message: 'meta', cancelable: true });
    });

    await new ExportService(loader(), target).exportWithData(
      info,
      multiTaskEpisodes,
      { 0: 'pick', 1: 'place' },
      {
        format: 'zip',
        targetVersion: 'v3.0',
        includeData: true,
        includeVideos: false,
        onProgress: progress,
      },
    );

    const context = {
      outputGlobalIndex: 12,
      outputEpisodeIndex: 0,
      sourceValues: [1],
    };
    expect(resolveNumericRow?.('index', context)).toBe(12);
    expect(resolveNumericRow?.('episode_index', context)).toBe(0);
    expect(resolveNumericRow?.('timestamp', context)).toBeUndefined();
    expect(resolveNumericRow?.('task_index', context)).toBe(1);
    expect(() => resolveNumericRow?.('task_index', { ...context, sourceValues: [1.5] })).toThrow(
      /non-integer frame task_index/i,
    );
    expect(() => resolveNumericRow?.('task_index', { ...context, sourceValues: [99] })).toThrow(
      /cannot map frame task_index/i,
    );
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ percent: 86 }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ percent: 1 }));
  });

  it('exports the v2.1 video path without retaining v3 offsets', async () => {
    const target = adapter();
    await new ExportService(loader('v2.1'), target).exportWithData(
      { ...info, codebase_version: 'v2.1' },
      episodes,
      {},
      {
        format: 'zip',
        targetVersion: 'v2.1',
        includeData: false,
        includeVideos: true,
      },
    );

    expect(mocks.exportVideosByTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ codebase_version: 'v2.1' }),
      episodes,
      'v2.1',
      target,
      undefined,
      { signal: undefined },
    );
    expect(mocks.writeMetadata.mock.calls[0].slice(0, 5)).toEqual([
      expect.objectContaining({ codebase_version: 'v2.1' }),
      episodes,
      {},
      'v2.1',
      target,
    ]);
    expect(mocks.writeMetadata.mock.calls[0].slice(5).every((value) => value === undefined)).toBe(
      true,
    );
  });

  it.each([
    ['v3.1', 'read-only'],
    ['v2.0', 'unsupported'],
  ])('blocks exporting source version %s at the service boundary', async (version, status) => {
    const target = adapter();
    await expect(
      new ExportService(loader(version), target).exportWithData(
        { ...info, codebase_version: version },
        episodes,
        { 0: 'pick' },
        {
          format: 'zip',
          targetVersion: 'v3.0',
          includeData: false,
          includeVideos: false,
        },
      ),
    ).rejects.toThrow(status);
    expect(target.clear).not.toHaveBeenCalled();
    expect(target.finalize).not.toHaveBeenCalled();
  });

  it('cannot bypass a read-only loader by forging a supported info version', async () => {
    const target = adapter();
    await expect(
      new ExportService(loader('v3.1'), target).exportWithData(
        info,
        episodes,
        { 0: 'pick' },
        {
          format: 'zip',
          targetVersion: 'v3.0',
          includeData: false,
          includeVideos: false,
        },
      ),
    ).rejects.toThrow(/loaded LeRobot v3\.1 \(read-only\)/);
    expect(target.clear).not.toHaveBeenCalled();
  });

  it('rejects source-info mismatches and unsupported targets before clearing', async () => {
    const mismatchTarget = adapter();
    await expect(
      new ExportService(loader('v2.1'), mismatchTarget).exportMetadataOnly(
        info,
        episodes,
        {},
        {
          format: 'zip',
        },
      ),
    ).rejects.toThrow(/does not match loaded version/i);
    expect(mismatchTarget.clear).not.toHaveBeenCalled();

    const unsupportedTarget = adapter();
    await expect(
      new ExportService(loader(), unsupportedTarget).exportMetadataOnly(
        info,
        episodes,
        {},
        {
          format: 'zip',
          targetVersion: 'v4.0' as any,
        },
      ),
    ).rejects.toThrow(/unsupported lerobot export target/i);
    expect(unsupportedTarget.clear).not.toHaveBeenCalled();
  });
});
