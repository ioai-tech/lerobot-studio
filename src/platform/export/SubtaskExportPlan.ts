import type { EpisodeMetadata, LeRobotInfo } from '@/core';
import {
  SUBTASK_INDEX_FEATURE,
  SUBTASK_INDEX_FEATURE_KEY,
  assertExportCoverage,
  assignNewSubtaskLabels,
  collectSubtaskLabels,
  frameIndicesFromSegments,
  resolveSubtaskIndexFeatureKey,
  segmentsFromFrameIndices,
  type SubtaskSegment,
  type SubtaskTable,
} from '@/core';
import type { LeRobotDataLoader } from '../services/LeRobotDataLoader';
import type { TargetVersion } from '@/core';

export interface ExportSubtaskPlan {
  table: SubtaskTable;
  framesBySourceEpisode: Map<number, number[]>;
}

export async function buildExportSubtaskPlan(options: {
  dataLoader: LeRobotDataLoader;
  info: LeRobotInfo;
  episodes: EpisodeMetadata[];
  overlay: ReadonlyMap<number, SubtaskSegment[]>;
  sourceTable: SubtaskTable;
  targetVersion: TargetVersion;
}): Promise<ExportSubtaskPlan | null> {
  if (options.targetVersion !== 'v3.0') return null;

  const hasSourceTable = Object.keys(options.sourceTable).length > 0;
  const hasOverlay = options.overlay.size > 0;
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

  const framesBySourceEpisode = new Map<number, number[]>();
  for (const episode of options.episodes) {
    const segments = episodeSegments.get(episode.episode_index) ?? [];
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
