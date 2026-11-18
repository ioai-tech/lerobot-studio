import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const EPISODES = path.join(
  here,
  'fixtures/datasets/lerobotv3/meta/episodes/chunk-000/file-000.parquet',
);

// The test helpers and scripts/parquetWasmNode.ts share one parquet-wasm
// module: concurrent cold calls must instantiate it once, or a later instance
// replaces the one objects of an earlier call still belong to.
it('instantiates the parquet WASM once for concurrent cold callers', async () => {
  const instantiate = vi.spyOn(WebAssembly, 'instantiate');
  const { getParquetWasmNode } = await import('./helpers/parquetWasmNode');
  const { readParquetToIPC } = await import('./helpers/parquet');
  const bytes = new Uint8Array(readFileSync(EPISODES));
  const results = await Promise.all([
    getParquetWasmNode(),
    readParquetToIPC(bytes.slice()),
    readParquetToIPC(bytes.slice()),
  ]);
  expect(results[1].byteLength).toBeGreaterThan(0);
  expect(instantiate).toHaveBeenCalledTimes(1);
  // A cold compile of the WASM (about 4 MB), slow under coverage.
}, 60_000);
