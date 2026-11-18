/**
 * Worker 管理器 - 使用 Vite 原生外置 module Worker
 *
 * Worker 使用相对模块 URL，WASM 保留为单份按需 data URL chunk，因此不依赖部署根路径。
 * The main thread fetches and compiles the WASM once (one module-level
 * promise, started early by `preloadLeRobotViewer`); every worker receives
 * the compiled `WebAssembly.Module` by postMessage and only instantiates it.
 *
 * Worker 侧使用 Promise 等待（而非轮询），彻底消除竞态条件：
 * 无论主线程多快/多慢完成 fetch，Worker 都会等到 buffer 到达后再初始化。
 */

import * as Comlink from 'comlink';
import type { ParquetWorkerAPI, ParquetImageWorkerAPI } from '@/core';

import parquetWorkerUrl from './parquet.worker?worker&url';
import parquetImageWorkerUrl from './parquetImage.worker?worker&url';

/** The compiled parquet WASM, shared by every worker; reset on failure so a later open retries. */
let wasmModulePromise: Promise<WebAssembly.Module> | null = null;
const workerRegistry = new WeakMap<Comlink.Remote<unknown>, Worker>();

/**
 * Compile a fetched WASM response: streaming (compiling while the bytes
 * arrive) when the response is served as `application/wasm`, otherwise from
 * its bytes.
 */
export async function compileWasmResponse(response: Response): Promise<WebAssembly.Module> {
  if (!response.ok) throw new Error(`Failed to fetch WASM: ${response.status}`);
  const type = response.headers.get('Content-Type')?.split(';')[0]?.trim();
  if (typeof WebAssembly.compileStreaming === 'function' && type === 'application/wasm') {
    return WebAssembly.compileStreaming(response);
  }
  return WebAssembly.compile(await response.arrayBuffer());
}

/** Fetch and compile the parquet WASM once; later calls share the same promise. */
export function loadParquetWasmModule(): Promise<WebAssembly.Module> {
  if (!wasmModulePromise) {
    // Library mode places this data URL in its own lazy chunk. Keeping one
    // package-local copy is relocatable across Vite, Next, and arbitrary bases.
    const pending = import('./wasmUrl')
      .then(({ wasmUrl }) => fetch(wasmUrl))
      .then(compileWasmResponse)
      .catch((err: unknown) => {
        if (wasmModulePromise === pending) wasmModulePromise = null; // 重置以便重试
        throw err;
      });
    wasmModulePromise = pending;
  }
  return wasmModulePromise;
}

/**
 * 向 Worker 发送编译好的 WASM 模块，出错时通知 worker 以便快速失败
 */
function sendWasmToWorker(worker: Worker): void {
  loadParquetWasmModule()
    .then((wasmModule) => {
      worker.postMessage({ type: 'init-wasm', wasmModule });
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
