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
  /** Invalidate object/blob URL for a logical path when the implementation supports it. */
  invalidateObjectUrl?(path: string): void | Promise<void>;
}
