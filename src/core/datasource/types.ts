export type LoadingPhase = 'download' | 'index' | 'gunzip' | 'read';

export interface ProgressInfo {
  phase: LoadingPhase;
  loaded?: number;
  total?: number;
  message?: string;
}

export type ProgressHandler = (info: ProgressInfo) => void;

export interface DataSource {
  exists(path: string): Promise<boolean>;
  readText(path: string, onProgress?: ProgressHandler): Promise<string>;
  readBytes(path: string, onProgress?: ProgressHandler): Promise<Uint8Array>;
  getObjectUrl(path: string, mimeType?: string, onProgress?: ProgressHandler): Promise<string>;
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
