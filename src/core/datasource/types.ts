/** A phase reported while a data source reads or prepares content. */
export type LoadingPhase = 'download' | 'index' | 'gunzip' | 'read';

/** Progress reported by a data-source operation. */
export interface ProgressInfo {
  /** Current operation phase. */
  phase: LoadingPhase;
  /** Bytes or logical units processed so far. */
  loaded?: number;
  /** Total bytes or logical units when known. */
  total?: number;
  /** Optional human-readable detail. */
  message?: string;
}

/** Receives data-source progress updates. */
export type ProgressHandler = (info: ProgressInfo) => void;

/** Options of a ranged read. */
export interface RangeReadOptions {
  /** Aborts the read (the viewer cancels the load of an episode the user already left). */
  signal?: AbortSignal;
}

/** Browser-readable storage abstraction consumed by the viewer. */
export interface DataSource {
  /** Return whether a logical dataset path exists. */
  exists(path: string): Promise<boolean>;
  /** Read a UTF-8 text file. */
  readText(path: string, onProgress?: ProgressHandler): Promise<string>;
  /** Read a file as bytes. */
  readBytes(path: string, onProgress?: ProgressHandler): Promise<Uint8Array>;
  /** Return an object URL or remote URL suitable for browser media APIs. */
  getObjectUrl(path: string, mimeType?: string, onProgress?: ProgressHandler): Promise<string>;
  /** Release object URLs, handles, caches, and other source-owned resources. */
  clear(): void | Promise<void>;
  /**
   * Lists logical dataset paths when the backing source has an index.
   * Adapters use this to load every v3 metadata shard rather than guessing a
   * contiguous chunk/file sequence.
   */
  listPaths?(): Promise<string[]>;
  /** Invalidate object/blob URL for a logical path when the implementation supports it. */
  invalidateObjectUrl?(path: string): void | Promise<void>;
  /** File size in bytes without reading the file. Implemented together with `readRange`. */
  getSize?(path: string): Promise<number>;
  /**
   * Read `length` bytes starting at `offset`. Lets the parquet reader fetch only the footer, the row
   * groups of one episode and the requested column chunks instead of the whole file.
   */
  readRange?(
    path: string,
    offset: number,
    length: number,
    options?: RangeReadOptions,
  ): Promise<Uint8Array>;
  /**
   * When the URL `getObjectUrl` returns for this path stops working (epoch milliseconds), or
   * null/undefined when it does not expire. Video panels renew such URLs shortly before this time
   * and swap the new one in without interrupting playback.
   */
  getUrlExpiry?(path: string): number | null | undefined;
  /**
   * Episode metadata rows (the columns of `meta/episodes/*.parquet`) supplied by the source instead
   * of episode parquet files: a set of episodes assembled from several recordings. In these rows
   * `dataset_from_index` / `dataset_to_index` are rows of the episode's own data file.
   */
  readEpisodeRows?(): Promise<Array<Record<string, unknown>>>;
}
