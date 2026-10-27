import type { FrameData, LeRobotFeature, LeRobotInfo } from '../types/lerobot';
import type { EpisodeMetadata } from '../types/lerobot';
import type { NumericalColumnMap } from '../loader/types';
import { getBudgetedChartFeatureKeys } from '../panels/chartFeatureSelection';

function isNumericalFeature(feature: LeRobotFeature | undefined): boolean {
  if (!feature?.dtype) return false;
  const dtype = feature.dtype.toLowerCase();
  return (
    dtype.includes('float') ||
    dtype.includes('int') ||
    dtype.includes('double') ||
    dtype.includes('decimal')
  );
}

function isChartFeatureKey(featureKey: string): boolean {
  return (
    featureKey === 'observation' ||
    featureKey.startsWith('observation.') ||
    featureKey === 'action' ||
    featureKey.startsWith('action.')
  );
}

/**
 * Timeline plus the numeric chart features within the default chart budget. Wider datasets load
 * their other features when a chart selects them (`ensureChartColumns`).
 */
export function getEagerEpisodeColumns(info: LeRobotInfo): string[] {
  const chartKeys = Object.entries(info.features)
    .filter(([key, feature]) => isChartFeatureKey(key) && isNumericalFeature(feature))
    .map(([key]) => key);
  return Array.from(new Set(['timestamp', ...getBudgetedChartFeatureKeys(info, chartKeys)]));
}

export function buildPlaybackFrames(columnData: NumericalColumnMap, fps: number): FrameData[] {
  const timestampColumn = columnData.timestamp;
  const timestamps = timestampColumn
    ? Array.from(timestampColumn.values.slice(0, timestampColumn.rows), (value, index) =>
        Number.isFinite(value) ? value : index / Math.max(1, fps),
      )
    : [];

  const frameCount =
    timestamps.length ||
    Object.values(columnData).reduce((max, column) => {
      return Math.max(max, column.rows);
    }, 0);

  return Array.from({ length: frameCount }, (_, index) => ({
    frame_index: index,
    timestamp: timestamps[index] ?? index / Math.max(1, fps),
  }));
}

export function getFirstAvailableEpisodeIndex(
  episodes: EpisodeMetadata[],
  deletedEpisodes: Set<number>,
): number | null {
  const first = episodes.find((episode) => !deletedEpisodes.has(episode.episode_index));
  return first?.episode_index ?? null;
}
