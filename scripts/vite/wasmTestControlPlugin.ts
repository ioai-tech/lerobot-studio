import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Browser-test control over how the dev server answers the parquet WASM and
 * the worker scripts, so tests can see and shape what the workers fetch
 * (requests from a worker never pass the page's `fetch`):
 *
 * - `GET /__wasm-test?mode=<mode>[&reset=1]` sets the mode and answers
 *   `{ mode, wasmRequests, selfHostedRequests }` (counts since the last reset).
 *   Modes: `normal`; `corrupt` (the WASM answers with bytes that do not
 *   compile); `missing` (404); `worker-csp` (worker scripts are sent with a
 *   Content-Security-Policy that allows scripts but not 'wasm-unsafe-eval').
 * - `GET /__wasm-test/self-hosted.wasm` serves the real WASM, as a host's own
 *   copy would be (counted as `selfHostedRequests`).
 */
export function wasmTestControlPlugin(): Plugin {
  const wasmFile = path.resolve(
    import.meta.dirname,
    '../../node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm',
  );
  let mode = 'normal';
  let wasmRequests = 0;
  let selfHostedRequests = 0;
  return {
    name: 'wasm-test-control',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/__wasm-test') {
          if (url.searchParams.get('reset')) {
            wasmRequests = 0;
            selfHostedRequests = 0;
          }
          mode = url.searchParams.get('mode') ?? mode;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ mode, wasmRequests, selfHostedRequests }));
          return;
        }
        if (url.pathname === '/__wasm-test/self-hosted.wasm') {
          selfHostedRequests += 1;
          res.setHeader('Content-Type', 'application/wasm');
          res.setHeader('Cache-Control', 'no-store');
          res.end(fs.readFileSync(wasmFile));
          return;
        }
        if (url.pathname.endsWith('.wasm') && url.pathname.includes('parquet_wasm_bg')) {
          wasmRequests += 1;
          res.setHeader('Cache-Control', 'no-store');
          if (mode === 'missing') {
            res.statusCode = 404;
            res.end('not found');
            return;
          }
          if (mode === 'corrupt') {
            res.setHeader('Content-Type', 'application/wasm');
            res.end(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 99, 99, 99]));
            return;
          }
        }
        if (mode === 'worker-csp' && url.search.includes('worker_file')) {
          // A full answer, not a 304 that would keep a cached copy's headers.
          delete req.headers['if-none-match'];
          delete req.headers['if-modified-since'];
          // What a host's site-wide policy does to the worker scripts: they
          // may run and import, but not compile WebAssembly.
          res.setHeader('Content-Security-Policy', "script-src 'self' 'unsafe-inline'");
        }
        next();
      });
    },
  };
}
