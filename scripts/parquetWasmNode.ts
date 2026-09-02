import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let initialized: Promise<typeof import('parquet-wasm/esm')> | null = null;

/**
 * Initialize the ESM build of parquet-wasm so it works in Node.
 *
 * The default `parquet-wasm` entry is a CJS bundle that references `module` at
 * module evaluation time and throws in ESM. The `/esm` subpath ships the
 * proper ESM + separate wasm file we can fetch explicitly.
 */
export async function getParquetWasmNode(): Promise<typeof import('parquet-wasm/esm')> {
  if (!initialized) {
    initialized = (async () => {
      const mod = await import('parquet-wasm/esm');
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const wasmPath = path.resolve(
        currentDir,
        '../node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm',
      );
      const wasmFile = await fs.readFile(wasmPath);
      const init = mod.default as unknown as (opts: {
        module_or_path: ArrayBuffer;
      }) => Promise<unknown>;
      await init({
        module_or_path: wasmFile.buffer.slice(
          wasmFile.byteOffset,
          wasmFile.byteOffset + wasmFile.byteLength,
        ),
      });
      return mod;
    })();
  }
  return initialized;
}
