/**
 * ParquetImageService
 *
 * 图像加载服务，支持两种工作模式：
 *
 * 1. 按需模式（Comlink）：getImageFrame()
 *    用于 episode 加载初期、非预加载场景的回退。
 *
 * 2. 零拷贝 ImageBitmap 模式（raw postMessage）：getFrameBitmap()
 *    Worker 内部维护 LRU + 前向 lookahead，按需解码并以 Transferable 返回。
 *    主线程拿到 ImageBitmap 后直接 canvas.drawImage()，无需 React setState。
 *
 * 旧的 `preloadEpisode` + `getPreloadedFrame` API 仍然保留，但底层已改为
 * on-demand 解码（保留兼容性），不再全量解码导致 renderer OOM。
 */

import type { DataSource } from '../datasource/dataSources';
import type { Remote } from 'comlink';
import { createParquetImageWorker, terminateWorker } from '../workers/workerManager';
import type { ParquetImageWorkerAPI } from '@/core';

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

export type PreloadProgressCallback = (completed: number, total: number) => void;
export type PreloadDoneCallback = () => void;

interface BlobUrlCacheEntry {
  url: string;
  timestamp: number;
}

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

function makeReqId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────
// 服务实现
// ─────────────────────────────────────────────

export class ParquetImageServiceImpl {
  private worker: Remote<ParquetImageWorkerAPI> | null = null;
  // 持有底层 Worker 对象，用于 raw postMessage
  private rawWorker: Worker | null = null;
  private dataSource: DataSource | null = null;

  // Blob URL 缓存（按需模式回退用）
  private blobUrlCache: Map<string, BlobUrlCacheEntry> = new Map();
  private blobUrlInFlight: Map<string, Promise<string>> = new Map();
  private maxBlobCacheSize = 150;

  // Worker 文件/列状态（Comlink 路径用）
  private workerLoadedFile: string | null = null;
  private workerLoadedColumns: Set<string> = new Set();
  private workerOpQueue: Promise<void> = Promise.resolve();
  private dataSourceVersion = 0;

  // raw postMessage pending callbacks: reqId → resolve/reject
  private pendingBitmapCallbacks = new Map<
    string,
    { resolve: (bmp: ImageBitmap | null) => void; reject: (e: Error) => void }
  >();
  private pendingPreloadCallbacks = new Map<
    string,
    {
      resolve: () => void;
      reject: (e: Error) => void;
      onProgress?: PreloadProgressCallback;
    }
  >();

  // 当前预加载的 episode 信息
  private currentPreloadKey: string | null = null;
  private disposed = false;

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('ParquetImageService has been disposed');
    }
  }

  // ─────────────────────────────────────────────
  // 数据源管理
  // ─────────────────────────────────────────────

  setDataSource(dataSource: DataSource) {
    this.assertActive();
    if (this.dataSource !== dataSource) {
      this.dataSource = dataSource;
      this.dataSourceVersion += 1;
      void this.clearAllCache();
    }
  }

  // ─────────────────────────────────────────────
  // Worker 初始化
  // ─────────────────────────────────────────────

  private async getWorker(): Promise<Remote<ParquetImageWorkerAPI>> {
    this.assertActive();
    if (!this.worker) {
      const { remote, raw } = createParquetImageWorker();
      this.worker = remote;
      this.rawWorker = raw;
      this.bindRawWorkerMessages(raw);
      await this.worker.init();
      this.assertActive();
    }
    return this.worker;
  }

  /** 绑定 raw postMessage 监听，处理预加载和帧获取响应 */
  private bindRawWorkerMessages(raw: Worker) {
    raw.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as Record<string, unknown>;
      const { type, reqId } = data as { type: string; reqId?: string };

      // ── 预加载进度 ──
      if (type === 'preload-progress' && reqId) {
        const cb = this.pendingPreloadCallbacks.get(reqId);
        if (cb?.onProgress) {
          cb.onProgress(data.completed as number, data.total as number);
        }
        return;
      }

      // ── 预加载完成 ──
      if (type === 'preload-done' && reqId) {
        const cb = this.pendingPreloadCallbacks.get(reqId);
        this.pendingPreloadCallbacks.delete(reqId);
        cb?.resolve();
        return;
      }

      // ── 预加载中止 / 错误 ──
      if (type === 'preload-aborted' && reqId) {
        const cb = this.pendingPreloadCallbacks.get(reqId);
        this.pendingPreloadCallbacks.delete(reqId);
        cb?.resolve();
        return;
      }

      if (type === 'preload-error' && reqId) {
        const cb = this.pendingPreloadCallbacks.get(reqId);
        this.pendingPreloadCallbacks.delete(reqId);
        cb?.reject(new Error(String(data.error ?? 'preload failed')));
        return;
      }

      // ── get-frame-bitmap 回包 ──
      if (type === 'frame-bitmap' && reqId) {
        const cb = this.pendingBitmapCallbacks.get(reqId);
        this.pendingBitmapCallbacks.delete(reqId);
        cb?.resolve(data.bitmap as ImageBitmap);
        return;
      }

      if ((type === 'frame-bitmap-miss' || type === 'frame-bitmap-error') && reqId) {
        const cb = this.pendingBitmapCallbacks.get(reqId);
        this.pendingBitmapCallbacks.delete(reqId);
        cb?.resolve(null); // null = 需要回退到按需加载
        return;
      }

      if (type === 'clear-preload-done') {
        return;
      }
    });
  }

  // ─────────────────────────────────────────────
  // Comlink 队列（按需模式）
  // ─────────────────────────────────────────────

  private enqueueWorkerOp<T>(task: () => Promise<T>): Promise<T> {
    const run = this.workerOpQueue.then(task, task);
    this.workerOpQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async ensureWorkerHasColumn(
    worker: Remote<ParquetImageWorkerAPI>,
    filePath: string,
    column: string,
  ): Promise<void> {
    const shouldReloadFile = this.workerLoadedFile !== filePath;
    const missingColumn = !shouldReloadFile && !this.workerLoadedColumns.has(column);
    if (!shouldReloadFile && !missingColumn) return;

    if (!this.dataSource) {
      throw new Error('DataSource not set');
    }

    const bytes = await this.dataSource.readBytes(filePath);
    const buffer = (bytes.buffer as ArrayBuffer).slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );

    const columnsToLoad = shouldReloadFile
      ? [column]
      : Array.from(new Set([...this.workerLoadedColumns, column]));
    const loaded = await worker.loadFile(filePath, buffer, columnsToLoad);
    this.workerLoadedFile = filePath;
    this.workerLoadedColumns = new Set(loaded.columns);
  }

  // ─────────────────────────────────────────────
  // Preload API（raw postMessage）
  //
  // 注意：底层 Worker 已改为 on-demand 解码 + 小窗口 LRU，`preloadEpisode` 在 worker 侧
  // 只会预解码少量前向帧，不会再把整个 episode 解码进内存。
  // ─────────────────────────────────────────────

  async preloadEpisode(
    column: string,
    startRow: number,
    endRow: number,
    episodeKey: string,
    onProgress?: PreloadProgressCallback,
  ): Promise<void> {
    this.assertActive();
    await this.getWorker();

    this.currentPreloadKey = episodeKey;

    const reqId = makeReqId();

    const result = new Promise<void>((resolve, reject) => {
      this.pendingPreloadCallbacks.set(reqId, { resolve, reject, onProgress });
    });

    this.rawWorker!.postMessage({
      type: 'preload-episode',
      episodeKey,
      column,
      startRow,
      endRow,
      reqId,
    });

    return result;
  }

  /**
   * 直接获取帧 ImageBitmap（零拷贝 transfer）。Worker 侧按需解码并在命中 LRU 时避免重复解码。
   * 返回 null 表示未命中/出错，调用方应回退到 getImageFrame（blob url）方式。
   *
   * @param column   图像列名
   * @param relRow   episode 内相对行号（0-based）
   * @param startRow episode 绝对起始行号（v3 多 episode 共享文件时非 0）
   */
  async getFrameBitmap(
    column: string,
    relRow: number,
    startRow: number,
  ): Promise<ImageBitmap | null> {
    if (this.disposed) return null;
    if (!this.rawWorker) return null;

    const reqId = makeReqId();

    const result = new Promise<ImageBitmap | null>((resolve, reject) => {
      this.pendingBitmapCallbacks.set(reqId, { resolve, reject });
    });

    this.rawWorker.postMessage({
      type: 'get-frame-bitmap',
      column,
      relRow,
      startRow,
      reqId,
    });

    return result;
  }

  /** 兼容旧 API：与 getFrameBitmap 等价，但签名保留为（column, relRow）。 */
  async getPreloadedFrame(column: string, relRow: number): Promise<ImageBitmap | null> {
    // relRow 已经是 episode 内相对行号，Worker 侧按需解码需要知道 startRow。
    // 为向后兼容，若 startRow 未知则默认 0（单 episode 一文件场景）。
    return this.getFrameBitmap(column, relRow, 0);
  }

  /** 清除 Worker 侧预加载缓存 */
  clearPreload(): void {
    this.currentPreloadKey = null;
    if (this.rawWorker) {
      this.rawWorker.postMessage({ type: 'clear-preload' });
    }
  }

  get preloadKey(): string | null {
    return this.currentPreloadKey;
  }

  // ─────────────────────────────────────────────
  // 按需加载（Comlink，回退路径）
  // ─────────────────────────────────────────────

  async getImageUrl(filePath: string, column: string, rowIndex: number): Promise<string> {
    this.assertActive();
    const requestVersion = this.dataSourceVersion;
    const cacheKey = `${filePath}:${column}:${rowIndex}`;

    const cached = this.blobUrlCache.get(cacheKey);
    if (cached) {
      cached.timestamp = Date.now();
      return cached.url;
    }

    const inFlight = this.blobUrlInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const requestPromise = this.enqueueWorkerOp(async () => {
      if (requestVersion !== this.dataSourceVersion) {
        throw new Error('Image request cancelled due to data source switch');
      }
      const hitAfterQueue = this.blobUrlCache.get(cacheKey);
      if (hitAfterQueue) {
        hitAfterQueue.timestamp = Date.now();
        return hitAfterQueue.url;
      }

      const worker = await this.getWorker();
      await this.ensureWorkerHasColumn(worker, filePath, column);

      const imageData = await worker.getImageCached(column, rowIndex);
      const blob = new Blob([imageData], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      this.addToBlobCache(cacheKey, url);
      return url;
    });
    this.blobUrlInFlight.set(cacheKey, requestPromise);
    try {
      return await requestPromise;
    } finally {
      if (this.blobUrlInFlight.get(cacheKey) === requestPromise) {
        this.blobUrlInFlight.delete(cacheKey);
      }
    }
  }

  async getImageFrame(
    filePath: string,
    column: string,
    relativeRowIndex: number,
    episodeStartRow: number,
  ): Promise<string> {
    const absoluteRowIndex = episodeStartRow + relativeRowIndex;
    return this.getImageUrl(filePath, column, absoluteRowIndex);
  }

  async getImageFrameBytes(
    filePath: string,
    column: string,
    relativeRowIndex: number,
    episodeStartRow: number,
  ): Promise<Uint8Array> {
    this.assertActive();
    const absoluteRowIndex = episodeStartRow + relativeRowIndex;
    const worker = await this.getWorker();
    await this.ensureWorkerHasColumn(worker, filePath, column);
    const buffer = await worker.getImageCached(column, absoluteRowIndex);
    return new Uint8Array(buffer);
  }

  /**
   * 确保 Worker 已加载指定文件/列（供预加载前调用）
   */
  async ensureFileLoaded(filePath: string, column: string): Promise<void> {
    this.assertActive();
    const worker = await this.getWorker();
    return this.enqueueWorkerOp(() => this.ensureWorkerHasColumn(worker, filePath, column));
  }

  // ─────────────────────────────────────────────
  // 缓存管理
  // ─────────────────────────────────────────────

  private addToBlobCache(key: string, url: string) {
    if (this.blobUrlCache.size >= this.maxBlobCacheSize) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [k, v] of this.blobUrlCache) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        const old = this.blobUrlCache.get(oldestKey);
        if (old) URL.revokeObjectURL(old.url);
        this.blobUrlCache.delete(oldestKey);
      }
    }

    this.blobUrlCache.set(key, { url, timestamp: Date.now() });
  }

  async clearAllCache() {
    if (this.disposed) return;
    this.currentPreloadKey = null;
    return this.enqueueWorkerOp(async () => {
      for (const entry of this.blobUrlCache.values()) {
        try {
          URL.revokeObjectURL(entry.url);
        } catch {
          /* ignore */
        }
      }
      this.blobUrlCache.clear();
      this.blobUrlInFlight.clear();
      this.workerLoadedFile = null;
      this.workerLoadedColumns.clear();

      if (this.rawWorker) {
        this.rawWorker.postMessage({ type: 'clear-preload' });
      }

      if (this.worker) {
        try {
          await this.worker.clearCache();
        } catch {
          /* ignore */
        }
      }
    });
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.currentPreloadKey = null;
    this.dataSource = null;
    this.dataSourceVersion += 1;
    const disposeError = new Error('ParquetImageService has been disposed');
    for (const callback of this.pendingBitmapCallbacks.values()) {
      callback.reject(disposeError);
    }
    this.pendingBitmapCallbacks.clear();
    for (const callback of this.pendingPreloadCallbacks.values()) {
      callback.reject(disposeError);
    }
    this.pendingPreloadCallbacks.clear();
    await this.enqueueWorkerOp(async () => {
      for (const entry of this.blobUrlCache.values()) {
        try {
          URL.revokeObjectURL(entry.url);
        } catch {
          /* ignore */
        }
      }
      this.blobUrlCache.clear();
      this.blobUrlInFlight.clear();
      this.workerLoadedFile = null;
      this.workerLoadedColumns.clear();

      if (this.rawWorker) {
        this.rawWorker.postMessage({ type: 'clear-preload' });
      }

      if (this.worker) {
        try {
          await this.worker.clearCache();
        } catch {
          /* ignore */
        }
        terminateWorker(this.worker);
        this.worker = null;
        this.rawWorker = null;
      }
    });
  }
}

/** Creates an isolated image worker and cache for one data-provider instance. */
export function createParquetImageService(): ParquetImageServiceImpl {
  return new ParquetImageServiceImpl();
}

/**
 * @deprecated Prefer createParquetImageService and pass the instance through React context.
 * This singleton is retained for non-React consumers during migration.
 */
export const ParquetImageService = new ParquetImageServiceImpl();
