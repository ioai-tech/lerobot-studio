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
  /** v3→v3: copy shared MP4s once by default. True physically trims unused footage (slower). */
  compactVideos?: boolean;
  /**
   * Segments keyed by source episode_index: each becomes one exported episode.
   * Missing or empty entries keep the whole episode.
   */
  segments?: ReadonlyMap<number, readonly ExportSegment[]>;
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
  /**
   * With `includeSubtasks`, label frames no subtask covers as `unlabeled`
   * instead of refusing the export.
   */
  fillSubtaskGaps?: boolean;
  /** Source dataset subtask table from meta/subtasks.parquet. */
  sourceSubtasks?: SubtaskTable;
}

/** One kept range of a source episode, exported as its own episode. */
export interface ExportSegment {
  id: string;
  /** Inclusive source-episode frames. */
  startFrame: number;
  endFrame: number;
  /** Task text; `null` keeps the source episode's task. */
  task: string | null;
  /** Subtasks in source-episode frames, inside the range. */
  subtasks: SubtaskSegment[];
  /** Extra `meta/episodes` columns (host field values). */
  columns: Record<string, string | string[] | null>;
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
