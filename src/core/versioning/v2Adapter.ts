import type { LeRobotInfo, EpisodeMetadata } from '../types/lerobot';
import type { DataSource } from '../datasource/types';
import type {
  EpisodeDataPathResult,
  EpisodeVideoPathResult,
  MetadataLoadingHelpers,
} from './types';
import { LeRobotVersionAdapter } from './LeRobotVersionAdapter';
import { formatLeRobotPath } from './pathTemplate';

const CHUNK_SIZE_DEFAULT = 1000;
const DEFAULT_DATA_PATH = 'data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet';
const DEFAULT_VIDEO_PATH =
  'videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4';

/**
 * Normalize episode.tasks to string[] for v2 episodes.jsonl compatibility.
 * Handles: missing, string (plain or JSON array string), array.
 */
function normalizeEpisodeTasks(tasks: unknown): string[] {
  if (tasks == null) return [];
  if (typeof tasks === 'string') {
    const trimmed = tasks.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const arr = JSON.parse(trimmed) as unknown[];
        return Array.isArray(arr)
          ? arr.map((x) => (x != null ? String(x) : '')).filter(Boolean)
          : [tasks];
      } catch {
        return [tasks];
      }
    }
    return [tasks];
  }
  if (Array.isArray(tasks)) {
    return tasks.map((x) => (x != null ? String(x) : '')).filter(Boolean);
  }
  return [];
}

/**
 * Adapter for LeRobot codebase v2.1 and newer read-only v2 compatibility.
 * - Episodes: meta/episodes.jsonl
 * - Tasks: meta/tasks.jsonl
 * - Data: one Parquet file per episode, data/chunk-XXX/episode_YYYYYY.parquet, full file = one episode
 * - Video: one mp4 per episode per key, videos/chunk-XXX/{featureKey}/episode_YYYYYY.mp4
 */
export class V2Adapter extends LeRobotVersionAdapter {
  get version(): string {
    return 'v2.1';
  }

  getEpisodeDataPath(
    info: LeRobotInfo,
    _episodes: EpisodeMetadata[],
    episodeIndex: number,
  ): EpisodeDataPathResult | null {
    const chunksSize = (info as { chunks_size?: number }).chunks_size ?? CHUNK_SIZE_DEFAULT;
    const chunkIdx = Math.floor(episodeIndex / chunksSize);
    const path = formatLeRobotPath(info.data_path || DEFAULT_DATA_PATH, {
      episode_chunk: chunkIdx,
      episode_index: episodeIndex,
    });
    return {
      path,
      startRow: 0,
      endRow: 0, // 0 means "full table" — loader will use table.numRows
    };
  }

  getEpisodeVideoPath(
    info: LeRobotInfo,
    _episodes: EpisodeMetadata[],
    episodeIndex: number,
    featureKey: string,
  ): EpisodeVideoPathResult | null {
    const chunksSize = (info as { chunks_size?: number }).chunks_size ?? CHUNK_SIZE_DEFAULT;
    const chunkIdx = Math.floor(episodeIndex / chunksSize);
    const path = formatLeRobotPath(info.video_path || DEFAULT_VIDEO_PATH, {
      episode_chunk: chunkIdx,
      episode_index: episodeIndex,
      video_key: featureKey,
    });
    return { path, fromSec: 0, toSec: 0 };
  }

  async loadEpisodes(
    dataSource: DataSource,
    _helpers: MetadataLoadingHelpers,
    _info?: LeRobotInfo,
  ): Promise<EpisodeMetadata[]> {
    void _helpers;
    void _info;
    try {
      const text = await dataSource.readText('meta/episodes.jsonl');
      const episodes = text
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line) as EpisodeMetadata;
          } catch (e) {
            console.error('Failed to parse episode line', line, e);
            return null;
          }
        })
        .filter((e): e is EpisodeMetadata => e !== null);
      episodes.forEach((ep) => {
        ep.tasks = normalizeEpisodeTasks(ep.tasks);
      });
      try {
        const statsText = await dataSource.readText('meta/episodes_stats.jsonl');
        const statsByEpisode = new Map<number, Record<string, unknown>>();
        for (const line of statsText.split('\n').filter((item) => item.trim())) {
          const row = JSON.parse(line) as {
            episode_index: number;
            stats?: Record<string, Record<string, unknown>>;
          };
          const flattened: Record<string, unknown> = {};
          for (const [featureKey, featureStats] of Object.entries(row.stats ?? {})) {
            for (const [statKey, value] of Object.entries(featureStats)) {
              flattened[`stats/${featureKey}/${statKey}`] = value;
            }
          }
          statsByEpisode.set(row.episode_index, flattened);
        }
        episodes.forEach((episode) => {
          Object.assign(episode, statsByEpisode.get(episode.episode_index));
        });
      } catch {
        // v2.1 permits datasets without legacy per-episode stats. Training
        // export will reject missing visual stats explicitly when required.
      }
      return episodes;
    } catch (e) {
      console.warn('Failed to load episodes.jsonl', e);
      return [];
    }
  }

  async loadTasks(
    dataSource: DataSource,
    _helpers: MetadataLoadingHelpers,
  ): Promise<Record<number, string>> {
    void _helpers;
    try {
      const text = await dataSource.readText('meta/tasks.jsonl');
      return LeRobotVersionAdapter.parseTasksFromJsonl(text);
    } catch (e) {
      console.warn('Failed to load tasks.jsonl', e);
      return {};
    }
  }
}

export const v2Adapter = new V2Adapter();
