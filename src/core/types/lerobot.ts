/**
 * Common feature metadata structure for all LeRobot versions
 */
export interface LeRobotFeature {
  dtype: 'float32' | 'int64' | 'video' | 'image' | string;
  shape: number[];
  names: string[] | null;
  fps?: number;
  info?: {
    [key: string]: string | number | boolean | null;
  };
}

/**
 * Base information common to all LeRobot codebase versions
 */
export interface BaseLeRobotInfo {
  codebase_version: string;
  robot_type: string;
  total_episodes: number;
  total_frames: number;
  total_tasks: number;
  /** Number of video files; 0 means images may be embedded in parquet. */
  total_videos?: number;
  fps: number;
  data_path: string;
  video_path: string;
  features: Record<string, LeRobotFeature>;
}

/**
 * Specialized Info for v2.x
 */
export interface LeRobotInfoV2 extends BaseLeRobotInfo {
  codebase_version: 'v2.0' | 'v2.1';
  chunks_size: number;
}

/**
 * Specialized Info for v3.x
 */
export interface LeRobotInfoV3 extends BaseLeRobotInfo {
  codebase_version: 'v3.0';
  chunks_size: number;
  splits: Record<string, string>;
  data_files_size_in_mb?: number;
  video_files_size_in_mb?: number;
}

export type LeRobotInfo = LeRobotInfoV2 | LeRobotInfoV3;

/**
 * Base Episode Metadata
 */
export interface BaseEpisodeMetadata {
  episode_index: number;
  length: number;
}

/**
 * Specialized Episode Metadata for v2.x
 */
export interface EpisodeMetadataV2 extends BaseEpisodeMetadata {
  tasks: string[];
  task_index?: number;
}

/**
 * Specialized Episode Metadata for v3.x
 */
export interface EpisodeMetadataV3 extends BaseEpisodeMetadata {
  dataset_from_index: number;
  dataset_to_index: number;
  tasks: string[];
  task_index?: number;
  chunk_index?: number;
  file_index?: number;
  // Specific video keys like observation.images.up
  [key: string]: string | number | string[] | undefined;
}

export type EpisodeMetadata = EpisodeMetadataV2 | EpisodeMetadataV3;

/**
 * Frame Data structure
 * Values can be numbers (scalars), arrays (vectors), or strings/Uint8Arrays (images)
 */
export interface FrameData {
  frame_index: number;
  timestamp: number;
  [key: string]: number | number[] | string | Uint8Array | undefined;
}

export interface TaskMetadata {
  task_index: number;
  task: string;
}

export type PlaybackMode = 'loop' | 'sequential' | 'shuffle';

/**
 * Type Guards
 */
export function isV3Info(info: LeRobotInfo): info is LeRobotInfoV3 {
  return info.codebase_version.startsWith('v3');
}

export function isV2Info(info: LeRobotInfo): info is LeRobotInfoV2 {
  return info.codebase_version.startsWith('v2');
}

export function isV3Metadata(meta: EpisodeMetadata): meta is EpisodeMetadataV3 {
  return 'dataset_from_index' in meta;
}
