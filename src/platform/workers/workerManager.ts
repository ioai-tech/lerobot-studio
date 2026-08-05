/**
 * Worker 管理器 - 使用 Vite 原生外置 module Worker
 *
 * Worker 使用相对模块 URL，WASM 保留为单份按需 data URL chunk，因此不依赖部署根路径。
 * WASM 由主线程预加载为 ArrayBuffer，再通过 postMessage Transfer 传递给 Worker。
 *
 * Worker 侧使用 Promise 等待（而非轮询），彻底消除竞态条件：
 * 无论主线程多快/多慢完成 fetch，Worker 都会等到 buffer 到达后再初始化。
 */

import * as Comlink from 'comlink';
import type { ParquetWorkerAPI, ParquetImageWorkerAPI } from '@/core';

import parquetWorkerUrl from './parquet.worker?worker&url';
import parquetImageWorkerUrl from './parquetImage.worker?worker&url';

// WASM 预加载缓存（Promise 形式，多个 worker 共享同一份 fetch）
let wasmBufferPromise: Promise<ArrayBuffer> | null = null;
const workerRegistry = new WeakMap<Comlink.Remote<unknown>, Worker>();

/**
 * 预加载 WASM 文件为 ArrayBuffer（带缓存）
 */
async function loadWasmBuffer(): Promise<ArrayBuffer> {
  if (!wasmBufferPromise) {
    // Library mode places this data URL in its own lazy chunk. Keeping one
    // package-local copy is relocatable across Vite, Next, and arbitrary bases.
    wasmBufferPromise = import('./wasmUrl')
      .then(({ wasmUrl }) => fetch(wasmUrl))
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to fetch WASM: ${response.status}`);
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
  const worker = new Worker(parquetWorkerUrl, { type: 'module' });
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
  const worker = new Worker(parquetImageWorkerUrl, { type: 'module' });
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
