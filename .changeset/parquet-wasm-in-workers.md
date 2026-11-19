---
'@ioai/lerobot-studio': minor
---

The Parquet reader's WebAssembly is a real file, downloaded and compiled only in the workers:

- The package ships `dist-lib/assets/parquet_wasm_bg-<hash>.wasm` instead of a 6.6 MB JavaScript chunk holding it as a base64 `data:` URL. Vite, webpack 5, Turbopack (Next.js, also under a `basePath`) and Rollup emit it with their own hashed name; no configuration is needed. It transfers 31% less (1.17 MB brotli, from 1.69 MB) and the npm tarball is 20% smaller (2.43 MB, from 3.03 MB).
- The page no longer fetches or compiles the WASM, and no longer copies it to each worker. Each worker fetches it (the HTTP cache serves later workers and visits) and compiles it while it streams when it is served as `application/wasm`. A page's Content Security Policy needs neither `'wasm-unsafe-eval'` nor `connect-src data:`; a CSP sent with the worker scripts themselves needs `'wasm-unsafe-eval'`.
- Export writes Parquet in a worker too, so nothing is compiled on the page.
- `setParquetWasmUrl(url)` serves the WASM from your own URL (a CDN, or a copy under your static files).
- `preloadLeRobotViewer()` loads the viewer's layout and loader code and starts one Parquet worker before a data source exists; the next viewer adopts it, and an unadopted worker is terminated after 30 s. The viewer calls it when it mounts; hosts call it earlier, at navigation or on intent.
- A Parquet reader that cannot load (a worker script blocked or missing, a WASM that cannot be downloaded or compiled, a message that cannot be read) ends the open with the new `onFatalError` code `PARQUET_ENGINE_UNAVAILABLE`, naming the cause, instead of an invalid-file error or a viewer that waits forever. A worker that failed does not download again; the next open starts a new one.
- The metadata read limiter frees its slot also when a host's `readBytes` throws instead of rejecting.
