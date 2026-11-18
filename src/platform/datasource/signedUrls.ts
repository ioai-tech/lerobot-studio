import type { ByteRangeResult, ProgressHandler } from '../../core/datasource/types';
import {
  assertMaterializable,
  DataSourceSafetyError,
  type DataSourceSafetyLimits,
} from './inputSafety';

/** Refresh signed URLs this long before they expire. */
export const URL_REFRESH_MARGIN_MS = 60_000;
/** Never schedule proactive refreshes closer together than this. */
const MIN_PROACTIVE_REFRESH_DELAY_MS = 5_000;

/**
 * Machine-readable reasons a remote read failed after its one retry.
 * `RANGE_SIZE_UNKNOWN`: a range read of a file whose size is unknown (the
 * manifest has no `sizeBytes` and the response's `Content-Range` is not
 * readable; cross-origin servers must list it in
 * `Access-Control-Expose-Headers`).
 */
export type RemoteSourceErrorCode =
  'HTTP_STATUS' | 'NETWORK' | 'REFRESH_FAILED' | 'RANGE_SIZE_UNKNOWN';

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

/**
 * Never refresh because of a near expiry more often than this: a refresh that
 * returns URLs which still expire within the margin must not turn every read
 * into another refresh.
 */
export const MIN_EXPIRY_REFRESH_INTERVAL_MS = 30_000;

/**
 * Runs one refresh at a time; concurrent callers share the in-flight promise.
 * Each successful refresh bumps `generation`, so a read that got its URL
 * before a refresh finished retries with the new URL instead of starting
 * another refresh.
 */
export class Coalescer {
  private inFlight: Promise<void> | null = null;
  /** Count of successful refreshes. */
  generation = 0;
  private lastSuccessAt = -Infinity;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  run(task: () => Promise<void>): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = task()
        .then(() => {
          this.generation++;
          this.lastSuccessAt = this.now();
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
  }

  /** Refresh unless one already succeeded after generation `seen` (then reuse it). */
  runSince(seen: number, task: () => Promise<void>): Promise<void> {
    if (this.generation !== seen && !this.inFlight) return Promise.resolve();
    return this.run(task);
  }

  /** Whether an expiry this close justifies a refresh now (rate-limited after a refresh). */
  shouldRefreshForExpiry(expiresAtMs: number | null): boolean {
    const now = this.now();
    return (
      isNearExpiry(expiresAtMs, now) && now - this.lastSuccessAt >= MIN_EXPIRY_REFRESH_INTERVAL_MS
    );
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

/** Longest wait between proactive refresh attempts that did not help. */
const MAX_PROACTIVE_REFRESH_DELAY_MS = 5 * 60_000;

/**
 * Schedules one refresh shortly before the earliest known expiry while at
 * least one consumer holds URLs (a playing video keeps requesting ranges with
 * the URL it was given). A refresh that fails, or that leaves the earliest
 * expiry inside the margin, backs off exponentially instead of re-firing.
 */
export class ProactiveRefreshTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly earliestExpiry: () => number | null;
  private readonly refresh: () => Promise<void>;
  private readonly active: () => boolean;
  private failures = 0;

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
    const backoff = Math.min(
      MAX_PROACTIVE_REFRESH_DELAY_MS,
      MIN_PROACTIVE_REFRESH_DELAY_MS * 2 ** this.failures,
    );
    const delay = Math.max(backoff, expiry - URL_REFRESH_MARGIN_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh()
        .then(() => {
          // Still expiring within the margin: the refresh did not help.
          this.failures = isNearExpiry(this.earliestExpiry()) ? this.failures + 1 : 0;
        })
        .catch((error) => {
          this.failures++;
          console.warn('Proactive URL refresh failed', error);
        })
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

/** How a fetch renews URLs: the current refresh generation, and a refresh since a generation. */
export interface UrlRefresher {
  generation(): number;
  refreshSince(seenGeneration: number): Promise<void>;
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
  refresher: UrlRefresher | null,
  init?: RequestInit,
): Promise<Response> {
  let lastStatus: number | undefined;
  let lastError: unknown;
  let seenGeneration = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) {
      if (!refresher) break;
      try {
        // A refresh that finished after this read got its URL already renewed it.
        await refresher.refreshSince(seenGeneration);
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
    // The URL belongs to the refresh generation current when it was handed out.
    if (attempt === 0) seenGeneration = refresher?.generation() ?? 0;
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

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+|\*)$/;

/**
 * Read bytes [start, end) of a remote file (see `DataSource.readRange`) with
 * the same one refresh-and-retry as `fetchWithRefresh`. With a known size the
 * request is an explicit `bytes=a-b` range (a CORS-safelisted header); without
 * one, a negative `start` becomes a suffix range and the size comes from
 * `Content-Range`. A server that ignores ranges answers 200: the whole file is
 * returned and the caller sees `bytes.length === size`.
 */
export async function fetchByteRange(
  path: string,
  getUrl: () => Promise<string>,
  refresher: UrlRefresher | null,
  knownSize: number | null,
  start: number,
  end: number | undefined,
  limits: Readonly<DataSourceSafetyLimits>,
): Promise<ByteRangeResult> {
  if (!Number.isSafeInteger(start) || (end !== undefined && !Number.isSafeInteger(end))) {
    throw new RangeError(`readRange(${path}): start and end must be integers`);
  }
  let header: string;
  let expectedStart: number | null;
  if (knownSize != null) {
    const from = start < 0 ? Math.max(0, knownSize + start) : Math.min(start, knownSize);
    const to =
      start < 0 || end === undefined ? knownSize : Math.max(from, Math.min(end, knownSize));
    if (to <= from) return { bytes: new Uint8Array(0), start: from, size: knownSize };
    header = `bytes=${from}-${to - 1}`;
    expectedStart = from;
  } else if (start < 0) {
    header = `bytes=-${-start}`;
    expectedStart = null;
  } else {
    if (end !== undefined && end <= start) {
      throw new RangeError(`readRange(${path}): empty range on a file of unknown size`);
    }
    header = end === undefined ? `bytes=${start}-` : `bytes=${start}-${end - 1}`;
    expectedStart = start;
  }
  const res = await fetchWithRefresh(path, getUrl, refresher, { headers: { Range: header } });
  const bytes = await readResponseBytes(res, path, limits);
  if (res.status !== 206) {
    // The server ignored the range and sent the whole file.
    return { bytes, start: 0, size: bytes.length };
  }
  const contentRange = CONTENT_RANGE.exec(res.headers.get('content-range') ?? '');
  const rangeStart = contentRange ? Number(contentRange[1]) : expectedStart;
  const size =
    contentRange && contentRange[3] !== '*' ? Number(contentRange[3]) : (knownSize ?? null);
  if (rangeStart == null || size == null) {
    throw new RemoteSourceError(
      'RANGE_SIZE_UNKNOWN',
      path,
      `Cannot place a range read of ${path}: no size in the manifest and no readable Content-Range`,
      { status: res.status },
    );
  }
  return { bytes, start: rangeStart, size };
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
