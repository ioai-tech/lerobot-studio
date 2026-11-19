/** The host's URL for the parquet WASM, if it serves the file itself. */
let override: string | null = null;
const listeners = new Set<() => void>();

/** The code of the error `setParquetWasmUrl` throws for a value that is not a URL. */
export const INVALID_PARQUET_WASM_URL = 'INVALID_PARQUET_WASM_URL';

function normalize(url: unknown): string | null {
  if (url === null) return null;
  if (url instanceof URL) return url.href;
  if (typeof url === 'string' && url.trim() !== '') {
    try {
      // Relative URLs are kept as given (resolved against the page when used),
      // but must parse as one.
      new URL(url, 'https://base.invalid/');
      return url;
    } catch {
      // fall through to the named error
    }
  }
  throw new TypeError(
    `${INVALID_PARQUET_WASM_URL}: setParquetWasmUrl expects an absolute or relative URL string, a URL, or null; got ${
      typeof url === 'string' ? JSON.stringify(url) : typeof url
    }`,
  );
}

/**
 * Serve the parquet WASM (`dist-lib/assets/parquet_wasm_bg-<hash>.wasm`) from
 * your own URL: a CDN, a copy under your static files, or a bundler that does
 * not rewrite `new URL(..., import.meta.url)`. Relative URLs resolve against
 * the page. Serve it as `application/wasm` (streaming compile) under a name
 * that changes with its content, cached for good. Call it before the viewer
 * opens or `preloadLeRobotViewer` runs. On a change, idle workers (a
 * prewarmed one, export's) are dropped; a viewer already open keeps the
 * workers it has. `null` restores the packaged file. Any other value than a
 * URL string, a URL or `null` throws a TypeError whose message starts with
 * `INVALID_PARQUET_WASM_URL`.
 *
 * @public
 */
export function setParquetWasmUrl(url: string | URL | null): void {
  const next = normalize(url);
  if (next === override) return;
  override = next;
  listeners.forEach((listener) => listener());
}

export function parquetWasmUrlOverride(): string | null {
  return override;
}

/** Run `listener` whenever the URL changes; returns the unsubscribe. */
export function onParquetWasmUrlChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
