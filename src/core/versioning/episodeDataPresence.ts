import type { DataSource } from '../datasource/types';
import type { LeRobotInfo } from '../types/lerobot';
import { formatLeRobotPath } from './pathTemplate';

const CHUNK_SIZE_DEFAULT = 1000;
const DEFAULT_DATA_PATH = 'data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet';

export interface EpisodeDataPresence<T = { episode_index: number }> {
  present: T[];
  missing: T[];
}

export function resolveV2EpisodeDataPath(info: LeRobotInfo, episodeIndex: number): string {
  const chunksSize = (info as { chunks_size?: number }).chunks_size ?? CHUNK_SIZE_DEFAULT;
  const chunkIdx = Math.floor(episodeIndex / chunksSize);
  return formatLeRobotPath(info.data_path || DEFAULT_DATA_PATH, {
    episode_chunk: chunkIdx,
    episode_index: episodeIndex,
  });
}

/**
 * Split v2 episodes by whether their parquet file exists on the data source.
 * Used by the v2 adapter (clamp the playable list) and validator (health report).
 */
export async function findExistingV2Episodes<T extends { episode_index: number }>(
  dataSource: DataSource,
  info: LeRobotInfo,
  episodes: T[],
): Promise<EpisodeDataPresence<T>> {
  const present: T[] = [];
  const missing: T[] = [];

  for (const episode of episodes) {
    const path = resolveV2EpisodeDataPath(info, episode.episode_index);
    try {
      if (await dataSource.exists(path)) {
        present.push(episode);
      } else {
        missing.push(episode);
      }
    } catch {
      missing.push(episode);
    }
  }

  return { present, missing };
}

/** Keep the meta list when no parquet is on disk (metadata-only fixtures / remote stubs). */
export function clampV2EpisodesToExisting<T>(presence: EpisodeDataPresence<T>): T[] {
  if (presence.present.length === 0) return [...presence.present, ...presence.missing];
  return presence.present;
}
