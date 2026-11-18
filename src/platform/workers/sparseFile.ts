/**
 * A Blob-shaped view of a parquet file of which only some byte ranges were
 * fetched (footer and the column chunks a read needs). parquet-wasm's async
 * reader only calls `size`, `slice()` and `arrayBuffer()`, so it decodes the
 * selected columns without the rest of the file. Bytes outside the prefetched
 * parts are fetched through `fetchRange`; without it such a read fails with
 * `RANGE_NOT_FETCHED`, never with zeros.
 */

/** Fetch bytes [start, end) of the file. */
export type FetchRange = (start: number, end: number) => Promise<Uint8Array>;

/** Fetched bytes of one file: each part starts at `start` in the file. */
export interface SparseFileParts {
  size: number;
  parts: Array<{ start: number; bytes: Uint8Array }>;
}

export class RangeNotFetchedError extends Error {
  readonly code = 'RANGE_NOT_FETCHED';
  constructor(start: number, end: number) {
    super(`Parquet reader asked for bytes ${start}-${end} that were not fetched`);
    this.name = 'RangeNotFetchedError';
  }
}

function clampOffset(value: number | undefined, size: number, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Math.trunc(value);
  return n < 0 ? Math.max(0, size + n) : Math.min(n, size);
}

export class SparseFile {
  private readonly file: SparseFileParts;
  private readonly fetchRange: FetchRange | null;
  private readonly from: number;
  private readonly to: number;

  constructor(
    file: SparseFileParts,
    fetchRange: FetchRange | null = null,
    from = 0,
    to = file.size,
  ) {
    this.file = file;
    this.fetchRange = fetchRange;
    this.from = from;
    this.to = to;
  }

  get size(): number {
    return this.to - this.from;
  }

  slice(start?: number, end?: number): SparseFile {
    const size = this.size;
    const s = clampOffset(start, size, 0);
    const e = Math.max(s, clampOffset(end, size, size));
    return new SparseFile(this.file, this.fetchRange, this.from + s, this.from + e);
  }

  /** The bytes of this view, fetching the parts not fetched yet. */
  async arrayBuffer(): Promise<ArrayBuffer> {
    const gaps = this.gaps();
    if (gaps.length > 0) {
      const fetchRange = this.fetchRange;
      if (!fetchRange) throw new RangeNotFetchedError(gaps[0]!.start, gaps[0]!.end);
      const fetched = await Promise.all(
        gaps.map(async (gap) => {
          const bytes = await fetchRange(gap.start, gap.end);
          if (bytes.length !== gap.end - gap.start) {
            throw new RangeNotFetchedError(gap.start, gap.end);
          }
          return { start: gap.start, bytes };
        }),
      );
      this.file.parts.push(...fetched);
    }
    return this.read().buffer as ArrayBuffer;
  }

  /** Byte ranges of this view not covered by any part. */
  gaps(): Array<{ start: number; end: number }> {
    const out: Array<{ start: number; end: number }> = [];
    let cursor = this.from;
    const parts = [...this.file.parts].sort((a, b) => a.start - b.start);
    for (const part of parts) {
      if (cursor >= this.to) break;
      const partEnd = part.start + part.bytes.length;
      if (partEnd <= cursor) continue;
      if (part.start > cursor) {
        out.push({ start: cursor, end: Math.min(part.start, this.to) });
      }
      cursor = Math.max(cursor, partEnd);
    }
    if (cursor < this.to) out.push({ start: cursor, end: this.to });
    return out;
  }

  read(): Uint8Array {
    const out = new Uint8Array(this.to - this.from);
    let cursor = this.from;
    const parts = [...this.file.parts].sort((a, b) => a.start - b.start);
    for (const part of parts) {
      if (cursor >= this.to) break;
      const partEnd = part.start + part.bytes.length;
      if (part.start > cursor || partEnd <= cursor) continue;
      const take = Math.min(partEnd, this.to) - cursor;
      out.set(
        part.bytes.subarray(cursor - part.start, cursor - part.start + take),
        cursor - this.from,
      );
      cursor += take;
    }
    if (cursor < this.to) throw new RangeNotFetchedError(this.from, this.to);
    return out;
  }
}
