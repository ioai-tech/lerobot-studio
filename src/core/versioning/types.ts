/**
 * Version-agnostic result types used by LeRobotVersionAdapter.
 */

/** Parquet path and row range for one episode's data. */
export interface EpisodeDataPathResult {
  path: string;
  startRow: number;
  endRow: number;
}

/** Video file path and optional time range (seconds) for one episode's video feature. */
export interface EpisodeVideoPathResult {
  path: string;
  fromSec?: number;
  toSec?: number;
}

/**
 * Helpers for loading that require loader infrastructure (e.g. Parquet via worker).
 * Passed by LeRobotDataLoader to the adapter when loading metadata.
 */
export interface MetadataLoadingHelpers {
  /** Read a Parquet file and return its Arrow IPC representation. */
  readParquetToIPC(path: string, columns?: string[]): Promise<Uint8Array>;
}
