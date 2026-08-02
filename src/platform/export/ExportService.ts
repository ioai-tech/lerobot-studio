import type { LeRobotDataLoader } from '../services/LeRobotDataLoader';
import type { LeRobotInfo, EpisodeMetadata } from '@/core';
import type { ExportAdapter } from '@/core';
import type { ExportOptions, TargetVersion, ExportProgress, EpisodeVideoOffsets } from '@/core';
import { writeMetadata } from './MetadataExporter';
import { exportDataFiles } from './DataProcessor';
import { exportVideosByTarget } from './VideoExporter';
import {
  exportImageFeaturesAsVideo,
  getImageFeatureKeys,
  rewriteFeaturesForImageToVideo,
} from './ImageVideoExporter';
import { computeDatasetStats, type DatasetStats } from '@/core';
import { computeSplits, splitsIndicesToInfoSplits } from '@/core';

export class ExportService {
  private dataLoader: LeRobotDataLoader;
  private adapter: ExportAdapter;
  constructor(dataLoader: LeRobotDataLoader, adapter: ExportAdapter) {
    this.dataLoader = dataLoader;
    this.adapter = adapter;
  }

  async exportMetadataOnly(
    info: LeRobotInfo,
    episodes: EpisodeMetadata[],
    tasks: Record<number, string>,
    options: Pick<ExportOptions, 'format' | 'targetVersion' | 'onProgress' | 'splitsConfig'>,
  ): Promise<void> {
    this.adapter.clear();
    const targetVersion = options.targetVersion as TargetVersion | undefined;
    const splits =
      options.splitsConfig && episodes.length > 0
        ? splitsIndicesToInfoSplits(computeSplits(episodes, options.splitsConfig))
        : undefined;
    await writeMetadata(
      info,
      episodes,
      tasks,
      targetVersion,
      this.adapter,
      options.onProgress,
      undefined,
      undefined,
      undefined,
      splits,
    );
    options.onProgress?.({
      phase: 'packaging',
      current: 1,
      total: 1,
      message: 'Packaging...',
      cancelable: false,
    });
    await this.adapter.finalize(options.format);
    options.onProgress?.({
      phase: 'complete',
      current: 1,
      total: 1,
      message: 'Export complete.',
      cancelable: false,
    });
  }

  async exportWithData(
    info: LeRobotInfo,
    episodes: EpisodeMetadata[],
    tasks: Record<number, string>,
    options: Pick<
      ExportOptions,
      | 'format'
      | 'targetVersion'
      | 'onProgress'
      | 'includeData'
      | 'includeVideos'
      | 'signal'
      | 'splitsConfig'
    >,
  ): Promise<void> {
    const onProg = options.onProgress;
    const signal = options.signal;

    const throwIfAborted = () => {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    };

    // Progress ranges: videos (v3 or v2.1) 5–50%, metadata 50–55%, data 55–88%, packaging 88–100%
    const wrap = (low: number, high: number) => (p: ExportProgress) => {
      throwIfAborted();
      const ratio = p.total > 0 ? Math.min(1, Math.max(0, p.current / p.total)) : 0;
      onProg?.({ ...p, percent: low + (high - low) * ratio });
    };

    const reportPhaseStart = (percent: number, message: string, phase: ExportProgress['phase']) => {
      onProg?.({ phase, current: 0, total: 1, message, cancelable: true, percent });
    };

    throwIfAborted();
    this.adapter.clear();
    const targetVersion = (options.targetVersion ?? 'v2.1') as TargetVersion;
    let episodesForMeta = episodes;
    let videoOffsets: EpisodeVideoOffsets | null = null;
    const videoOptions = { signal };

    // If source has dtype: 'image' features, re-encode them into MP4 videos
    // and rewrite the exported `info.features[key].dtype` to 'video'.
    // The image columns are stripped from the exported parquet so the output
    // dataset does not duplicate the image payload.
    const imageFeatureKeys = options.includeVideos ? getImageFeatureKeys(info) : [];
    let infoForExport = info;
    const columnsToExclude = new Set<string>(imageFeatureKeys);
    let imageOffsets: EpisodeVideoOffsets | null = null;

    if (imageFeatureKeys.length > 0) {
      reportPhaseStart(3, 'Encoding image features as MP4...', 'videos');
      throwIfAborted();
      const { videoOffsets: offsets } = await exportImageFeaturesAsVideo(
        this.dataLoader,
        info,
        episodes,
        targetVersion,
        this.adapter,
        onProg ? wrap(3, 30) : undefined,
        { signal },
      );
      imageOffsets = offsets;
      infoForExport = rewriteFeaturesForImageToVideo(info, imageFeatureKeys);
    }

    if (options.includeVideos && targetVersion === 'v3.0') {
      reportPhaseStart(30, 'Preparing video export (v3)...', 'videos');
      throwIfAborted();
      videoOffsets = await exportVideosByTarget(
        this.dataLoader,
        info,
        episodes,
        'v3.0',
        this.adapter,
        onProg ? wrap(30, 50) : undefined,
        videoOptions,
      );
      if (imageOffsets && imageOffsets.size > 0) {
        if (!videoOffsets) videoOffsets = new Map();
        for (const [epIdx, entry] of imageOffsets.entries()) {
          if (!videoOffsets.has(epIdx)) videoOffsets.set(epIdx, {});
          Object.assign(videoOffsets.get(epIdx)!, entry);
        }
      }
      episodesForMeta = episodes;
    } else if (options.includeVideos && targetVersion === 'v2.1') {
      reportPhaseStart(30, 'Preparing video export (v2.1)...', 'videos');
      throwIfAborted();
      await exportVideosByTarget(
        this.dataLoader,
        info,
        episodes,
        'v2.1',
        this.adapter,
        onProg ? wrap(30, 50) : undefined,
        videoOptions,
      );
    }

    throwIfAborted();

    let stats: DatasetStats | undefined;
    if (options.includeData && episodesForMeta.length > 0) {
      reportPhaseStart(50, 'Computing dataset stats...', 'metadata');
      throwIfAborted();
      stats = await computeDatasetStats(this.dataLoader, info, episodesForMeta, {
        signal,
        onProgress: (current, total) => {
          const ratio = total > 0 ? current / total : 0;
          onProg?.({
            phase: 'metadata',
            current,
            total,
            message: 'Computing stats...',
            cancelable: true,
            percent: 50 + ratio * 3,
          });
        },
      });
      throwIfAborted();
    }

    let splits: Record<string, string> | undefined;
    if (options.splitsConfig && episodesForMeta.length > 0) {
      const indices = computeSplits(episodesForMeta, options.splitsConfig);
      splits = splitsIndicesToInfoSplits(indices);
    }

    reportPhaseStart(53, 'Writing metadata...', 'metadata');
    throwIfAborted();
    await writeMetadata(
      infoForExport,
      episodesForMeta,
      tasks,
      targetVersion,
      this.adapter,
      onProg ? wrap(53, 55) : undefined,
      videoOffsets ?? undefined,
      signal,
      stats,
      splits,
    );
    throwIfAborted();
    if (options.includeData) {
      reportPhaseStart(55, 'Exporting data (Parquet)...', 'data');
      throwIfAborted();
      await exportDataFiles(
        this.dataLoader,
        infoForExport,
        episodesForMeta,
        targetVersion,
        this.adapter,
        onProg ? wrap(55, 88) : undefined,
        signal,
        columnsToExclude.size > 0 ? { excludeColumns: columnsToExclude } : undefined,
      );
    }
    throwIfAborted();
    onProg?.({
      phase: 'packaging',
      current: 1,
      total: 1,
      message: 'Packaging...',
      cancelable: false,
      percent: 88,
    });
    await this.adapter.finalize(options.format);
    onProg?.({
      phase: 'complete',
      current: 1,
      total: 1,
      message: 'Export complete.',
      cancelable: false,
      percent: 100,
    });
  }
}
