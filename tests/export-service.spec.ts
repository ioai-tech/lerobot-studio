import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  writeMetadata: vi.fn(),
  exportDataFiles: vi.fn(),
  exportVideosByTarget: vi.fn(),
  exportImageFeaturesAsVideo: vi.fn(),
  getImageFeatureKeys: vi.fn(),
  rewriteFeaturesForImageToVideo: vi.fn(),
  computeDatasetStats: vi.fn(),
  computeSplits: vi.fn(),
  splitsIndicesToInfoSplits: vi.fn(),
}));

vi.mock('../packages/platform/src/export/MetadataExporter', () => ({
  writeMetadata: mocks.writeMetadata,
}));
vi.mock('../packages/platform/src/export/DataProcessor', () => ({
  exportDataFiles: mocks.exportDataFiles,
}));
vi.mock('../packages/platform/src/export/VideoExporter', () => ({
  exportVideosByTarget: mocks.exportVideosByTarget,
}));
vi.mock('../packages/platform/src/export/ImageVideoExporter', () => ({
  exportImageFeaturesAsVideo: mocks.exportImageFeaturesAsVideo,
  getImageFeatureKeys: mocks.getImageFeatureKeys,
  rewriteFeaturesForImageToVideo: mocks.rewriteFeaturesForImageToVideo,
}));
vi.mock('@ioai/lerobot-studio-core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ioai/lerobot-studio-core')>();
  return {
    ...original,
    computeDatasetStats: mocks.computeDatasetStats,
    computeSplits: mocks.computeSplits,
    splitsIndicesToInfoSplits: mocks.splitsIndicesToInfoSplits,
  };
});

import { ExportService } from '../packages/platform/src/export/ExportService';

const info = { features: { camera: { dtype: 'image' } } } as any;
const episodes = [{ episode_index: 0, length: 2, tasks: ['pick'] }] as any;

function adapter() {
  return { clear: vi.fn(), finalize: vi.fn() } as any;
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
    await new ExportService({} as any, target).exportMetadataOnly(
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
    mocks.getImageFeatureKeys.mockReturnValue(['camera']);
    mocks.exportImageFeaturesAsVideo.mockResolvedValue({
      videoOffsets: new Map([[0, { camera: { from: 0, to: 2 } }]]),
    });
    mocks.exportVideosByTarget.mockResolvedValue(new Map([[0, { wrist: { from: 0, to: 2 } }]]));
    const progress = vi.fn();

    await new ExportService({} as any, target).exportWithData(
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
    expect(mocks.writeMetadata).toHaveBeenCalledWith(
      info,
      episodes,
      { 0: 'pick' },
      'v3.0',
      target,
      expect.any(Function),
      expect.any(Map),
      undefined,
      { stats: true },
      { train: '0:1' },
    );
    expect(mocks.exportDataFiles).toHaveBeenCalledWith(
      expect.anything(),
      info,
      episodes,
      'v3.0',
      target,
      expect.any(Function),
      undefined,
      { excludeColumns: new Set(['camera']) },
    );
    expect(target.finalize).toHaveBeenCalledWith('directory');
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ percent: 100 }));
  });

  it('does not mutate an adapter when cancellation precedes export', async () => {
    const target = adapter();
    const controller = new AbortController();
    controller.abort();

    await expect(
      new ExportService({} as any, target).exportWithData(
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
});
