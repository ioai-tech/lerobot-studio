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
  /**
   * Invalidate the object/blob URL for a logical path when the implementation
   * supports it. Remote sources treat this as "this URL failed" and refresh
   * their signed URLs (one refresh shared by concurrent callers).
   */
  invalidateObjectUrl?(path: string): void | Promise<void>;
  /**
   * Dataset `episode_index` values the host wants shown. When set, the viewer
   * lists only these episodes, reads only their data and media files, and the
   * health report marks the other episodes' files as not evaluated.
   */
  readonly episodeScope?: readonly number[];
  /**
   * Subscribe to URL replacements (for example after signed URLs were
   * refreshed). The listener receives the logical paths whose URL changed;
   * media consumers call `getObjectUrl` again and swap their source while
   * keeping position and play state. Returns an unsubscribe function.
   */
  subscribeUrlChanges?(listener: (paths: readonly string[]) => void): () => void;
}
