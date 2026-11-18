/**
 * Minimal parquet footer reader: just enough of `FileMetaData` (Thrift
 * compact protocol) to plan HTTP Range reads — row groups, their row counts
 * and the byte range of every column chunk. Decoding stays with the parquet
 * worker; this module never reads page data.
 */

/** Byte length of the trailer: 4-byte footer length + `PAR1`. */
export const PARQUET_TRAILER_BYTES = 8;

/**
 * Largest serialized footer accepted. Real footers are kilobytes to a few
 * megabytes; a larger declared length is refused rather than read.
 */
export const MAX_PARQUET_FOOTER_BYTES = 64 * 1024 * 1024;

/** One column chunk of a row group: where its pages live in the file. */
export interface ParquetColumnChunk {
  /** Top-level column name (first element of `path_in_schema`). */
  column: string;
  /** Full leaf path (`observation.state.list.element`). */
  path: string[];
  /** First byte of the chunk (dictionary page when present, else first data page). */
  start: number;
  /** One past the last byte of the chunk. */
  end: number;
  /** Byte range of the chunk's offset index, when the writer wrote a page index. */
  offsetIndex?: { start: number; end: number };
  /** Byte range of the chunk's column index, when the writer wrote a page index. */
  columnIndex?: { start: number; end: number };
}

export interface ParquetRowGroup {
  /** Rows in this group. */
  numRows: number;
  /** Row index (in the file) of the group's first row. */
  firstRow: number;
  columns: ParquetColumnChunk[];
}

export interface ParquetFooter {
  /** Total rows in the file. */
  numRows: number;
  rowGroups: ParquetRowGroup[];
  /** Byte offset of the serialized `FileMetaData` (the footer starts here). */
  metadataStart: number;
  /**
   * Bytes holding every column / offset index when the writer wrote a page
   * index (the decoder loads them all), else null.
   */
  pageIndex: ByteSpan | null;
  /** File size in bytes. */
  fileSize: number;
}

/** Why a file cannot be planned for range reads (callers read it whole). */
export type ParquetFooterErrorCode =
  'NOT_PARQUET' | 'ENCRYPTED' | 'EXTERNAL_COLUMN_CHUNK' | 'FOOTER_INCOMPLETE' | 'FOOTER_INVALID';

export class ParquetFooterError extends Error {
  readonly code: ParquetFooterErrorCode;
  constructor(code: ParquetFooterErrorCode, message: string) {
    super(message);
    this.name = 'ParquetFooterError';
    this.code = code;
  }
}

const MAGIC = [0x50, 0x41, 0x52, 0x31]; // PAR1
const MAGIC_ENCRYPTED = [0x50, 0x41, 0x52, 0x45]; // PARE

function hasMagic(bytes: Uint8Array, at: number, magic: number[]): boolean {
  return magic.every((value, index) => bytes[at + index] === value);
}

/**
 * Length of the serialized metadata, read from the last 8 bytes of the file.
 * `tail` must end at the end of the file.
 */
export function parquetMetadataLength(tail: Uint8Array): number {
  if (tail.length < PARQUET_TRAILER_BYTES) {
    throw new ParquetFooterError('FOOTER_INCOMPLETE', 'Parquet trailer is shorter than 8 bytes');
  }
  const at = tail.length - 4;
  if (hasMagic(tail, at, MAGIC_ENCRYPTED)) {
    throw new ParquetFooterError('ENCRYPTED', 'Encrypted parquet footers are not range-readable');
  }
  if (!hasMagic(tail, at, MAGIC)) {
    throw new ParquetFooterError('NOT_PARQUET', 'File does not end with the parquet magic PAR1');
  }
  const view = new DataView(tail.buffer, tail.byteOffset + tail.length - 8, 4);
  const length = view.getUint32(0, true);
  if (length > MAX_PARQUET_FOOTER_BYTES) {
    throw new ParquetFooterError(
      'FOOTER_INVALID',
      `Parquet footer declares ${length} bytes, more than ${MAX_PARQUET_FOOTER_BYTES}`,
    );
  }
  return length;
}

// Thrift compact protocol types.
const T_STOP = 0;
const T_TRUE = 1;
const T_FALSE = 2;
const T_BYTE = 3;
const T_I16 = 4;
const T_I32 = 5;
const T_I64 = 6;
const T_DOUBLE = 7;
const T_BINARY = 8;
const T_LIST = 9;
const T_SET = 10;
const T_MAP = 11;
const T_STRUCT = 12;

class CompactReader {
  pos = 0;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  private byte(): number {
    if (this.pos >= this.bytes.length) {
      throw new ParquetFooterError('FOOTER_INVALID', 'Parquet footer ends unexpectedly');
    }
    return this.bytes[this.pos++]!;
  }

  /** Skip `count` bytes, refusing to run past the footer. */
  private advance(count: number): void {
    if (this.pos + count > this.bytes.length) {
      throw new ParquetFooterError('FOOTER_INVALID', 'Parquet footer ends unexpectedly');
    }
    this.pos += count;
  }

  /**
   * A collection's element count. Every element takes at least one byte, so
   * a count above the bytes left is refused before any element is read (a
   * hostile varint could otherwise claim 2^63 elements).
   */
  private count(size: number): number {
    if (size > this.bytes.length - this.pos) {
      throw new ParquetFooterError(
        'FOOTER_INVALID',
        `Parquet footer collection claims ${size} elements in ${this.bytes.length - this.pos} bytes`,
      );
    }
    return size;
  }

  /** Unsigned varint as a JS number (exact below 2^53). */
  varint(): number {
    let result = 0;
    let multiplier = 1;
    for (let shift = 0; shift < 64; shift += 7) {
      const b = this.byte();
      result += (b & 0x7f) * multiplier;
      if ((b & 0x80) === 0) {
        if (!Number.isSafeInteger(result)) {
          throw new ParquetFooterError('FOOTER_INVALID', 'Parquet footer integer is too large');
        }
        return result;
      }
      multiplier *= 128;
    }
    throw new ParquetFooterError('FOOTER_INVALID', 'Parquet footer varint is too long');
  }

  zigzag(): number {
    const n = this.varint();
    // (n >>> 1) ^ -(n & 1), without 32-bit truncation.
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }

  binary(): Uint8Array {
    const length = this.varint();
    if (length > this.bytes.length - this.pos) {
      throw new ParquetFooterError('FOOTER_INVALID', 'Parquet footer string overruns the footer');
    }
    const out = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }

  string(): string {
    return new TextDecoder().decode(this.binary());
  }

  listHeader(): { size: number; type: number } {
    const header = this.byte();
    const shortSize = header >> 4;
    return { size: this.count(shortSize === 15 ? this.varint() : shortSize), type: header & 0x0f };
  }

  /**
   * Iterate a struct's fields; `onField` returns true when it consumed the
   * value, otherwise the value is skipped.
   */
  struct(onField: (id: number, type: number) => boolean): void {
    let lastId = 0;
    for (;;) {
      const header = this.byte();
      const type = header & 0x0f;
      if (type === T_STOP) return;
      const delta = header >> 4;
      const id = delta === 0 ? this.zigzag() : lastId + delta;
      lastId = id;
      if (!onField(id, type)) this.skip(type);
    }
  }

  skip(type: number): void {
    switch (type) {
      case T_TRUE:
      case T_FALSE:
        return;
      case T_BYTE:
        this.advance(1);
        return;
      case T_I16:
      case T_I32:
      case T_I64:
        this.varint();
        return;
      case T_DOUBLE:
        this.advance(8);
        return;
      case T_BINARY:
        this.binary();
        return;
      case T_LIST:
      case T_SET: {
        const { size, type: elementType } = this.listHeader();
        for (let i = 0; i < size; i++) {
          this.skipElement(elementType);
        }
        return;
      }
      case T_MAP: {
        const size = this.count(this.varint());
        if (size === 0) return;
        const types = this.byte();
        for (let i = 0; i < size; i++) {
          this.skipElement(types >> 4);
          this.skipElement(types & 0x0f);
        }
        return;
      }
      case T_STRUCT:
        this.struct(() => false);
        return;
      default:
        throw new ParquetFooterError('FOOTER_INVALID', `Unknown thrift type ${type}`);
    }
  }

  /** Skip one collection element: booleans inside collections take one byte each. */
  private skipElement(type: number): void {
    if (type === T_TRUE || type === T_FALSE) this.advance(1);
    else this.skip(type);
  }

  list<T>(read: () => T): T[] {
    const { size } = this.listHeader();
    const out: T[] = [];
    for (let i = 0; i < size; i++) out.push(read());
    return out;
  }
}

interface RawColumnMeta {
  path: string[];
  totalCompressedSize: number;
  dataPageOffset: number;
  dictionaryPageOffset: number | null;
}

function readColumnMeta(reader: CompactReader): RawColumnMeta {
  const meta: RawColumnMeta = {
    path: [],
    totalCompressedSize: -1,
    dataPageOffset: -1,
    dictionaryPageOffset: null,
  };
  reader.struct((id, type) => {
    if (id === 3 && type === T_LIST) {
      meta.path = reader.list(() => reader.string());
      return true;
    }
    if (id === 7 && type === T_I64) {
      meta.totalCompressedSize = reader.zigzag();
      return true;
    }
    if (id === 9 && type === T_I64) {
      meta.dataPageOffset = reader.zigzag();
      return true;
    }
    if (id === 11 && type === T_I64) {
      meta.dictionaryPageOffset = reader.zigzag();
      return true;
    }
    return false;
  });
  return meta;
}

function readColumnChunk(reader: CompactReader): ParquetColumnChunk {
  let meta: RawColumnMeta | null = null;
  let external = false;
  let offsetIndexOffset: number | null = null;
  let offsetIndexLength: number | null = null;
  let columnIndexOffset: number | null = null;
  let columnIndexLength: number | null = null;
  reader.struct((id, type) => {
    if (id === 1 && type === T_BINARY) {
      external = reader.binary().length > 0;
      return true;
    }
    if (id === 3 && type === T_STRUCT) {
      meta = readColumnMeta(reader);
      return true;
    }
    if (id === 4 && type === T_I64) {
      offsetIndexOffset = reader.zigzag();
      return true;
    }
    if (id === 5 && type === T_I32) {
      offsetIndexLength = reader.zigzag();
      return true;
    }
    if (id === 6 && type === T_I64) {
      columnIndexOffset = reader.zigzag();
      return true;
    }
    if (id === 7 && type === T_I32) {
      columnIndexLength = reader.zigzag();
      return true;
    }
    return false;
  });
  if (external) {
    throw new ParquetFooterError(
      'EXTERNAL_COLUMN_CHUNK',
      'Column chunk lives in another file (file_path is set)',
    );
  }
  const m = meta as RawColumnMeta | null;
  if (!m || m.path.length === 0 || m.dataPageOffset < 0 || m.totalCompressedSize < 0) {
    throw new ParquetFooterError('FOOTER_INVALID', 'Column chunk metadata is incomplete');
  }
  // Some writers record dictionary_page_offset = 0 when there is none.
  const start =
    m.dictionaryPageOffset != null &&
    m.dictionaryPageOffset > 0 &&
    m.dictionaryPageOffset < m.dataPageOffset
      ? m.dictionaryPageOffset
      : m.dataPageOffset;
  const chunk: ParquetColumnChunk = {
    column: m.path[0]!,
    path: m.path,
    start,
    end: start + m.totalCompressedSize,
  };
  if (offsetIndexOffset != null && offsetIndexLength != null && offsetIndexLength !== 0) {
    chunk.offsetIndex = { start: offsetIndexOffset, end: offsetIndexOffset + offsetIndexLength };
  }
  if (columnIndexOffset != null && columnIndexLength != null && columnIndexLength !== 0) {
    chunk.columnIndex = { start: columnIndexOffset, end: columnIndexOffset + columnIndexLength };
  }
  return chunk;
}

function readRowGroup(reader: CompactReader): Omit<ParquetRowGroup, 'firstRow'> {
  let columns: ParquetColumnChunk[] = [];
  let numRows = -1;
  reader.struct((id, type) => {
    if (id === 1 && type === T_LIST) {
      columns = reader.list(() => readColumnChunk(reader));
      return true;
    }
    if (id === 3 && type === T_I64) {
      numRows = reader.zigzag();
      return true;
    }
    return false;
  });
  if (numRows < 0) throw new ParquetFooterError('FOOTER_INVALID', 'Row group has no num_rows');
  return { numRows, columns };
}

/**
 * Parse a parquet footer. `tail` holds the last bytes of the file (at least
 * the metadata plus the 8-byte trailer); `fileSize` is the whole file's size.
 */
export function parseParquetFooter(tail: Uint8Array, fileSize: number): ParquetFooter {
  const metadataLength = parquetMetadataLength(tail);
  const needed = metadataLength + PARQUET_TRAILER_BYTES;
  if (needed > fileSize - 4) {
    throw new ParquetFooterError('FOOTER_INVALID', 'Parquet footer length exceeds the file');
  }
  if (tail.length < needed) {
    throw new ParquetFooterError(
      'FOOTER_INCOMPLETE',
      `Parquet footer needs ${needed} trailing bytes, got ${tail.length}`,
    );
  }
  const metadata = tail.subarray(tail.length - needed, tail.length - PARQUET_TRAILER_BYTES);
  const reader = new CompactReader(metadata);
  let numRows = -1;
  let raw: Array<Omit<ParquetRowGroup, 'firstRow'>> = [];
  reader.struct((id, type) => {
    if (id === 3 && type === T_I64) {
      numRows = reader.zigzag();
      return true;
    }
    if (id === 4 && type === T_LIST) {
      raw = reader.list(() => readRowGroup(reader));
      return true;
    }
    return false;
  });
  if (numRows < 0) throw new ParquetFooterError('FOOTER_INVALID', 'Footer has no num_rows');
  let firstRow = 0;
  const rowGroups = raw.map((group) => {
    const out = { ...group, firstRow };
    firstRow += group.numRows;
    return out;
  });
  const metadataStart = fileSize - needed;
  // Every span the reader may fetch lies inside the data region
  // [4, metadataStart): never negative (which a range read would take as a
  // suffix), never past the footer.
  const inData = (span: ByteSpan) =>
    span.start >= 4 && span.start <= span.end && span.end <= metadataStart;
  for (const group of rowGroups) {
    for (const chunk of group.columns) {
      if (!inData(chunk)) {
        throw new ParquetFooterError('FOOTER_INVALID', 'Column chunk lies outside the data region');
      }
      for (const span of [chunk.offsetIndex, chunk.columnIndex]) {
        if (span && !(inData(span) && span.start < span.end)) {
          throw new ParquetFooterError('FOOTER_INVALID', 'Page index lies outside the data region');
        }
      }
    }
  }
  let pageIndex: ByteSpan | null = null;
  for (const group of rowGroups) {
    for (const chunk of group.columns) {
      for (const span of [chunk.offsetIndex, chunk.columnIndex]) {
        if (!span) continue;
        pageIndex = pageIndex
          ? { start: Math.min(pageIndex.start, span.start), end: Math.max(pageIndex.end, span.end) }
          : { ...span };
      }
    }
  }
  return { numRows, rowGroups, metadataStart, fileSize, pageIndex };
}

/** A half-open byte range [start, end). */
export interface ByteSpan {
  start: number;
  end: number;
}

/**
 * The row groups and byte ranges needed to read `columns` for rows
 * [startRow, endRow) (endRow ≤ 0 means to the end of the file).
 */
export interface ParquetReadPlan {
  /** Selected row group indexes, ascending. */
  rowGroups: number[];
  /** Row index (in the file) of the first selected group's first row. */
  firstRow: number;
  /** Rows covered by the selected groups. */
  rows: number;
  /** Column chunks of the selected columns in the selected groups, sorted. */
  spans: ByteSpan[];
  /** The file's page index (the decoder reads it whole); empty without one. */
  indexSpans: ByteSpan[];
  /** Columns that no row group contains. */
  missingColumns: string[];
}

export function planParquetRead(
  footer: ParquetFooter,
  columns: readonly string[],
  startRow: number,
  endRow: number,
): ParquetReadPlan {
  const wanted = new Set(columns);
  const end = endRow <= 0 ? footer.numRows : Math.min(endRow, footer.numRows);
  const start = Math.max(0, Math.min(startRow, end));
  const rowGroups: number[] = [];
  const spans: ByteSpan[] = [];
  const indexSpans: ByteSpan[] = footer.pageIndex ? [{ ...footer.pageIndex }] : [];
  const present = new Set<string>();
  footer.rowGroups.forEach((group, index) => {
    for (const chunk of group.columns) present.add(chunk.column);
    const groupEnd = group.firstRow + group.numRows;
    if (start >= end || !(group.firstRow < end && groupEnd > start)) return;
    rowGroups.push(index);
    for (const chunk of group.columns) {
      if (!wanted.has(chunk.column)) continue;
      spans.push({ start: chunk.start, end: chunk.end });
    }
  });
  spans.sort((a, b) => a.start - b.start);
  const firstGroup = rowGroups.length > 0 ? footer.rowGroups[rowGroups[0]!] : undefined;
  const rows = rowGroups.reduce((sum, index) => sum + footer.rowGroups[index]!.numRows, 0);
  return {
    rowGroups,
    firstRow: firstGroup?.firstRow ?? 0,
    rows,
    spans,
    indexSpans,
    missingColumns: columns.filter((column) => !present.has(column)),
  };
}

/**
 * Merge byte ranges whose gap is at most `maxGap` bytes, so a few nearby
 * column chunks become one request.
 */
export function coalesceSpans(spans: readonly ByteSpan[], maxGap: number): ByteSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: ByteSpan[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.start <= last.end + maxGap) {
      last.end = Math.max(last.end, span.end);
    } else {
      out.push({ ...span });
    }
  }
  return out;
}
