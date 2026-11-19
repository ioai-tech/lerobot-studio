// `no-inline` keeps the .wasm a real file even in Vite library mode (which
// otherwise inlines every asset as base64). The emitted chunk then reads
// `new URL("assets/parquet_wasm_bg-<hash>.wasm", import.meta.url)`, which
// webpack 5, Turbopack, Vite and Rollup all rewrite to their own hashed asset.
export { default as wasmUrl } from 'parquet-wasm/esm/parquet_wasm_bg.wasm?url&no-inline';
