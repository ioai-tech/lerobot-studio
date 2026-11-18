import type { EpisodeMetadata, LeRobotInfo } from '@/core';
import {
  SUBTASK_INDEX_FEATURE,
  trimSubtaskSegments,
  type EpisodeTrimRange,
  SUBTASK_INDEX_FEATURE_KEY,
  assertExportCoverage,
  assignNewSubtaskLabels,
  computeSubtaskCoverage,
  collectSubtaskLabels,
  frameIndicesFromSegments,
  resolveSubtaskIndexFeatureKey,
  segmentsFromFrameIndices,
  type SubtaskSegment,
  type SubtaskTable,
} from '@/core';
import type { ExportDataLoader } from './SegmentExportPlan';
import type { TargetVersion } from '@/core';

/** Label written for frames no subtask covers when the export fills gaps. */
export const UNLABELED_SUBTASK = 'unlabeled';

export interface ExportSubtaskPlan {
  table: SubtaskTable;
  framesBySourceEpisode: Map<number, number[]>;
}

export async function buildExportSubtaskPlan(options: {
  dataLoader: ExportDataLoader;
  info: LeRobotInfo;
  episodes: EpisodeMetadata[];
  /** Subtasks (source frames) of segment episodes; other episodes read the source parquet. */
  overlay: ReadonlyMap<number, SubtaskSegment[]>;
  sourceTable: SubtaskTable;
  targetVersion: TargetVersion;
  trimRanges?: ReadonlyMap<number, EpisodeTrimRange>;
  /** Label uncovered frames `unlabeled` instead of refusing. */
  fillGaps?: boolean;
}): Promise<ExportSubtaskPlan | null> {
  if (options.targetVersion !== 'v3.0') return null;

  const hasSourceTable = Object.keys(options.sourceTable).length > 0;
  const hasOverlay = Array.from(options.overlay.values()).some((list) => list.length > 0);
  const hasFeature = resolveSubtaskIndexFeatureKey(options.info.features) != null;
  if (!hasSourceTable && !hasOverlay && !hasFeature) return null;

  let table: SubtaskTable = { ...options.sourceTable };
  const episodeSegments = new Map<number, SubtaskSegment[]>();
  for (const episode of options.episodes) {
    if (options.overlay.has(episode.episode_index)) {
      episodeSegments.set(episode.episode_index, options.overlay.get(episode.episode_index) ?? []);
      continue;
    }
    const source = options.dataLoader.loadEpisodeSubtaskSource
      ? await options.dataLoader.loadEpisodeSubtaskSource(episode.episode_index)
      : {
          indices: await options.dataLoader.loadEpisodeSubtaskIndices(episode.episode_index),
          table: options.sourceTable,
        };
    table = { ...table, ...source.table };
    episodeSegments.set(episode.episode_index, segmentsFromFrameIndices(source.indices, table));
  }
  table = assignNewSubtaskLabels(table, collectSubtaskLabels(options.overlay.values(), table));
  if (Object.keys(table).length === 0) return null;

  const resolvedSegments = new Map<number, SubtaskSegment[]>();
  let needsUnlabeled = false;
  for (const episode of options.episodes) {
    const sourceSegments = episodeSegments.get(episode.episode_index) ?? [];
    const range = options.trimRanges?.get(episode.episode_index);
    let segments = range ? trimSubtaskSegments(sourceSegments, range) : sourceSegments;
    if (options.fillGaps) {
      const { gaps } = computeSubtaskCoverage(episode.length, segments);
      if (gaps.length > 0) {
        needsUnlabeled = true;
        segments = [...segments, ...gaps.map((gap) => ({ ...gap, label: UNLABELED_SUBTASK }))];
      }
    }
    resolvedSegments.set(episode.episode_index, segments);
  }
  if (needsUnlabeled) table = assignNewSubtaskLabels(table, [UNLABELED_SUBTASK]);

  const framesBySourceEpisode = new Map<number, number[]>();
  for (const episode of options.episodes) {
    const segments = resolvedSegments.get(episode.episode_index) ?? [];
    assertExportCoverage(episode.episode_index, episode.length, segments);
    const frames = frameIndicesFromSegments(episode.length, segments, table);
    const resolved = frames.map((value, row) => {
      if (value == null) {
        throw new Error(
          `Cannot export unlabeled subtask at episode ${episode.episode_index} frame ${row}`,
        );
      }
      return value;
    });
    framesBySourceEpisode.set(episode.episode_index, resolved);
  }

  return { table, framesBySourceEpisode };
}

export function applySubtaskFeaturesForExport(
  info: LeRobotInfo,
  targetVersion: TargetVersion,
  plan: ExportSubtaskPlan | null,
): { info: LeRobotInfo; dropSubtaskColumn: boolean } {
  const features = { ...info.features };
  if (targetVersion !== 'v3.0' || !plan) {
    delete features[SUBTASK_INDEX_FEATURE_KEY];
    return {
      info: { ...info, features },
      dropSubtaskColumn: true,
    };
  }
  features[SUBTASK_INDEX_FEATURE_KEY] = { ...SUBTASK_INDEX_FEATURE };
  return {
    info: { ...info, features },
    dropSubtaskColumn: false,
  };
}
