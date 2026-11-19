/**
 * Parquet writing for export, done in a Parquet worker so the page never
 * compiles WebAssembly (a host page's CSP needs no 'wasm-unsafe-eval').
 *
 * One worker serves every write of an export and is terminated once no write
 * has come for `EXPORT_WORKER_IDLE_MS`. A worker that failed (its script or
 * the WASM could not load) is dropped at once, so the next export starts
 * afresh; its error is the named PARQUET_ENGINE_UNAVAILABLE one. When the
 * host changes the WASM URL (`setParquetWasmUrl`), an idle worker is dropped
 * at once; one with writes in flight finishes them and is dropped as soon as
 * it is idle, so the next write starts on the new URL.
 */
import * as Comlink from 'comlink';
import type { ParquetWorkerAPI } from '@/core';
import { isParquetEngineError } from '../../core/workers/engineError';
import { createParquetWorker, terminateWorker } from '../workers/workerManager';
import { onParquetWasmUrlChange } from '../workers/wasmConfig';

export const EXPORT_WORKER_IDLE_MS = 30_000;

let worker: Comlink.Remote<ParquetWorkerAPI> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = 0;
/** The worker was given a WASM URL the host has since changed. */
let stale = false;

function release(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  stale = false;
  if (!worker) return;
  terminateWorker(worker as Comlink.Remote<unknown>);
  worker = null;
}

onParquetWasmUrlChange(() => {
  if (!worker) return;
  if (inFlight === 0) release();
  else stale = true;
});

/**
 * Write an Arrow IPC stream as Parquet bytes. `'snappy'` compresses the
 * columns; without it the writer's defaults apply. The input buffer is
 * transferred to the worker: callers pass a stream they no longer need.
 */
export async function writeParquetBytes(
  ipcStream: Uint8Array,
  compression?: 'snappy',
): Promise<Uint8Array> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  worker ??= createParquetWorker({ adoptPrewarmed: false });
  const current = worker;
  inFlight += 1;
  try {
    const owned =
      ipcStream.byteOffset === 0 && ipcStream.byteLength === ipcStream.buffer.byteLength
        ? ipcStream
        : ipcStream.slice();
    return await current.writeParquet(Comlink.transfer(owned, [owned.buffer]), compression);
  } catch (error) {
    if (isParquetEngineError(error) && worker === current) release();
    throw error;
  } finally {
    inFlight -= 1;
    if (inFlight === 0 && stale) release();
    else if (inFlight === 0 && worker) {
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (inFlight === 0) release();
      }, EXPORT_WORKER_IDLE_MS);
    }
  }
}
