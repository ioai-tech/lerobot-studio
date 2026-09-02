import type { LeRobotDataLoader } from '../services/LeRobotDataLoader';
import type { LeRobotInfo, EpisodeMetadata } from '@/core';
import type { ExportAdapter } from '@/core';
import type {
  ExportOptions,
  TargetVersion,
  ExportProgress,
  EpisodeVideoOffsets,
  V3DataLayout,
} from '@/core';
import { validateMetadataForExport, writeMetadata } from './MetadataExporter';
import { exportDataFiles } from './DataProcessor';
import { exportVideosByTarget } from './VideoExporter';
import {
  exportImageFeaturesAsVideo,
  getImageFeatureKeys,
  rewriteFeaturesForImageToVideo,
} from './ImageVideoExporter';
import {
  classifyLeRobotVersion,
  computeDatasetStats,
  isSupportedLeRobotVersion,
  SUBTASK_INDEX_FEATURE_KEY,
  type DatasetStats,
} from '@/core';
import { computeSplits, splitsIndicesToInfoSplits } from '@/core';
import { buildExportTaskPlan, resolveExportTaskIndex } from './TaskPlan';
import { applySubtaskFeaturesForExport, buildExportSubtaskPlan } from './SubtaskExportPlan';

export class ExportService {
  private dataLoader: LeRobotDataLoader;
  private adapter: ExportAdapter;
  constructor(dataLoader: LeRobotDataLoader, adapter: ExportAdapter) {
    this.dataLoader = dataLoader;
    this.adapter = adapter;
  }

  private assertExportAllowed(info: LeRobotInfo, targetVersion?: string): void {
    const infoCapability = classifyLeRobotVersion(info.codebase_version);
    const loaderCapability = this.dataLoader.getVersionCapability();
    if (loaderCapability.status !== 'supported') {
      throw new Error(
        `Export is disabled for loaded LeRobot ${String(loaderCapability.normalizedVersion)} (${loaderCapability.status})`,
      );
    }
    if (infoCapability.status !== 'supported') {
      throw new Error(
        `Export is disabled for LeRobot ${String(info.codebase_version)} (${infoCapability.status})`,
      );
    }
    if (loaderCapability.normalizedVersion !== infoCapability.normalizedVersion) {
      throw new Error(
        `Export info version ${String(infoCapability.normalizedVersion)} does not match loaded version ${String(loaderCapability.normalizedVersion)}`,
      );
    }
    if (targetVersion !== undefined && !isSupportedLeRobotVersion(targetVersion)) {
      throw new Error(`Unsupported LeRobot export target: ${targetVersion}`);
    }
  }

  async exportMetadataOnly(
    info: LeRobotInfo,
    episodes: EpisodeMetadata[],
    tasks: Record<number, string>,
    options: Pick<ExportOptions, 'format' | 'targetVersion' | 'onProgress' | 'splitsConfig'>,
  ): Promise<void> {
    const targetVersion = options.targetVersion as TargetVersion | undefined;
    this.assertExportAllowed(info, targetVersion);
    this.adapter.clear();
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
      | 'includeSubtasks'
      | 'signal'
      | 'splitsConfig'
      | 'subtaskOverlay'
      | 'sourceSubtasks'
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
    this.assertExportAllowed(info, options.targetVersion);
    const targetVersion = (options.targetVersion ?? 'v2.1') as TargetVersion;
    const episodesForMeta = episodes;
    let videoOffsets: EpisodeVideoOffsets | null = null;
    let dataLayout: V3DataLayout | undefined;
    const videoOptions = { signal };

    // If source has dtype: 'image' features, re-encode them into MP4 videos
    // and rewrite the exported `info.features[key].dtype` to 'video'.
    // The image columns are stripped from the exported parquet so the output
    // dataset does not duplicate the image payload.
    const imageFeatureKeys = options.includeVideos ? getImageFeatureKeys(info) : [];
    let infoForExport =
      imageFeatureKeys.length > 0 ? rewriteFeaturesForImageToVideo(info, imageFeatureKeys) : info;
    const columnsToExclude = new Set<string>(imageFeatureKeys);

    const subtaskPlan =
      options.includeData && options.includeSubtasks !== false
        ? await buildExportSubtaskPlan({
            dataLoader: this.dataLoader,
            info: infoForExport,
            episodes: episodesForMeta,
            overlay: options.subtaskOverlay ?? new Map(),
            sourceTable: options.sourceSubtasks ?? this.dataLoader.getSubtasks?.() ?? {},
            targetVersion,
          })
        : null;
    const subtaskFeatures = applySubtaskFeaturesForExport(
      infoForExport,
      targetVersion,
      subtaskPlan,
    );
    infoForExport = subtaskFeatures.info;
    if (subtaskFeatures.dropSubtaskColumn) {
      columnsToExclude.add(SUBTASK_INDEX_FEATURE_KEY);
    }
    let imageOffsets: EpisodeVideoOffsets | null = null;

    const taskPlan = buildExportTaskPlan(episodesForMeta, tasks);
    const splits =
      options.splitsConfig && episodesForMeta.length > 0
        ? splitsIndicesToInfoSplits(computeSplits(episodesForMeta, options.splitsConfig))
        : undefined;
    let stats: DatasetStats | undefined;
    if (options.includeData && episodesForMeta.length > 0) {
      reportPhaseStart(1, 'Validating training statistics...', 'metadata');
      stats = await computeDatasetStats(this.dataLoader, infoForExport, episodesForMeta, {
        signal,
        resolveNumericRow: (featureKey, context) => {
          if (featureKey === 'index') return context.outputGlobalIndex;
          if (featureKey === 'episode_index') return context.outputEpisodeIndex;
          if (featureKey === SUBTASK_INDEX_FEATURE_KEY) {
            const frames = subtaskPlan?.framesBySourceEpisode.get(context.episode.episode_index);
            const value = frames?.[context.rowIndex];
            if (value == null) {
              throw new Error(
                `Cannot map frame subtask_index for exported episode ${context.outputEpisodeIndex}`,
              );
            }
            return value;
          }
          if (featureKey !== 'task_index') return undefined;
          const sourceTaskIndex = context.sourceValues[0];
          if (!Number.isSafeInteger(sourceTaskIndex)) {
            throw new Error(
              `Cannot map non-integer frame task_index ${String(sourceTaskIndex)} ` +
                `for exported episode ${context.outputEpisodeIndex}`,
            );
          }
          const targetTaskIndex = resolveExportTaskIndex(
            taskPlan,
            context.outputEpisodeIndex,
            sourceTaskIndex,
          );
          if (targetTaskIndex === undefined) {
            throw new Error(
              `Cannot map frame task_index ${sourceTaskIndex} ` +
                `for exported episode ${context.outputEpisodeIndex}`,
            );
          }
          return targetTaskIndex;
        },
        onProgress: (current, total) => {
          const ratio = total > 0 ? current / total : 0;
          onProg?.({
            phase: 'metadata',
            current,
            total,
            message: 'Validating training statistics...',
            cancelable: true,
            percent: 1 + ratio * 2,
          });
        },
      });
      throwIfAborted();
    }
    validateMetadataForExport(infoForExport, episodesForMeta, targetVersion, splits);
    throwIfAborted();

    // All training and metadata validation has succeeded. Mutating the target
    // is now safe: subsequent failures are I/O/encoding failures, not bad input.
    this.adapter.clear();

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

    if (options.includeData) {
      reportPhaseStart(53, 'Exporting data (Parquet)...', 'data');
      throwIfAborted();
      dataLayout = await exportDataFiles(
        this.dataLoader,
        infoForExport,
        episodesForMeta,
        targetVersion,
        this.adapter,
        onProg ? wrap(53, 86) : undefined,
        signal,
        {
          ...(columnsToExclude.size > 0 ? { excludeColumns: columnsToExclude } : {}),
          tasks,
          taskPlan,
          ...(subtaskPlan ? { subtaskPlan } : {}),
        },
      );
    }
    throwIfAborted();
    reportPhaseStart(86, 'Writing metadata...', 'metadata');
    await writeMetadata(
      infoForExport,
      episodesForMeta,
      tasks,
      targetVersion,
      this.adapter,
      onProg ? wrap(86, 88) : undefined,
      videoOffsets ?? undefined,
      signal,
      stats,
      splits,
      dataLayout,
      subtaskPlan?.table,
    );
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
