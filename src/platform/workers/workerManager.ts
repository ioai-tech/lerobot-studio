/**
 * Starts the Parquet workers and tells each where the parquet WASM is.
 *
 * - Worker scripts and the WASM are real files next to this chunk, referenced
 *   with `new URL(..., import.meta.url)`, so Vite, webpack, Turbopack and
 *   Rollup emit them with hashed names under any base path.
 * - The page never fetches or compiles the WASM: each worker downloads it
 *   (one HTTP download, shared through the HTTP cache) and stream-compiles it
 *   (see parquetWasmModule.ts). A host may serve it elsewhere with
 *   `setParquetWasmUrl`.
 * - A worker that cannot serve calls (its script blocked or missing, a
 *   message that cannot be read, the WASM failing to load) fails every pending
 *   and later call with a named PARQUET_ENGINE_UNAVAILABLE error, never a
 *   call that waits forever.
 * - `prewarmParquetWorker` (behind `preloadLeRobotViewer`) starts one worker
 *   early so the download and compile overlap the host's own work; the next
 *   loader adopts it, and an unadopted one is terminated after a short idle.
 */

import * as Comlink from 'comlink';
import type { ParquetWorkerAPI, ParquetImageWorkerAPI } from '@/core';
import { parquetEngineError } from '../../core/workers/engineError';
import type { InitParquetWasmMessage, ParquetWorkerStatusMessage } from './parquetWasmModule';

import parquetWorkerUrl from './parquet.worker?worker&url';
import parquetImageWorkerUrl from './parquetImage.worker?worker&url';

import { wasmUrl as packagedWasmUrl } from './wasmUrl';
import { parquetWasmUrlOverride } from './wasmConfig';

/** A started worker: its guarded remote, the raw Worker (null if it never started), and its failure. */
interface WorkerHandle<T> {
  remote: Comlink.Remote<T>;
  raw: Worker | null;
  /** Rejects with the named error once the worker can no longer serve calls; never resolves. */
  failed: Promise<never>;
  /** The failure, once there is one. */
  failure(): Error | null;
  /** The WASM URL this worker was given. */
  wasmUrl: string;
}

const handles = new WeakMap<object, WorkerHandle<unknown>>();

/** How long a prewarmed worker waits for a loader before it is terminated. */
export const SPARE_WORKER_IDLE_MS = 30_000;
let spare: { handle: WorkerHandle<ParquetWorkerAPI>; timer: ReturnType<typeof setTimeout> } | null =
  null;

/** The parquet WASM URL the workers fetch: the host's override, or the packaged file. */
export function resolveParquetWasmUrl(): string {
  // Absolute: a worker resolves relative URLs against its own script, not the page.
  return new URL(parquetWasmUrlOverride() ?? packagedWasmUrl, globalThis.location?.href).href;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

/**
 * A remote whose calls reject with the worker's failure: at once when it has
 * failed, and as soon as it fails while a call is pending.
 */
function guard<T>(
  remote: Comlink.Remote<T> | null,
  failed: Promise<never>,
  failure: () => Error | null,
): Comlink.Remote<T> {
  const target = (remote ?? {}) as object;
  return new Proxy(target, {
    get(object, property) {
      if (typeof property === 'symbol') {
        return remote ? Reflect.get(object, property) : () => undefined;
      }
      if (property === 'then') return undefined; // not a thenable
      return (...args: unknown[]) => {
        const current = failure();
        if (current || !remote) return Promise.reject(current ?? new Error('worker not started'));
        const call = (Reflect.get(object, property) as (...a: unknown[]) => Promise<unknown>)(
          ...args,
        );
        return Promise.race([call, failed]);
      };
    },
  }) as Comlink.Remote<T>;
}

function spawn<T>(scriptUrl: string, label: string): WorkerHandle<T> {
  const wasmUrl = resolveParquetWasmUrl();
  let failure: Error | null = null;
  let rejectFailed: (error: Error) => void = () => undefined;
  const failed = new Promise<never>((_, reject) => {
    rejectFailed = reject;
  });
  failed.catch(() => undefined); // observed by each call, not here
  const fail = (detail: string) => {
    if (failure) return;
    failure = parquetEngineError(detail);
    rejectFailed(failure);
  };

  let worker: Worker | null = null;
  try {
    worker = new Worker(scriptUrl, { type: 'module' });
  } catch (error) {
    fail(`the ${label} worker could not start: ${describe(error)}`);
  }
  if (worker) {
    let started = false;
    worker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as ParquetWorkerStatusMessage | null;
      if (data?.type === 'parquet-worker-started') started = true;
      else if (data?.type === 'parquet-wasm' && !data.ok) fail(data.message);
    });
    worker.addEventListener('error', (event: Event) => {
      // After the worker's code ran, an error event is an uncaught error in a
      // handler; the call it belonged to reports it.
      if (started) return;
      const detail = (event as Partial<ErrorEvent>).message;
      const message = detail ? `: ${detail}` : '';
      fail(
        `the ${label} worker script could not load (missing, or blocked by a Content-Security-Policy worker-src)${message}`,
      );
    });
    worker.addEventListener('messageerror', () =>
      fail(`a message from the ${label} worker could not be read`),
    );
    const init: InitParquetWasmMessage = { type: 'init-wasm', url: wasmUrl };
    worker.postMessage(init);
  }
  const remote = guard(worker ? Comlink.wrap<T>(worker) : null, failed, () => failure);
  const handle: WorkerHandle<T> = { remote, raw: worker, failed, failure: () => failure, wasmUrl };
  handles.set(remote as object, handle as WorkerHandle<unknown>);
  return handle;
}

function usableSpare(): WorkerHandle<ParquetWorkerAPI> | null {
  if (!spare || spare.handle.failure()) return null;
  return spare.handle.wasmUrl === resolveParquetWasmUrl() ? spare.handle : null;
}

function dropSpare(): void {
  if (!spare) return;
  clearTimeout(spare.timer);
  const { remote } = spare.handle;
  spare = null;
  terminateWorker(remote as Comlink.Remote<unknown>);
}

/**
 * Start one Parquet worker ahead of a loader, so it downloads and compiles
 * the WASM meanwhile. The next `createParquetWorker` adopts it; if none does
 * within `SPARE_WORKER_IDLE_MS`, it is terminated. A spare that fails is
 * dropped: the loader starts its own worker and reports that one's error.
 */
export function prewarmParquetWorker(): void {
  if (typeof Worker === 'undefined' || usableSpare()) return;
  dropSpare();
  const handle = spawn<ParquetWorkerAPI>(parquetWorkerUrl, 'Parquet');
  spare = { handle, timer: setTimeout(dropSpare, SPARE_WORKER_IDLE_MS) };
  handle.failed.catch(() => {
    if (spare?.handle === handle) dropSpare();
  });
}

/**
 * A Parquet worker for one data loader: the prewarmed one when there is a
 * usable one, unless `adoptPrewarmed` is false (export keeps its own).
 */
export function createParquetWorker(
  options: { adoptPrewarmed?: boolean } = {},
): Comlink.Remote<ParquetWorkerAPI> {
  if (options.adoptPrewarmed === false) {
    return spawn<ParquetWorkerAPI>(parquetWorkerUrl, 'Parquet').remote;
  }
  const adopted = usableSpare();
  if (adopted && spare) {
    clearTimeout(spare.timer);
    spare = null;
    return adopted.remote;
  }
  dropSpare();
  return spawn<ParquetWorkerAPI>(parquetWorkerUrl, 'Parquet').remote;
}

/**
 * A ParquetImage worker: the guarded Comlink remote, and the raw Worker for
 * the frame protocol (raw postMessage, without Comlink's promise per frame).
 * `failed` rejects with the named error when the worker can no longer answer,
 * so raw requests in flight can fail too.
 */
export function createParquetImageWorker(): {
  remote: Comlink.Remote<ParquetImageWorkerAPI>;
  raw: Worker | null;
  failed: Promise<never>;
} {
  const { remote, raw, failed } = spawn<ParquetImageWorkerAPI>(
    parquetImageWorkerUrl,
    'ParquetImage',
  );
  return { remote, raw, failed };
}

/** Release a worker made here. */
export function terminateWorker(worker: Comlink.Remote<unknown>): void {
  const handle = handles.get(worker as object);
  try {
    worker[Comlink.releaseProxy]();
  } catch {
    // A worker that never started has no proxy to release.
  }
  if (handle) {
    handle.raw?.terminate();
    handles.delete(worker as object);
  }
}
