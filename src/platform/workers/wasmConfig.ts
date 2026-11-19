/** The host's URL for the parquet WASM, if it serves the file itself. */
let override: string | null = null;

/**
 * Serve the parquet WASM (`dist-lib/assets/parquet_wasm_bg-<hash>.wasm`) from
 * your own URL: a CDN, a copy under your static files, or a bundler that does
 * not rewrite `new URL(..., import.meta.url)`. Relative URLs resolve against
 * the page. Serve it as `application/wasm` (streaming compile) under a name
 * that changes with its content, cached for good. Call it before the viewer
 * opens or `preloadLeRobotViewer` runs; workers started earlier keep the URL
 * they were given. `null` restores the packaged file.
 *
 * @public
 */
export function setParquetWasmUrl(url: string | URL | null): void {
  override = url === null ? null : String(url);
}

export function parquetWasmUrlOverride(): string | null {
  return override;
}
