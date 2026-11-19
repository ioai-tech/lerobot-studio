// Test-only: read Parquet output on the test page to check an export. The
// product never compiles the WASM on the page; these assertions may.
import init, * as parquetWasm from 'parquet-wasm';
import { wasmUrl } from '../../src/platform/workers/wasmUrl';

let ready: Promise<typeof parquetWasm> | null = null;

export function getPageParquetWasm(): Promise<typeof parquetWasm> {
  ready ??= init({ module_or_path: wasmUrl }).then(() => parquetWasm);
  return ready;
}
