/**
 * Load parquet-wasm with explicit WASM URL so Vite/dev server returns the real .wasm
 * instead of index.html (which causes "expected magic word 00 61 73 6d, found 3c 21 64 6f").
 * Workers get WASM via workerManager; main-thread export uses this loader.
 *
 * All imports are dynamic to keep parquet-wasm out of the entry's static dependency graph,
 * preventing Vite from adding a blocking modulepreload for the large wasm chunk.
 */

let initPromise: Promise<typeof import('parquet-wasm')> | null = null;

export async function getParquetWasm(): Promise<typeof import('parquet-wasm')> {
  if (!initPromise) {
    const [{ wasmUrl }, mod] = await Promise.all([
      import('../workers/wasmUrl'),
      import('parquet-wasm'),
    ]);
    initPromise = (
      mod.default as (opts?: { module_or_path: string | ArrayBuffer }) => Promise<unknown>
    )({
      module_or_path: wasmUrl,
    }).then(() => mod);
  }
  return initPromise;
}
