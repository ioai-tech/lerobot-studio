import type { LeRobotInfo, EpisodeMetadata } from '../types/lerobot';
import type { SplitConfig } from '../analysis/SplitService';
import type { SubtaskSegment, SubtaskTable } from '../subtask';

export type ExportFormat = 'zip' | 'directory';

export type TargetVersion = 'v2.1' | 'v3.0';

export interface ExportProgress {
  phase: 'metadata' | 'data' | 'videos' | 'packaging' | 'complete';
  current: number;
  total: number;
  message: string;
  cancelable: boolean;
  /** Global 0–100 export progress when provided by ExportService. */
  percent?: number;
}

export interface ExportManifest {
  info: LeRobotInfo;
  episodes: EpisodeMetadata[];
  tasks: Record<number, string>;
  deletedEpisodes: Set<number>;
  modifiedEpisodes: Map<number, Partial<EpisodeMetadata>>;
}

export interface ExportOptions {
  format: ExportFormat;
  targetVersion?: TargetVersion;
  includeVideos: boolean;
  includeData: boolean;
  /**
   * UI passes true only when "Include subtasks" is checked.
   * `false` omits subtask files. Omitted keeps auto-include for existing callers.
   */
  includeSubtasks?: boolean;
  onProgress?: (progress: ExportProgress) => void;
  /** When aborted, export will throw DOMException with name 'AbortError'. */
  signal?: AbortSignal;
  /** Optional split config for reproducible train/val/test; written to v3 info.splits or meta/splits.json (v2). */
  splitsConfig?: SplitConfig;
  /** In-memory subtask segments keyed by source episode_index. Missing keys fall back to source parquet. */
  subtaskOverlay?: ReadonlyMap<number, SubtaskSegment[]>;
  /** Source dataset subtask table from meta/subtasks.parquet. */
  sourceSubtasks?: SubtaskTable;
}

export interface V3DataEpisodeLocation {
  chunk_index: number;
  file_index: number;
  dataset_from_index: number;
  dataset_to_index: number;
}

/** Actual v3 data shards produced by the exporter, keyed by source episode index. */
export interface V3DataLayout {
  episodes: Map<number, V3DataEpisodeLocation>;
  total_chunks: number;
  total_files: number;
}

/** Per-episode video offsets for v3, keyed by source episode index and video feature. */
export type EpisodeVideoOffsets = Map<
  number,
  Record<
    string,
    { chunk_index: number; file_index: number; from_timestamp: number; to_timestamp: number }
  >
>;
