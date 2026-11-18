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
 * readable `Content-Range`); the others are footers that cannot be planned.
 */
export type ParquetRangeFallbackReason =
  'RANGE_UNSUPPORTED' | 'RANGE_SIZE_UNKNOWN' | ParquetFooterErrorCode;

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

interface Part {
  start: number;
  bytes: Uint8Array;
}

interface FileState {
  path: string;
  size: number;
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
    const file = await this.open(path);
    const { footer } = file;
    const plan = planParquetRead(footer, columns, startRow, endRow);
    const end = endRow <= 0 ? footer.numRows : Math.min(endRow, footer.numRows);
    const start = Math.max(0, Math.min(startRow, end));
    const tail: ByteSpan = { start: footer.metadataStart, end: footer.fileSize };
    // The decoder reads whole column chunks (and their page indexes, when
    // the writer wrote them): fetch them together up front.
    const prefetch = [...plan.spans, ...plan.indexSpans];
    await this.ensure(file, prefetch, this.coalesceGapBytes);
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
      fetchRange: async (from, to) => {
        const current = this.file === file ? file : await this.open(path);
        const bytes = await this.bytesOf(current, from, to);
        return bytes.slice();
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
    const size = probe.size;
    let tail = probe.bytes;
    let tailStart = probe.start;
    try {
      const needed = parquetMetadataLength(tail) + PARQUET_TRAILER_BYTES;
      if (needed > tail.length && needed <= size) {
        const rest = await this.source.readRange!(path, size - needed, tailStart);
        if (isWholeFile(rest, tailStart - (size - needed))) {
          this.sourceRefusal = 'RANGE_UNSUPPORTED';
          throw new RangeFallback('RANGE_UNSUPPORTED', path, rest.bytes);
        }
        const joined = new Uint8Array(rest.bytes.length + tail.length);
        joined.set(rest.bytes, 0);
        joined.set(tail, rest.bytes.length);
        tail = joined;
        tailStart = rest.start;
      }
      const footer = parseParquetFooter(tail, size);
      return {
        path,
        size,
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
      const result = await this.source.readRange!(file.path, start, end);
      return result.bytes;
    }
    return out;
  }

  private async fetchInto(file: FileState, start: number, end: number): Promise<void> {
    const result = await this.source.readRange!(file.path, start, end);
    if (isWholeFile(result, end - start)) {
      this.sourceRefusal = 'RANGE_UNSUPPORTED';
      throw new RangeFallback('RANGE_UNSUPPORTED', file.path, result.bytes);
    }
    if (result.start !== start || result.bytes.length !== end - start) {
      throw new Error(
        `Range read of ${file.path} returned bytes ${result.start}+${result.bytes.length}, asked ${start}-${end}`,
      );
    }
    if (file.cachedBytes + result.bytes.length > RANGE_CACHE_BYTES) {
      // Keep the footer; drop older chunks.
      file.parts = file.parts.slice(0, 1);
      file.cachedBytes = file.parts[0]!.bytes.length;
    }
    file.parts.push({ start, bytes: result.bytes });
    file.cachedBytes += result.bytes.length;
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
