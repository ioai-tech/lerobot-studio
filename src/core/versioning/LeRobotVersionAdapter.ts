import type { LeRobotInfo, EpisodeMetadata } from '../types/lerobot';
import type { DataSource } from '../datasource/types';
import type {
  EpisodeDataPathResult,
  EpisodeVideoPathResult,
  MetadataLoadingHelpers,
} from './types';
import { convertArrowValue, normalizeTaskDisplay } from './arrowUtils';
import { tableFromIPC } from 'apache-arrow';
import {
  parseSubtaskTableFromRows,
  SUBTASK_LABEL_COLUMN_CANDIDATES,
  SUBTASKS_PARQUET_PATH,
  type SubtaskTable,
} from '../subtask';

/**
 * Abstract base for LeRobot codebase version adapters.
 * Subclasses must implement version and the data/metadata methods. Path resolution and
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
   * Load optional subtask index → label mapping from meta/subtasks.parquet.
   * Missing file returns an empty table; that is a valid unannotated dataset.
   */
  async loadSubtasks(
    _dataSource: DataSource,
    helpers: MetadataLoadingHelpers,
  ): Promise<SubtaskTable> {
    try {
      const ipcBytes = await helpers.readParquetToIPC(SUBTASKS_PARQUET_PATH);
      const table = tableFromIPC(ipcBytes);
      const schemaNames = new Set(table.schema.fields.map((field) => field.name));
      const labelColumnName = SUBTASK_LABEL_COLUMN_CANDIDATES.find((name) => schemaNames.has(name));
      const labelVector = labelColumnName ? table.getChild(labelColumnName) : null;
      const indexVector = table.getChild('subtask_index');
      const rows = Array.from({ length: table.numRows }, (_, row) => ({
        subtaskIndex: indexVector ? convertArrowValue(indexVector.get(row)) : row,
        label: labelVector ? convertArrowValue(labelVector.get(row)) : '',
      }));
      return parseSubtaskTableFromRows(rows);
    } catch (error) {
      if (error instanceof RangeError) throw error;
      return {};
    }
  }

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
