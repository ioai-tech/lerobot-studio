/**
 * Worker 管理器 - 使用 Vite 原生 ?worker&inline 特性
 *
 * 由于内联 Worker 运行在 Blob URL 环境，parquet-wasm 无法通过 import.meta.url
 * 正确解析 WASM 文件路径（"Invalid URL" 错误）。解决方案是在主线程预加载
 * WASM 为 ArrayBuffer，然后通过 postMessage Transfer 传递给 Worker。
 *
 * Worker 侧使用 Promise 等待（而非轮询），彻底消除竞态条件：
 * 无论主线程多快/多慢完成 fetch，Worker 都会等到 buffer 到达后再初始化。
 */

import * as Comlink from 'comlink';
import type { ParquetWorkerAPI, ParquetImageWorkerAPI } from '@/core';

// SPA build: ?url -> separate .wasm file fetched on demand
// lib build: vite.lib.config.ts aliases this to wasmUrl.inline.ts (?url&inline -> base64 data URL)
import { wasmUrl } from './wasmUrl';

// Vite 会自动将 worker 内联为 base64
import ParquetWorkerConstructor from './parquet.worker?worker&inline';
import ParquetImageWorkerConstructor from './parquetImage.worker?worker&inline';

// WASM 预加载缓存（Promise 形式，多个 worker 共享同一份 fetch）
let wasmBufferPromise: Promise<ArrayBuffer> | null = null;
const workerRegistry = new WeakMap<Comlink.Remote<unknown>, Worker>();

/**
 * 预加载 WASM 文件为 ArrayBuffer（带缓存）
 */
async function loadWasmBuffer(): Promise<ArrayBuffer> {
  if (!wasmBufferPromise) {
    wasmBufferPromise = fetch(wasmUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch WASM: ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .catch((err) => {
        wasmBufferPromise = null; // 重置以便重试
        throw err;
      });
  }
  // 返回副本以便可以 Transfer（Transfer 会转移所有权）
  const buffer = await wasmBufferPromise;
  return buffer.slice(0);
}

/**
 * 向 Worker 发送 WASM buffer，出错时通知 worker 以便快速失败
 */
function sendWasmToWorker(worker: Worker): void {
  loadWasmBuffer()
    .then((buffer) => {
      worker.postMessage({ type: 'init-wasm', wasmBuffer: buffer }, [buffer]);
    })
    .catch((err) => {
      worker.postMessage({ type: 'init-wasm-error', message: String(err) });
    });
}

/**
 * 创建 Parquet Worker 实例并传递 WASM ArrayBuffer
 */
export function createParquetWorker(): Comlink.Remote<ParquetWorkerAPI> {
  const worker = new ParquetWorkerConstructor();
  sendWasmToWorker(worker);
  const remote = Comlink.wrap<ParquetWorkerAPI>(worker);
  workerRegistry.set(remote as Comlink.Remote<unknown>, worker);
  return remote;
}

/**
 * 创建 ParquetImage Worker 实例并传递 WASM ArrayBuffer。
 * 同时返回 Comlink remote 和原始 Worker 对象，
 * 原始 Worker 用于 raw postMessage（预加载/帧传输），绕过 Comlink Promise 开销。
 */
export function createParquetImageWorker(): {
  remote: Comlink.Remote<ParquetImageWorkerAPI>;
  raw: Worker;
} {
  const worker = new ParquetImageWorkerConstructor();
  sendWasmToWorker(worker);
  const remote = Comlink.wrap<ParquetImageWorkerAPI>(worker);
  workerRegistry.set(remote as Comlink.Remote<unknown>, worker);
  return { remote, raw: worker };
}

/**
 * 释放 Worker 资源
 */
export function terminateWorker(worker: Comlink.Remote<unknown>): void {
  // 释放 Comlink 代理
  worker[Comlink.releaseProxy]();
  const rawWorker = workerRegistry.get(worker);
  if (rawWorker) {
    rawWorker.terminate();
    workerRegistry.delete(worker);
  }
}
