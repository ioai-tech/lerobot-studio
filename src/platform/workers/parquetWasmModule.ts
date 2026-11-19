/**
 * Worker side of the parquet-wasm load. The page only tells each worker the
 * URL; the worker downloads and compiles the module itself:
 *
 * - one HTTP download per URL, shared by every worker through the browser's
 *   HTTP cache (the file has a hashed name, so hosts can cache it for good);
 * - `WebAssembly.compileStreaming` when the response is `application/wasm`,
 *   which compiles while the bytes arrive and lets the browser cache the
 *   compiled code; any other type falls back to the bytes and `compile`;
 * - nothing is fetched or compiled on the page, so the page's CSP needs no
 *   `'wasm-unsafe-eval'`. A CSP sent with the worker script itself must allow it.
 *
 * A load that fails stays failed in this worker: every later call gets the
 * same named PARQUET_ENGINE_UNAVAILABLE error at once, without downloading
 * again. A new worker (the next open, or a retry) tries again.
 */
import init from 'parquet-wasm';
import { parquetEngineError } from '../../core/workers/engineError';

/** Page → worker: where the parquet WASM is. Sent once, right after the worker starts. */
export interface InitParquetWasmMessage {
  type: 'init-wasm';
  url: string;
}

/** Worker → page: the worker's module evaluated, or the WASM load finished. */
export type ParquetWorkerStatusMessage =
  | { type: 'parquet-worker-started' }
  | { type: 'parquet-wasm'; ok: true }
  | { type: 'parquet-wasm'; ok: false; message: string };

let resolveUrl: ((url: string) => void) | null = null;
const urlReceived = new Promise<string>((resolve) => {
  resolveUrl = resolve;
});
let ready: Promise<void> | null = null;

function describe(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

async function compile(url: string): Promise<WebAssembly.Module> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw parquetEngineError(`could not download ${url}: ${describe(cause)}`);
  }
  if (!response.ok) throw parquetEngineError(`HTTP ${response.status} for ${url}`);
  const type = response.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  try {
    if (type === 'application/wasm' && typeof WebAssembly.compileStreaming === 'function') {
      return await WebAssembly.compileStreaming(response);
    }
    return await WebAssembly.compile(await response.arrayBuffer());
  } catch (cause) {
    // A CompileError is a corrupt file or a CSP on this worker's script
    // without 'wasm-unsafe-eval'; the browser's message says which.
    throw parquetEngineError(`could not compile ${url}: ${describe(cause)}`);
  }
}

/** The worker's parquet-wasm, loaded once; a failure is kept, never retried in this worker. */
export function initParquetWasm(): Promise<void> {
  ready ??= urlReceived.then(async (url) => {
    const module = await compile(url);
    try {
      await init({ module_or_path: module });
    } catch (cause) {
      throw parquetEngineError(`could not start the module from ${url}: ${describe(cause)}`);
    }
  });
  return ready;
}

/**
 * Handle the page's init message: start loading at once (so a worker started
 * early has the module ready by its first read) and report the outcome.
 * Returns whether the message was the init message.
 */
export function handleInitMessage(
  data: unknown,
  post: (message: ParquetWorkerStatusMessage) => void,
): boolean {
  const message = data as Partial<InitParquetWasmMessage> | null;
  if (message?.type !== 'init-wasm' || typeof message.url !== 'string') return false;
  if (!resolveUrl) return true; // the URL is fixed for the worker's life
  resolveUrl(message.url);
  resolveUrl = null;
  initParquetWasm().then(
    () => post({ type: 'parquet-wasm', ok: true }),
    (error: unknown) =>
      post({
        type: 'parquet-wasm',
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }),
  );
  return true;
}

/** Tell the page this worker's code loaded (before it, an `error` event means it never ran). */
export function announceStarted(post: (message: ParquetWorkerStatusMessage) => void): void {
  post({ type: 'parquet-worker-started' });
}
