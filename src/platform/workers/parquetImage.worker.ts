/**
 * ParquetImage Worker
 *
 * 从主线程接收预加载的 WASM ArrayBuffer 进行初始化。
 *
 * 设计要点（memory-safe 版本）：
 * 1. 加载 Parquet 文件后，仅保留 **图像列 Arrow Vector** 作为原始 JPEG 字节来源，
 *    不再一次性把整集的 ImageBitmap 解码进内存（旧实现在大数据集下会把整个 episode 的
 *    ImageBitmap 常驻，单列即可达 ~1GB，是 renderer tab 崩溃的主因）。
 * 2. 主线程请求帧时通过 raw postMessage `get-frame-bitmap` 消息，worker 在内部做
 *    按需 JPEG→ImageBitmap 解码，并以 Transferable 方式零拷贝返回。
 * 3. Worker 侧维护一个小尺寸 LRU（默认 24 帧）缓存最近解码的 ImageBitmap，
 *    覆盖“来回拖拽/小窗口反复查看”的热路径；LRU 满时 .close() 释放 GPU 纹理资源。
 * 4. 兼容 `preload-episode`：保留消息但**不再全量解码**；若 MAX_PRELOAD_BYTES 允许，
 *    最多只会预取一小段前向窗口，避免 UI 层代码修改面过大。
 */

import * as Comlink from 'comlink';
import init, { readParquet } from 'parquet-wasm';
import { tableFromIPC, Vector } from 'apache-arrow';
import type { ParquetImageWorkerAPI } from '@/core';
import { detectImageColumns } from '@/core';

let wasmInitialized = false;
let wasmInitPromise: Promise<void> | null = null;

let wasmBufferResolve: ((buf: ArrayBuffer) => void) | null = null;
let wasmBufferReject: ((err: Error) => void) | null = null;
const wasmBufferSignal = new Promise<ArrayBuffer>((resolve, reject) => {
  wasmBufferResolve = resolve;
  wasmBufferReject = reject;
});

interface FileCache {
  filePath: string;
  columns: Map<string, Vector>;
  requestedColumns: string[];
  numRows: number;
}

let fileCache: FileCache | null = null;

// ─── Decoded ImageBitmap LRU（Worker 端小窗口） ──────────────────────────
// 使用 Map 的插入顺序实现 LRU：命中时先 delete 再 set，保证最近使用在尾部。
const DECODED_LRU_MAX = 24;
const decodedLru = new Map<string, ImageBitmap>();

function lruGet(key: string): ImageBitmap | undefined {
  const v = decodedLru.get(key);
  if (!v) return undefined;
  decodedLru.delete(key);
  decodedLru.set(key, v);
  return v;
}

function lruSet(key: string, bmp: ImageBitmap): void {
  if (decodedLru.has(key)) {
    const old = decodedLru.get(key);
    decodedLru.delete(key);
    try {
      old?.close();
    } catch {
      /* ignore */
    }
  }
  decodedLru.set(key, bmp);
  while (decodedLru.size > DECODED_LRU_MAX) {
    const firstKey = decodedLru.keys().next().value as string | undefined;
    if (firstKey === undefined) break;
    const bitmap = decodedLru.get(firstKey);
    decodedLru.delete(firstKey);
    try {
      bitmap?.close();
    } catch {
      /* ignore */
    }
  }
}

function lruClear(): void {
  for (const bmp of decodedLru.values()) {
    try {
      bmp.close();
    } catch {
      /* ignore */
    }
  }
  decodedLru.clear();
}

// ─── 前向预取（可选，small look-ahead）──────────────────────────────────
// 预取只在当前请求之后尝试解码少量后续帧（非阻塞），失败或超 budget 立即停止。
const LOOKAHEAD_FRAMES = 4;
let lookaheadToken = 0;

// ─── Preload 兼容层（保留消息名但行为变为 no-op，旧 UI 代码无需改动）──
// 预加载字节上限，超过则只预取少量前向帧。
const MAX_PRELOAD_BYTES = 64 * 1024 * 1024; // 64MB cap for lookahead bytes
let preloadEpisodeKey: string | null = null;

self.onmessage = async (event: MessageEvent) => {
  const { type } = event.data as { type: string };

  if (type === 'init-wasm') {
    wasmBufferResolve?.(event.data.wasmBuffer as ArrayBuffer);
    return;
  }

  if (type === 'init-wasm-error') {
    wasmBufferReject?.(new Error(`Main thread failed to load WASM: ${String(event.data.message)}`));
    return;
  }

  if (type === 'preload-episode') {
    // 保留消息兼容上层代码；当前仅记录 episode 并做少量前向预解码。
    const { episodeKey, column, startRow, endRow, reqId } = event.data as {
      episodeKey: string;
      column: string;
      startRow: number;
      endRow: number;
      reqId: string;
    };

    try {
      await initWasm();
      preloadEpisodeKey = episodeKey;

      if (!fileCache) {
        self.postMessage({ type: 'preload-error', reqId, error: 'No file loaded' });
        return;
      }
      const vector = fileCache.columns.get(column);
      if (!vector) {
        self.postMessage({ type: 'preload-error', reqId, error: `Column ${column} not found` });
        return;
      }

      // 仅前向预解码少量帧到 LRU；budget 外立即停止，不再全量解码。
      const total = Math.max(0, endRow - startRow);
      const limit = Math.min(total, LOOKAHEAD_FRAMES * 2);
      let decodedBytes = 0;
      let completed = 0;

      for (let i = 0; i < limit; i++) {
        if (preloadEpisodeKey !== episodeKey) {
          self.postMessage({ type: 'preload-aborted', reqId });
          return;
        }
        const absRow = startRow + i;
        const bytes = extractImageBytes(vector.get(absRow));
        if (!bytes) {
          completed++;
          continue;
        }
        decodedBytes += bytes.byteLength;
        if (decodedBytes > MAX_PRELOAD_BYTES) break;

        try {
          const key = `${column}:${i}`;
          if (!decodedLru.has(key)) {
            const bitmap = await createImageBitmap(
              new Blob([copyBytesToAB(bytes)], { type: 'image/jpeg' }),
            );
            lruSet(key, bitmap);
          }
        } catch {
          /* ignore */
        }

        completed++;
        if (completed % 4 === 0 || completed === limit) {
          self.postMessage({ type: 'preload-progress', reqId, completed, total: limit });
        }
      }

      self.postMessage({ type: 'preload-done', reqId, total: completed });
    } catch (err) {
      self.postMessage({
        type: 'preload-error',
        reqId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // 新消息：按需取 ImageBitmap（无需预加载），Worker 侧 LRU + lookahead 缓解解码抖动
  if (type === 'get-frame-bitmap') {
    const { column, relRow, startRow, reqId } = event.data as {
      column: string;
      relRow: number;
      startRow: number;
      reqId: string;
    };

    try {
      await initWasm();
      if (!fileCache) {
        self.postMessage({ type: 'frame-bitmap-miss', reqId, reason: 'no-file' });
        return;
      }
      const vector = fileCache.columns.get(column);
      if (!vector) {
        self.postMessage({ type: 'frame-bitmap-miss', reqId, reason: 'no-column' });
        return;
      }

      const key = `${column}:${relRow}`;
      let bitmap = lruGet(key);
      if (!bitmap) {
        const bytes = extractImageBytes(vector.get(startRow + relRow));
        if (!bytes) {
          self.postMessage({ type: 'frame-bitmap-miss', reqId, reason: 'no-bytes' });
          return;
        }
        bitmap = await createImageBitmap(new Blob([copyBytesToAB(bytes)], { type: 'image/jpeg' }));
        // 注意：transfer 后 bitmap 所有权移交主线程，这里不再保留在 LRU 中（避免 detached 引用）
      } else {
        // 命中 LRU：直接转移（转移后从 LRU 移除，下次命中时需要重新解码）
        decodedLru.delete(key);
      }

      // Transfer to main (zero-copy)

      (self as any).postMessage({ type: 'frame-bitmap', reqId, bitmap }, [bitmap]);

      // 触发 lookahead 预解码（不阻塞当前响应）
      scheduleLookahead(column, relRow, startRow, vector);
    } catch (err) {
      self.postMessage({
        type: 'frame-bitmap-error',
        reqId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (type === 'clear-preload') {
    lruClear();
    preloadEpisodeKey = null;
    lookaheadToken++;
    self.postMessage({ type: 'clear-preload-done' });
    return;
  }
};

function scheduleLookahead(
  column: string,
  fromRelRow: number,
  startRow: number,
  vector: Vector,
): void {
  const token = ++lookaheadToken;
  // Fire-and-forget: schedule as microtask burst; each iteration yields to event loop.
  void (async () => {
    for (let i = 1; i <= LOOKAHEAD_FRAMES; i++) {
      if (token !== lookaheadToken) return;
      const relRow = fromRelRow + i;
      const key = `${column}:${relRow}`;
      if (decodedLru.has(key)) continue;
      try {
        const bytes = extractImageBytes(vector.get(startRow + relRow));
        if (!bytes) continue;
        const bitmap = await createImageBitmap(
          new Blob([copyBytesToAB(bytes)], { type: 'image/jpeg' }),
        );
        if (token !== lookaheadToken) {
          try {
            bitmap.close();
          } catch {
            /* ignore */
          }
          return;
        }
        lruSet(key, bitmap);
      } catch {
        /* ignore */
      }
      // yield
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  })();
}

async function initWasm(): Promise<void> {
  if (wasmInitialized) return;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    try {
      const wasmBuffer = await wasmBufferSignal;
      await init(wasmBuffer);
      wasmInitialized = true;
    } catch (e) {
      console.error('Worker: Failed to initialize WASM', e);
      wasmInitPromise = null;
      throw e;
    }
  })();

  return wasmInitPromise;
}

function extractImageBytes(val: unknown): Uint8Array | null {
  if (!val) return null;

  if (val instanceof Uint8Array) return val;
  if (val instanceof ArrayBuffer) return new Uint8Array(val);

  if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>;

    if ('bytes' in obj) {
      const bytes = obj.bytes;
      if (bytes instanceof Uint8Array) return bytes;
      if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
      if (Array.isArray(bytes)) return new Uint8Array(bytes);
    }

    if ('data' in obj && obj.data instanceof Uint8Array) {
      return obj.data;
    }
  }

  return null;
}

/**
 * 返回一份**独立 ArrayBuffer**（非 SharedArrayBuffer 视图）的字节副本，
 * 避免 Arrow 内部可能的 SharedArrayBuffer 与 Blob/ImageBitmap 的类型不兼容。
 */
function copyBytesToAB(src: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(src.byteLength);
  new Uint8Array(buf).set(src);
  return buf;
}

// Comlink API（保留用于按需/首帧加载兼容）
const api: ParquetImageWorkerAPI = {
  async init(): Promise<void> {
    await initWasm();
  },

  async loadFile(
    filePath: string,
    buffer: ArrayBuffer,
    requestedColumns?: string[],
  ): Promise<{ columns: string[]; numRows: number }> {
    await initWasm();

    const uint8Array = new Uint8Array(buffer);

    let imageColumns = requestedColumns?.filter(Boolean) ?? [];
    if (imageColumns.length === 0) {
      const fullTable = readParquet(uint8Array);
      const fullArrow = fullTable.intoIPCStream();
      const tempTable = tableFromIPC(fullArrow);
      const allColumns = tempTable.schema.fields.map((field) => field.name);
      imageColumns = detectImageColumns(allColumns);
    }

    if (imageColumns.length === 0) {
      throw new Error(
        "No image columns requested or detected. Expected 'observation.image' or 'observation.images.*'",
      );
    }

    const imageTable = readParquet(uint8Array, { columns: imageColumns });
    const imageArrow = imageTable.intoIPCStream();
    const table = tableFromIPC(imageArrow);

    const columns = new Map<string, Vector>();
    for (const colName of imageColumns) {
      const vector = table.getChild(colName);
      if (vector) {
        columns.set(colName, vector);
      }
    }

    // 切换文件 → 清空旧 LRU，避免跨文件的 bitmap 残留
    if (!fileCache || fileCache.filePath !== filePath) {
      lruClear();
    }

    const loadedColumns = Array.from(columns.keys());
    fileCache = {
      filePath,
      columns,
      requestedColumns: imageColumns,
      numRows: table.numRows,
    };

    return {
      columns: loadedColumns,
      numRows: table.numRows,
    };
  },

  async getImageCached(column: string, rowIndex: number): Promise<ArrayBuffer> {
    if (!fileCache) {
      throw new Error('No file loaded');
    }

    const vector = fileCache.columns.get(column);
    if (!vector) {
      throw new Error(
        `Column ${column} not found in file ${fileCache.filePath}. Requested: ${fileCache.requestedColumns.join(', ') || '(none)'}. Available: ${Array.from(fileCache.columns.keys()).join(', ') || '(none)'}`,
      );
    }

    if (rowIndex < 0 || rowIndex >= fileCache.numRows) {
      throw new Error(`Row ${rowIndex} out of range [0, ${fileCache.numRows - 1}]`);
    }

    const val = vector.get(rowIndex);
    const imageBytes = extractImageBytes(val);

    if (!imageBytes) {
      throw new Error(`No image data at row ${rowIndex} for column ${column}`);
    }

    const result = new Uint8Array(imageBytes.length);
    result.set(imageBytes);

    return Comlink.transfer(result.buffer, [result.buffer]);
  },

  async clearCache(): Promise<void> {
    fileCache = null;
    lruClear();
    preloadEpisodeKey = null;
    lookaheadToken++;
  },
};

Comlink.expose(api);
