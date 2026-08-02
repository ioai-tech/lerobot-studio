import type { LeRobotInfo, EpisodeMetadata } from '../types/lerobot';
import type { DataSource } from '../datasource/types';
import type {
  EpisodeDataPathResult,
  EpisodeVideoPathResult,
  MetadataLoadingHelpers,
} from './types';
import { normalizeTaskDisplay } from './arrowUtils';

/**
 * Abstract base for LeRobot codebase version adapters (v2.0, v2.1, v3.0, etc.).
 * Subclasses must implement version and the four methods. Path resolution and
 * metadata loading are delegated to the adapter so DataLoader, panels, and
 * export do not branch on version.
 */
export abstract class LeRobotVersionAdapter {
  abstract get version(): string;

  /**
   * Resolve the data Parquet path and row range for an episode.
   * Used by DataLoader and ImagePanel (parquet image path + episodeStartRow).
   */
  abstract getEpisodeDataPath(
    info: LeRobotInfo,
    episodes: EpisodeMetadata[],
    episodeIndex: number,
  ): EpisodeDataPathResult | null;

  /**
   * Resolve the video file path and optional time range for an episode's video feature.
   * Used by VideoPanel and export.
   */
  abstract getEpisodeVideoPath(
    info: LeRobotInfo,
    episodes: EpisodeMetadata[],
    episodeIndex: number,
    featureKey: string,
  ): EpisodeVideoPathResult | null;

  /**
   * Load episode metadata from the data source.
   * For v2: reads meta/episodes.jsonl. For v3: reads meta/episodes/.../file.parquet.
   * The optional `info` parameter allows adapters to use dataset-level metadata
   * (e.g. chunks_size) when determining how many files to load.
   */
  abstract loadEpisodes(
    dataSource: DataSource,
    helpers: MetadataLoadingHelpers,
    info?: LeRobotInfo,
  ): Promise<EpisodeMetadata[]>;

  /**
   * Load tasks (task_index -> task string) from the data source.
   */
  abstract loadTasks(
    dataSource: DataSource,
    helpers: MetadataLoadingHelpers,
  ): Promise<Record<number, string>>;

  /**
   * Parse meta/tasks.jsonl content into task_index -> task map. Shared by v2 and v3.
   */
  protected static parseTasksFromJsonl(text: string): Record<number, string> {
    const tasks: Record<number, string> = {};
    text
      .split('\n')
      .filter((line) => line.trim())
      .forEach((line) => {
        try {
          const row = JSON.parse(line) as { task_index: number; task: string };
          const display = normalizeTaskDisplay(row.task);
          tasks[row.task_index] = display;
        } catch (e) {
          console.error('Failed to parse task line', line, e);
        }
      });
    return tasks;
  }
}
