/**
 * Parquet writing for export, done in a Parquet worker so the page never
 * compiles WebAssembly (a host page's CSP needs no 'wasm-unsafe-eval').
 *
 * One worker serves every write of an export and is terminated once no write
 * has come for `EXPORT_WORKER_IDLE_MS`. A worker that failed (its script or
 * the WASM could not load) is dropped at once, so the next export starts
 * afresh; its error is the named PARQUET_ENGINE_UNAVAILABLE one.
 */
import * as Comlink from 'comlink';
import type { ParquetWorkerAPI } from '@/core';
import { isParquetEngineError } from '../../core/workers/engineError';
import { createParquetWorker, terminateWorker } from '../workers/workerManager';

export const EXPORT_WORKER_IDLE_MS = 30_000;

let worker: Comlink.Remote<ParquetWorkerAPI> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = 0;

function release(): void {
  if (!worker) return;
  terminateWorker(worker as Comlink.Remote<unknown>);
  worker = null;
}

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
    if (inFlight === 0 && worker) {
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (inFlight === 0) release();
      }, EXPORT_WORKER_IDLE_MS);
    }
  }
}
