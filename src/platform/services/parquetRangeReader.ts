import type { ByteRangeResult, DataSource, RangedParquetRead, RangedParquetSource } from '@/core';
import {
  coalesceSpans,
  parseParquetFooter,
  parquetMetadataLength,
  PARQUET_TRAILER_BYTES,
  ParquetFooterError,
  planParquetRead,
  type ByteSpan,
  type ParquetFooter,
  type ParquetFooterErrorCode,
} from '../../core/parquet/footer';
import { RemoteSourceError } from '../datasource/signedUrls';

/** Bytes read from the end of a file to find its footer (and page index) in one request. */
export const FOOTER_PROBE_BYTES = 64 * 1024;
/** Column chunks closer than this are fetched in one request. */
export const COALESCE_GAP_BYTES = 64 * 1024;
/** Fetched bytes kept for the current file (switching episodes in one file reuses them). */
export const RANGE_CACHE_BYTES = 64 * 1024 * 1024;

/**
 * Why the viewer reads a parquet file whole instead of by range:
 * `RANGE_UNSUPPORTED` the server answered a range request with the whole
 * file; `RANGE_SIZE_UNKNOWN` the file size is unknown (no `sizeBytes`, no
 * readable `Content-Range`); `FILE_CHANGED` the file changed (size or ETag)
 * between reads, again after re-opening it once; the others are footers that
 * cannot be planned.
 */
export type ParquetRangeFallbackReason =
  'RANGE_UNSUPPORTED' | 'RANGE_SIZE_UNKNOWN' | 'FILE_CHANGED' | ParquetFooterErrorCode;

/** Internal signal: read this file whole (the bytes when a range read already returned them). */
export class RangeFallback extends Error {
  readonly reason: ParquetRangeFallbackReason;
  readonly wholeFile: Uint8Array | null;
  constructor(reason: ParquetRangeFallbackReason, path: string, wholeFile: Uint8Array | null) {
    super(`${reason}: reading ${path} whole`);
    this.name = 'RangeFallback';
    this.reason = reason;
    this.wholeFile = wholeFile;
  }
}

/**
 * A range read answered from another version of the file than the footer
 * (other size or ETag). Its bytes are never combined with the cached ones.
 */
export class ParquetFileChangedError extends Error {
  readonly code = 'FILE_CHANGED';
  readonly path: string;
  constructor(path: string, detail: string) {
    super(`FILE_CHANGED: ${path} changed between range reads (${detail})`);
    this.name = 'ParquetFileChangedError';
    this.path = path;
  }
}

/** The file version a footer was read from. */
interface FileVersion {
  path: string;
  size: number;
  etag: string | null;
}

interface Part {
  start: number;
  bytes: Uint8Array;
}

interface FileState extends FileVersion {
  footer: ParquetFooter;
  parts: Part[];
  cachedBytes: number;
  /** Reads in flight: concurrent reads of the same bytes share them. */
  inflight: Array<{ span: ByteSpan; done: Promise<void> }>;
}

/** A prepared ranged read: prefetched parts for the worker and what to decode. */
export interface PreparedRangedRead {
  source: RangedParquetSource;
  read: RangedParquetRead;
  /** Fetch bytes the worker asks for beyond `source.parts` (served from cache when possible). */
  fetchRange: (start: number, end: number) => Promise<Uint8Array>;
}

function overlaps(a: ByteSpan, b: ByteSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

function isWholeFile(result: ByteRangeResult, requested: number): boolean {
  return result.start === 0 && result.bytes.length === result.size && requested < result.size;
}

/**
 * Plans and fetches parquet byte ranges through `DataSource.readRange`: the
 * footer (one suffix read), then only the column chunks of the selected
 * columns in the row groups that hold the requested rows.
 */
export class ParquetRangeReader {
  private readonly source: DataSource;
  private file: FileState | null = null;
  private opening: { path: string; promise: Promise<FileState> } | null = null;
  private readonly refusedPaths = new Map<string, ParquetRangeFallbackReason>();
  private sourceRefusal: ParquetRangeFallbackReason | null = null;
  /** Paths whose decoder read found a new file version (see `takeChanged`). */
  private readonly changedPaths = new Set<string>();
  private readonly footerProbeBytes: number;
  private readonly coalesceGapBytes: number;

  constructor(
    source: DataSource,
    options: { footerProbeBytes?: number; coalesceGapBytes?: number } = {},
  ) {
    this.source = source;
    this.footerProbeBytes = options.footerProbeBytes ?? FOOTER_PROBE_BYTES;
    this.coalesceGapBytes = options.coalesceGapBytes ?? COALESCE_GAP_BYTES;
  }

  /** False when the source cannot read ranges (or a server ignored one). */
  get available(): boolean {
    return typeof this.source.readRange === 'function' && this.sourceRefusal === null;
  }

  /** The source-wide reason ranges are not used, when one was found. */
  get refusal(): ParquetRangeFallbackReason | null {
    return this.sourceRefusal;
  }

  cachedPath(): string | null {
    return this.file?.path ?? null;
  }

  clear(): void {
    this.file = null;
    this.opening = null;
  }

  /**
   * Prefetch what reading `columns` for rows [startRow, endRow) of `path`
   * needs. Throws `RangeFallback` when the file must be read whole.
   */
  async prepare(
    path: string,
    columns: string[],
    startRow: number,
    endRow: number,
  ): Promise<PreparedRangedRead> {
    if (!this.available) {
      throw new RangeFallback(this.sourceRefusal ?? 'RANGE_UNSUPPORTED', path, null);
    }
    const refused = this.refusedPaths.get(path);
    if (refused) throw new RangeFallback(refused, path, null);
    try {
      return await this.prepareOnce(path, columns, startRow, endRow);
    } catch (error) {
      if (!(error instanceof ParquetFileChangedError)) throw error;
    }
    // Re-open once: a new footer for the new version of the file.
    try {
      return await this.prepareOnce(path, columns, startRow, endRow);
    } catch (error) {
      if (!(error instanceof ParquetFileChangedError)) throw error;
      this.forget(path);
      throw new RangeFallback('FILE_CHANGED', path, null);
    }
  }

  /**
   * True once after a decoder read of `path` failed because the file changed:
   * the caller plans the read again (from a new footer) instead of failing.
   */
  takeChanged(path: string): boolean {
    return this.changedPaths.delete(path);
  }

  /** Drop what is cached for `path` (its footer and bytes). */
  forget(path: string): void {
    if (this.file?.path === path) this.file = null;
    if (this.opening?.path === path) this.opening = null;
  }

  private async prepareOnce(
    path: string,
    columns: string[],
    startRow: number,
    endRow: number,
  ): Promise<PreparedRangedRead> {
    const file = await this.open(path);
    const { footer } = file;
    const plan = planParquetRead(footer, columns, startRow, endRow);
    const end = endRow <= 0 ? footer.numRows : Math.min(endRow, footer.numRows);
    const start = Math.max(0, Math.min(startRow, end));
    const tail: ByteSpan = { start: footer.metadataStart, end: footer.fileSize };
    // The decoder reads whole column chunks (and their page indexes, when
    // the writer wrote them): fetch them together up front.
    const prefetch = [...plan.spans, ...plan.indexSpans];
    try {
      await this.ensure(file, prefetch, this.coalesceGapBytes);
    } catch (error) {
      if (error instanceof ParquetFileChangedError) this.forget(path);
      throw error;
    }
    const wanted = [...plan.spans, ...plan.indexSpans, tail];
    const parts = file.parts
      .filter((part) => wanted.some((span) => overlaps(span, toSpan(part))))
      .map((part) => ({ start: part.start, bytes: copyBuffer(part.bytes) }));
    return {
      source: { size: file.size, parts },
      read: {
        columns,
        rowGroups: plan.rowGroups,
        offset: start - plan.firstRow,
        limit: end - start,
      },
      // The decoder's own reads are of the version this plan was made from:
      // a changed file fails the read by name (the loader re-plans it once).
      fetchRange: async (from, to) => {
        try {
          const bytes = await this.bytesOf(file, from, to);
          return bytes.slice();
        } catch (error) {
          if (error instanceof ParquetFileChangedError) {
            this.forget(path);
            this.changedPaths.add(path);
          }
          throw error;
        }
      },
    };
  }

  private async open(path: string): Promise<FileState> {
    if (this.file?.path === path) return this.file;
    if (this.opening?.path === path) return this.opening.promise;
    const promise = this.readFooter(path);
    this.opening = { path, promise };
    try {
      const file = await promise;
      this.file = file;
      return file;
    } finally {
      if (this.opening?.promise === promise) this.opening = null;
    }
  }

  private async readFooter(path: string): Promise<FileState> {
    let probe: ByteRangeResult;
    try {
      probe = await this.source.readRange!(path, -this.footerProbeBytes);
    } catch (error) {
      if (error instanceof RemoteSourceError && error.code === 'RANGE_SIZE_UNKNOWN') {
        this.sourceRefusal = 'RANGE_SIZE_UNKNOWN';
        throw new RangeFallback('RANGE_SIZE_UNKNOWN', path, null);
      }
      throw error;
    }
    if (isWholeFile(probe, this.footerProbeBytes)) {
      this.sourceRefusal = 'RANGE_UNSUPPORTED';
      throw new RangeFallback('RANGE_UNSUPPORTED', path, probe.bytes);
    }
    if (probe.start < 0 || probe.start + probe.bytes.length !== probe.size) {
      // A footer probe must end at the end of the file.
      throw new RangeFallback('FOOTER_INCOMPLETE', path, null);
    }
    const version: FileVersion = { path, size: probe.size, etag: probe.etag ?? null };
    const size = probe.size;
    let tail = probe.bytes;
    let tailStart = probe.start;
    try {
      const needed = parquetMetadataLength(tail) + PARQUET_TRAILER_BYTES;
      if (needed > tail.length && needed <= size) {
        const restStart = size - needed;
        const rest = await this.readSpan(version, restStart, tailStart);
        const joined = new Uint8Array(rest.length + tail.length);
        joined.set(rest, 0);
        joined.set(tail, rest.length);
        tail = joined;
        tailStart = restStart;
      }
      const footer = parseParquetFooter(tail, size);
      return {
        ...version,
        footer,
        parts: [{ start: tailStart, bytes: tail }],
        cachedBytes: tail.length,
        inflight: [],
      };
    } catch (error) {
      if (error instanceof ParquetFooterError) {
        this.refusedPaths.set(path, error.code);
        throw new RangeFallback(error.code, path, size <= tail.length ? tail : null);
      }
      throw error;
    }
  }

  /**
   * Make `spans` available in `file.parts`: wait for reads already in flight
   * and fetch the rest (gaps up to `maxGap` merged into one request).
   */
  private async ensure(file: FileState, spans: ByteSpan[], maxGap: number): Promise<void> {
    const waits = file.inflight
      .filter((read) => spans.some((span) => overlaps(span, read.span)))
      .map((read) => read.done);
    const covered = [...file.parts.map(toSpan), ...file.inflight.map((read) => read.span)];
    for (const span of coalesceSpans(subtractSpans(spans, covered), maxGap)) {
      const entry = { span, done: Promise.resolve() };
      entry.done = this.fetchInto(file, span.start, span.end).finally(() => {
        file.inflight = file.inflight.filter((read) => read !== entry);
      });
      file.inflight.push(entry);
      waits.push(entry.done);
    }
    await Promise.all(waits);
  }

  private async bytesOf(file: FileState, start: number, end: number): Promise<Uint8Array> {
    await this.ensure(file, [{ start, end }], 0);
    const out = new Uint8Array(end - start);
    let filled = 0;
    for (const part of file.parts) {
      const partEnd = part.start + part.bytes.length;
      const from = Math.max(start, part.start);
      const to = Math.min(end, partEnd);
      if (from < to) {
        out.set(part.bytes.subarray(from - part.start, to - part.start), from - start);
        filled += to - from;
      }
    }
    if (filled < end - start) {
      // Evicted while waiting (cache limit): read the range directly.
      return this.readSpan(file, start, end);
    }
    return out;
  }

  private async fetchInto(file: FileState, start: number, end: number): Promise<void> {
    const bytes = await this.readSpan(file, start, end);
    if (file.cachedBytes + bytes.length > RANGE_CACHE_BYTES) {
      // Keep the footer; drop older chunks.
      file.parts = file.parts.slice(0, 1);
      file.cachedBytes = file.parts[0]!.bytes.length;
    }
    file.parts.push({ start, bytes });
    file.cachedBytes += bytes.length;
  }

  /**
   * The one way bytes [start, end) of a known file are read: the span must
   * lie inside the file (a negative start is never sent, as it would read a
   * suffix), and the answer must be exactly those bytes of the same version.
   */
  private async readSpan(version: FileVersion, start: number, end: number): Promise<Uint8Array> {
    const { path } = version;
    if (!(Number.isSafeInteger(start) && Number.isSafeInteger(end))) {
      throw new RangeFallback('FOOTER_INVALID', path, null);
    }
    if (start < 0 || end <= start || end > version.size) {
      throw new RangeFallback('FOOTER_INVALID', path, null);
    }
    const result = await this.source.readRange!(path, start, end);
    if (result.size !== version.size) {
      throw new ParquetFileChangedError(path, `size ${version.size} → ${result.size}`);
    }
    if (version.etag && result.etag && result.etag !== version.etag) {
      throw new ParquetFileChangedError(path, `ETag ${version.etag} → ${result.etag}`);
    }
    if (isWholeFile(result, end - start)) {
      this.sourceRefusal = 'RANGE_UNSUPPORTED';
      throw new RangeFallback('RANGE_UNSUPPORTED', path, result.bytes);
    }
    if (result.start !== start || result.bytes.length !== end - start) {
      throw new Error(
        `Range read of ${path} returned bytes ${result.start}+${result.bytes.length}, asked ${start}-${end}`,
      );
    }
    return result.bytes;
  }
}

/** Parts of `spans` not covered by `covered`. */
function subtractSpans(spans: readonly ByteSpan[], covered: readonly ByteSpan[]): ByteSpan[] {
  const sorted = [...covered].sort((a, b) => a.start - b.start);
  const out: ByteSpan[] = [];
  for (const span of spans) {
    let cursor = span.start;
    for (const cover of sorted) {
      if (cover.end <= cursor || cover.start >= span.end) continue;
      if (cover.start > cursor) out.push({ start: cursor, end: cover.start });
      cursor = Math.max(cursor, cover.end);
      if (cursor >= span.end) break;
    }
    if (cursor < span.end) out.push({ start: cursor, end: span.end });
  }
  return out;
}

function toSpan(part: Part): ByteSpan {
  return { start: part.start, end: part.start + part.bytes.length };
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}
