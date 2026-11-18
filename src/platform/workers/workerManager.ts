/**
 * Worker 管理器 - 使用 Vite 原生外置 module Worker
 *
 * Worker 使用相对模块 URL，WASM 保留为单份按需 data URL chunk，因此不依赖部署根路径。
 * The main thread downloads the WASM once (one module-level promise,
 * started early by `preloadLeRobotViewer`) and compiles it once; every worker
 * receives the compiled `WebAssembly.Module` by postMessage and only
 * instantiates it. Where the page may not compile WebAssembly (a CSP without
 * 'wasm-unsafe-eval'), each worker receives a copy of the bytes and compiles
 * them under its own policy, as it did before; nothing is downloaded twice.
 *
 * Worker 侧使用 Promise 等待（而非轮询），彻底消除竞态条件：
 * 无论主线程多快/多慢完成 fetch，Worker 都会等到 buffer 到达后再初始化。
 */

import * as Comlink from 'comlink';
import type { ParquetWorkerAPI, ParquetImageWorkerAPI } from '@/core';

import parquetWorkerUrl from './parquet.worker?worker&url';
import parquetImageWorkerUrl from './parquetImage.worker?worker&url';

/**
 * The parquet WASM for the workers: compiled once on the page, or its bytes
 * when the page may not compile WebAssembly (each worker then compiles them).
 */
export type ParquetWasm = WebAssembly.Module | ArrayBuffer;

/** The parquet WASM, shared by every worker; reset on failure so a later open retries. */
let wasmPromise: Promise<ParquetWasm> | null = null;
const workerRegistry = new WeakMap<Comlink.Remote<unknown>, Worker>();

/** A compile the page's CSP refused (no 'wasm-unsafe-eval'), as opposed to a fetch that failed. */
function isCompileRefused(error: unknown): boolean {
  return (
    (typeof WebAssembly.CompileError === 'function' && error instanceof WebAssembly.CompileError) ||
    error instanceof EvalError
  );
}

/**
 * Prepare a fetched WASM response for the workers: compile it once on the
 * page (streaming, while the bytes arrive, when it is served as
 * `application/wasm`). If the page may not compile WebAssembly, keep the
 * bytes of the same download for the workers to compile.
 */
export async function prepareParquetWasm(response: Response): Promise<ParquetWasm> {
  if (!response.ok) throw new Error(`Failed to fetch WASM: ${response.status}`);
  const type = response.headers.get('Content-Type')?.split(';')[0]?.trim();
  if (typeof WebAssembly.compileStreaming === 'function' && type === 'application/wasm') {
    const bytes = response.clone();
    try {
      return await WebAssembly.compileStreaming(response);
    } catch (error) {
      if (!isCompileRefused(error)) throw error;
      return bytes.arrayBuffer();
    }
  }
  const bytes = await response.arrayBuffer();
  try {
    return await WebAssembly.compile(bytes);
  } catch (error) {
    if (!isCompileRefused(error)) throw error;
    return bytes;
  }
}

/** Download and prepare the parquet WASM once; later calls share the same promise. */
export function loadParquetWasm(): Promise<ParquetWasm> {
  if (!wasmPromise) {
    // Library mode places this data URL in its own lazy chunk. Keeping one
    // package-local copy is relocatable across Vite, Next, and arbitrary bases.
    const pending = import('./wasmUrl')
      .then(({ wasmUrl }) => fetch(wasmUrl))
      .then(prepareParquetWasm)
      .catch((err: unknown) => {
        if (wasmPromise === pending) wasmPromise = null; // 重置以便重试
        throw err;
      });
    wasmPromise = pending;
  }
  return wasmPromise;
}

/**
 * 向 Worker 发送 WASM（编译好的模块，或一份字节副本），出错时通知 worker 以便快速失败
 */
function sendWasmToWorker(worker: Worker): void {
  loadParquetWasm()
    .then((wasm) => {
      // A Module is shared by reference; bytes are copied (not transferred),
      // so every worker gets its own and the shared download stays intact.
      worker.postMessage({ type: 'init-wasm', wasmModule: wasm });
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
