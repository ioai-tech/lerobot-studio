import type { ProgressHandler } from '../../core/datasource/types';
import {
  assertMaterializable,
  DataSourceSafetyError,
  type DataSourceSafetyLimits,
} from './inputSafety';

/** Refresh signed URLs this long before they expire. */
export const URL_REFRESH_MARGIN_MS = 60_000;
/** Never schedule proactive refreshes closer together than this. */
const MIN_PROACTIVE_REFRESH_DELAY_MS = 5_000;

/** Machine-readable reasons a remote read failed after its one retry. */
export type RemoteSourceErrorCode = 'HTTP_STATUS' | 'NETWORK' | 'REFRESH_FAILED';

/** A remote file could not be read, even after refreshing its URL once. */
export class RemoteSourceError extends Error {
  readonly name = 'RemoteSourceError';
  readonly code: RemoteSourceErrorCode;
  /** Logical dataset path that failed. */
  readonly path: string;
  /** HTTP status of the last response, when there was one. */
  readonly status?: number;

  constructor(
    code: RemoteSourceErrorCode,
    path: string,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.path = path;
    this.status = options.status;
  }
}

/** Parse an ISO 8601 expiry; invalid or missing values mean "unknown". */
export function parseExpiresAt(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function isNearExpiry(expiresAtMs: number | null, now = Date.now()): boolean {
  return expiresAtMs != null && expiresAtMs - now <= URL_REFRESH_MARGIN_MS;
}

/** True for responses that mean "the signature is no longer accepted". */
export function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

/** Runs one task at a time; concurrent callers share the in-flight promise. */
export class Coalescer {
  private inFlight: Promise<void> | null = null;

  run(task: () => Promise<void>): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = task().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }
}

/** Listener registry for `DataSource.subscribeUrlChanges`. */
export class UrlChangeEmitter {
  private readonly listeners = new Set<(paths: readonly string[]) => void>();

  get size(): number {
    return this.listeners.size;
  }

  subscribe(listener: (paths: readonly string[]) => void, onChange?: () => void): () => void {
    this.listeners.add(listener);
    onChange?.();
    return () => {
      this.listeners.delete(listener);
      onChange?.();
    };
  }

  emit(paths: readonly string[]): void {
    if (paths.length === 0) return;
    for (const listener of [...this.listeners]) {
      try {
        listener(paths);
      } catch (error) {
        console.error('URL change listener failed', error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

/**
 * Schedules one refresh shortly before the earliest known expiry while at
 * least one consumer holds URLs (a playing video keeps requesting ranges with
 * the URL it was given).
 */
export class ProactiveRefreshTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly earliestExpiry: () => number | null;
  private readonly refresh: () => Promise<void>;
  private readonly active: () => boolean;

  constructor(
    earliestExpiry: () => number | null,
    refresh: () => Promise<void>,
    active: () => boolean,
  ) {
    this.earliestExpiry = earliestExpiry;
    this.refresh = refresh;
    this.active = active;
  }

  reschedule(): void {
    this.cancel();
    if (!this.active()) return;
    const expiry = this.earliestExpiry();
    if (expiry == null) return;
    const delay = Math.max(
      MIN_PROACTIVE_REFRESH_DELAY_MS,
      expiry - URL_REFRESH_MARGIN_MS - Date.now(),
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh()
        .catch((error) => console.warn('Proactive URL refresh failed', error))
        .finally(() => this.reschedule());
    }, delay);
  }

  cancel(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/**
 * Fetch `path` with one refresh-and-retry: a 401/403 or a network failure
 * (signed-URL hosts often omit CORS headers on 403, which surfaces as a
 * TypeError) triggers `refresh` once, then the read is retried once with the
 * new URL. A second failure throws `RemoteSourceError`.
 */
export async function fetchWithRefresh(
  path: string,
  getUrl: () => Promise<string>,
  refresh: (() => Promise<void>) | null,
  init?: RequestInit,
): Promise<Response> {
  let lastStatus: number | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) {
      if (!refresh) break;
      try {
        await refresh();
      } catch (error) {
        throw new RemoteSourceError(
          'REFRESH_FAILED',
          path,
          `Could not refresh the URL of ${path}`,
          {
            status: lastStatus,
            cause: error,
          },
        );
      }
    }
    const url = await getUrl();
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      lastError = error;
      lastStatus = undefined;
      continue;
    }
    if (response.ok) return response;
    lastStatus = response.status;
    lastError = undefined;
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    if (!isAuthFailure(response.status)) break;
  }
  if (lastStatus !== undefined) {
    throw new RemoteSourceError('HTTP_STATUS', path, `HTTP ${lastStatus} fetching ${path}`, {
      status: lastStatus,
    });
  }
  throw new RemoteSourceError('NETWORK', path, `Network error fetching ${path}`, {
    cause: lastError,
  });
}

/** Read a response body into memory within the materialization limits. */
export async function readResponseBytes(
  res: Response,
  path: string,
  limits: Readonly<DataSourceSafetyLimits>,
  onProgress?: ProgressHandler,
): Promise<Uint8Array> {
  const contentLength = res.headers.get('content-length');
  const total = contentLength ? Number(contentLength) : undefined;
  if (total !== undefined && (!Number.isSafeInteger(total) || total < 0)) {
    throw new DataSourceSafetyError('MANIFEST_INVALID', 'Response has an invalid content length', {
      path,
      contentLength,
    });
  }
  assertMaterializable(path, total, limits);
  if (!res.body) throw new Error(`HTTP response has no readable body fetching ${path}`);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  onProgress?.({ phase: 'download', loaded: 0, total, message: path });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    if (loaded > limits.maxMaterializedBytes) {
      await reader.cancel();
      throw new DataSourceSafetyError(
        'MATERIALIZED_SIZE_LIMIT',
        'Remote file exceeded the in-memory size limit while downloading',
        { path, loaded, limit: limits.maxMaterializedBytes },
      );
    }
    chunks.push(value);
    onProgress?.({ phase: 'download', loaded, total, message: path });
  }

  const result = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Normalize a logical dataset path (`./a//b` → `a/b`). */
export function normalizeLogicalPath(path: string): string {
  let normalized = path.replace(/\\/g, '/');
  normalized = normalized.replace(/^\.\/+/, '');
  normalized = normalized.replace(/\/{2,}/g, '/');
  normalized = normalized.replace(/^\/+/, '');
  return normalized;
}
