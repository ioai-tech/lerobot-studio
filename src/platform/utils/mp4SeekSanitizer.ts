/**
 * Browser <video> seeking trusts the MP4 sync-sample table (stss). Some
 * collectors (macOS VideoToolbox / OpenCV) mark many P-frames as sync samples
 * even though the bitstream only has a couple of IDR NAL units. Seeking then
 * lands on a non-decodable sample and the picture freezes on the first frame.
 *
 * Playback rewrites stss to the real IDR samples. Export still uses the original
 * bytes via readFileBytes().
 */

const FTYP = 0x66747970;
const MOOV = 0x6d6f6f76;
const TRAK = 0x7472616b;
const MDIA = 0x6d646961;
const MINF = 0x6d696e66;
const STBL = 0x7374626c;
const STSD = 0x73747364;
const STSS = 0x73747373;
const STSC = 0x73747363;
const STSZ = 0x7374737a;
const STCO = 0x7374636f;
const CO64 = 0x636f3634;
const AVC1 = 0x61766331;
const AVC3 = 0x61766333;
const AVCC = 0x61766343;
const FREE = 0x66726565;

const NAL_IDR = 5;
const MAX_TABLE_ENTRIES = 1_000_000;

export type Mp4AvcSeekInfo = {
  sampleCount: number;
  idrSamples: number[];
  stssSamples: number[] | null;
  nalLengthSize: number;
};

type Box = {
  offset: number;
  size: number;
  type: number;
  headerSize: number;
};

function looksLikeMp4(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) return 0;
  return viewOf(bytes).getUint32(offset);
}

function u64(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 8 > bytes.length) return 0;
  const dv = viewOf(bytes);
  const high = dv.getUint32(offset);
  const low = dv.getUint32(offset + 4);
  return high * 0x100000000 + low;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  viewOf(bytes).setUint32(offset, value);
}

function readBox(bytes: Uint8Array, offset: number): Box | null {
  if (offset < 0 || offset + 8 > bytes.length) return null;
  let size = u32(bytes, offset);
  const type = u32(bytes, offset + 4);
  let headerSize = 8;
  if (size === 1) {
    if (offset + 16 > bytes.length) return null;
    size = u64(bytes, offset + 8);
    headerSize = 16;
  } else if (size === 0) {
    size = bytes.length - offset;
  }
  if (size < headerSize || offset + size > bytes.length) return null;
  return { offset, size, type, headerSize };
}

function* childBoxes(bytes: Uint8Array, parent: Box, payloadSkip = 0): Generator<Box> {
  let offset = parent.offset + parent.headerSize + payloadSkip;
  const end = parent.offset + parent.size;
  while (offset + 8 <= end) {
    const box = readBox(bytes, offset);
    if (!box || box.offset + box.size > end) break;
    yield box;
    offset += box.size;
  }
}

function findChild(bytes: Uint8Array, parent: Box, type: number, payloadSkip = 0): Box | null {
  for (const child of childBoxes(bytes, parent, payloadSkip)) {
    if (child.type === type) return child;
  }
  return null;
}

function childPayloadSkip(type: number): number {
  if (type === STSD) return 8;
  if (isAvcSampleEntry(type)) return 78;
  return 0;
}

function findDescendant(bytes: Uint8Array, parent: Box, type: number, payloadSkip = 0): Box | null {
  const queue: Array<{ box: Box; skip: number }> = [{ box: parent, skip: payloadSkip }];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const child of childBoxes(bytes, current.box, current.skip)) {
      if (child.type === type) return child;
      queue.push({ box: child, skip: childPayloadSkip(child.type) });
    }
  }
  return null;
}

function encodeBox(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  writeU32(out, 0, out.length);
  writeU32(out, 4, type);
  out.set(payload, 8);
  return out;
}

function encodeStss(samples: number[]): Uint8Array {
  const payload = new Uint8Array(8 + samples.length * 4);
  writeU32(payload, 0, 0);
  writeU32(payload, 4, samples.length);
  samples.forEach((sample, index) => {
    writeU32(payload, 8 + index * 4, sample);
  });
  return encodeBox(STSS, payload);
}

function encodeFree(size: number): Uint8Array {
  const out = new Uint8Array(size);
  writeU32(out, 0, size);
  writeU32(out, 4, FREE);
  return out;
}

function readStssSamples(bytes: Uint8Array, stss: Box): number[] | null {
  const payload = stss.offset + stss.headerSize;
  if (payload + 8 > stss.offset + stss.size) return null;
  const count = u32(bytes, payload + 4);
  if (count > MAX_TABLE_ENTRIES) return null;
  const needed = payload + 8 + count * 4;
  if (needed > stss.offset + stss.size) return null;
  const samples: number[] = [];
  for (let i = 0; i < count; i++) {
    samples.push(u32(bytes, payload + 8 + i * 4));
  }
  return samples;
}

function sameSampleList(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function readAvcLengthSize(bytes: Uint8Array, stsd: Box): number | null {
  const avcc = findDescendant(bytes, stsd, AVCC, 8);
  if (!avcc) return null;
  const config = avcc.offset + avcc.headerSize;
  if (config + 5 > avcc.offset + avcc.size) return null;
  return (bytes[config + 4] & 3) + 1;
}

function readSampleSizes(bytes: Uint8Array, stsz: Box): number[] | null {
  const payload = stsz.offset + stsz.headerSize;
  if (payload + 12 > stsz.offset + stsz.size) return null;
  const defaultSize = u32(bytes, payload + 4);
  const count = u32(bytes, payload + 8);
  if (count <= 0 || count > MAX_TABLE_ENTRIES) return null;
  if (defaultSize !== 0) {
    return new Array<number>(count).fill(defaultSize);
  }
  if (payload + 12 + count * 4 > stsz.offset + stsz.size) return null;
  const sizes: number[] = [];
  for (let i = 0; i < count; i++) {
    sizes.push(u32(bytes, payload + 12 + i * 4));
  }
  return sizes;
}

function readChunkOffsets(bytes: Uint8Array, stbl: Box): number[] | null {
  const stco = findChild(bytes, stbl, STCO, 0);
  if (stco) {
    const payload = stco.offset + stco.headerSize;
    if (payload + 8 > stco.offset + stco.size) return null;
    const count = u32(bytes, payload + 4);
    if (count > MAX_TABLE_ENTRIES) return null;
    if (payload + 8 + count * 4 > stco.offset + stco.size) return null;
    const offsets: number[] = [];
    for (let i = 0; i < count; i++) offsets.push(u32(bytes, payload + 8 + i * 4));
    return offsets;
  }
  const co64 = findChild(bytes, stbl, CO64, 0);
  if (!co64) return null;
  const payload = co64.offset + co64.headerSize;
  if (payload + 8 > co64.offset + co64.size) return null;
  const count = u32(bytes, payload + 4);
  if (count > MAX_TABLE_ENTRIES) return null;
  if (payload + 8 + count * 8 > co64.offset + co64.size) return null;
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(u64(bytes, payload + 8 + i * 8));
  return offsets;
}

type StscEntry = { firstChunk: number; samplesPerChunk: number };

function readStsc(bytes: Uint8Array, stsc: Box): StscEntry[] | null {
  const payload = stsc.offset + stsc.headerSize;
  if (payload + 8 > stsc.offset + stsc.size) return null;
  const count = u32(bytes, payload + 4);
  if (count > MAX_TABLE_ENTRIES) return null;
  if (payload + 8 + count * 12 > stsc.offset + stsc.size) return null;
  const entries: StscEntry[] = [];
  for (let i = 0; i < count; i++) {
    const base = payload + 8 + i * 12;
    entries.push({
      firstChunk: u32(bytes, base),
      samplesPerChunk: u32(bytes, base + 4),
    });
  }
  return entries;
}

function samplesPerChunk(entries: StscEntry[], chunkIndex1: number): number {
  let current = entries[0]?.samplesPerChunk ?? 0;
  for (const entry of entries) {
    if (entry.firstChunk > chunkIndex1) break;
    current = entry.samplesPerChunk;
  }
  return current;
}

function sampleHasIdr(
  bytes: Uint8Array,
  start: number,
  size: number,
  nalLengthSize: number,
): boolean {
  let offset = start;
  const end = start + size;
  if (start < 0 || end > bytes.length) return false;
  while (offset + nalLengthSize <= end) {
    let nalLength = 0;
    for (let i = 0; i < nalLengthSize; i++) {
      nalLength = (nalLength << 8) | bytes[offset + i];
    }
    offset += nalLengthSize;
    if (nalLength <= 0 || offset + nalLength > end) return false;
    const nalType = bytes[offset] & 0x1f;
    if (nalType === NAL_IDR) return true;
    offset += nalLength;
  }
  return false;
}

function collectIdrSamples(
  bytes: Uint8Array,
  stbl: Box,
  nalLengthSize: number,
): { sampleCount: number; idrSamples: number[] } | null {
  const stsz = findChild(bytes, stbl, STSZ);
  const stsc = findChild(bytes, stbl, STSC);
  if (!stsz || !stsc) return null;
  const sizes = readSampleSizes(bytes, stsz);
  const chunkOffsets = readChunkOffsets(bytes, stbl);
  const stscEntries = readStsc(bytes, stsc);
  if (!sizes || !chunkOffsets || !stscEntries || stscEntries.length === 0) return null;

  const idrSamples: number[] = [];
  let sampleIndex = 1;
  let sizeCursor = 0;
  for (let chunk = 1; chunk <= chunkOffsets.length; chunk++) {
    const count = samplesPerChunk(stscEntries, chunk);
    let localOffset = 0;
    for (let i = 0; i < count && sizeCursor < sizes.length; i++) {
      const sampleSize = sizes[sizeCursor];
      const start = chunkOffsets[chunk - 1] + localOffset;
      if (sampleHasIdr(bytes, start, sampleSize, nalLengthSize)) {
        idrSamples.push(sampleIndex);
      }
      localOffset += sampleSize;
      sizeCursor += 1;
      sampleIndex += 1;
    }
  }
  return { sampleCount: sizes.length, idrSamples };
}

function isAvcSampleEntry(type: number): boolean {
  return type === AVC1 || type === AVC3;
}

function findAvcStbl(bytes: Uint8Array, moov: Box): Box | null {
  for (const trak of childBoxes(bytes, moov)) {
    if (trak.type !== TRAK) continue;
    const mdia = findChild(bytes, trak, MDIA);
    if (!mdia) continue;
    const minf = findChild(bytes, mdia, MINF);
    if (!minf) continue;
    const stbl = findChild(bytes, minf, STBL);
    if (!stbl) continue;
    const stsd = findChild(bytes, stbl, STSD, 0);
    if (!stsd) continue;
    for (const entry of childBoxes(bytes, stsd, 8)) {
      if (isAvcSampleEntry(entry.type)) return stbl;
    }
  }
  return null;
}

function topLevelBoxes(bytes: Uint8Array): Box[] {
  const boxes: Box[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const box = readBox(bytes, offset);
    if (!box) break;
    boxes.push(box);
    offset += box.size;
  }
  return boxes;
}

function rewriteFtypBrand(bytes: Uint8Array): void {
  const ftyp = readBox(bytes, 0);
  if (!ftyp || ftyp.type !== FTYP || ftyp.size < 16) return;
  const major = bytes.subarray(ftyp.offset + 8, ftyp.offset + 12);
  if (major[0] === 0x71 && major[1] === 0x74 && major[2] === 0x20 && major[3] === 0x20) {
    bytes[ftyp.offset + 8] = 0x6d; // m
    bytes[ftyp.offset + 9] = 0x70; // p
    bytes[ftyp.offset + 10] = 0x34; // 4
    bytes[ftyp.offset + 11] = 0x32; // 2
  }
  for (let offset = ftyp.offset + 16; offset + 4 <= ftyp.offset + ftyp.size; offset += 4) {
    if (
      bytes[offset] === 0x71 &&
      bytes[offset + 1] === 0x74 &&
      bytes[offset + 2] === 0x20 &&
      bytes[offset + 3] === 0x20
    ) {
      bytes[offset] = 0x69; // i
      bytes[offset + 1] = 0x73; // s
      bytes[offset + 2] = 0x6f; // o
      bytes[offset + 3] = 0x6d; // m
    }
  }
}

function shrinkStssInPlace(bytes: Uint8Array, stss: Box, idrSamples: number[]): boolean {
  const next = encodeStss(idrSamples);
  if (next.length > stss.size) return false;
  const remain = stss.size - next.length;
  if (remain > 0 && remain < 8) return false;
  bytes.set(next, stss.offset);
  if (remain >= 8) bytes.set(encodeFree(remain), stss.offset + next.length);
  return true;
}

export function inspectMp4AvcSeekInfo(bytes: Uint8Array): Mp4AvcSeekInfo | null {
  if (!looksLikeMp4(bytes)) return null;
  const moov = topLevelBoxes(bytes).find((box) => box.type === MOOV);
  if (!moov) return null;
  const stbl = findAvcStbl(bytes, moov);
  if (!stbl) return null;
  const stsd = findChild(bytes, stbl, STSD);
  if (!stsd) return null;
  const nalLengthSize = readAvcLengthSize(bytes, stsd);
  if (!nalLengthSize) return null;
  const collected = collectIdrSamples(bytes, stbl, nalLengthSize);
  if (!collected) return null;
  const stss = findChild(bytes, stbl, STSS);
  return {
    sampleCount: collected.sampleCount,
    idrSamples: collected.idrSamples,
    stssSamples: stss ? readStssSamples(bytes, stss) : null,
    nalLengthSize,
  };
}

export function sanitizeMp4ForBrowserSeek(input: Uint8Array): Uint8Array {
  try {
    const info = inspectMp4AvcSeekInfo(input);
    if (!info || info.idrSamples.length === 0 || !info.stssSamples) return input;
    if (sameSampleList(info.stssSamples, info.idrSamples)) return input;

    const copy = new Uint8Array(input);
    const moov = topLevelBoxes(copy).find((box) => box.type === MOOV);
    if (!moov) return input;
    const stbl = findAvcStbl(copy, moov);
    if (!stbl) return input;
    const stss = findChild(copy, stbl, STSS);

    if (stss && shrinkStssInPlace(copy, stss, info.idrSamples)) {
      rewriteFtypBrand(copy);
      return copy;
    }
    return input;
  } catch {
    return input;
  }
}

export function isMp4PlaybackPath(path: string): boolean {
  return /\.mp4$/i.test(path.split('?')[0] ?? path);
}
