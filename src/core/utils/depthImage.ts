export type SniffedImageFormat = 'jpeg' | 'png' | 'tiff' | 'webp';

export interface GrayscaleTiff {
  width: number;
  height: number;
  bitsPerSample: 8 | 16;
  littleEndian: boolean;
  pixels: Uint16Array;
}

export interface DepthPreview {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

const TIFF_IMAGE_WIDTH = 256;
const TIFF_IMAGE_LENGTH = 257;
const TIFF_BITS_PER_SAMPLE = 258;
const TIFF_COMPRESSION = 259;
const TIFF_STRIP_OFFSETS = 273;
const TIFF_SAMPLES_PER_PIXEL = 277;
const TIFF_STRIP_BYTE_COUNTS = 279;

export function sniffImageFormat(bytes: Uint8Array): SniffedImageFormat | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x49 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x2a &&
    bytes[3] === 0
  ) {
    return 'tiff';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x4d &&
    bytes[1] === 0x4d &&
    bytes[2] === 0 &&
    bytes[3] === 0x2a
  ) {
    return 'tiff';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

export function mimeTypeForImageFormat(format: SniffedImageFormat | null): string {
  if (format === 'png') return 'image/png';
  if (format === 'tiff') return 'image/tiff';
  if (format === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function u16(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function u32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian
    ? (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>>
        0
    : ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
        0;
}

function readTiffValue(
  bytes: Uint8Array,
  offset: number,
  type: number,
  count: number,
  littleEndian: boolean,
): number[] {
  const size = type === 3 ? 2 : type === 4 ? 4 : 1;
  const payload = size * count;
  const dataOffset = payload <= 4 ? offset : u32(bytes, offset, littleEndian);
  const values: number[] = [];
  for (let index = 0; index < count; index++) {
    const at = dataOffset + index * size;
    if (type === 3) values.push(u16(bytes, at, littleEndian));
    else if (type === 4) values.push(u32(bytes, at, littleEndian));
    else values.push(bytes[at]);
  }
  return values;
}

/**
 * Decode uncompressed 8/16-bit grayscale TIFF (official LeRobot depth maps).
 */
export function decodeUncompressedGrayscaleTiff(bytes: Uint8Array): GrayscaleTiff {
  if (sniffImageFormat(bytes) !== 'tiff') {
    throw new Error('Not a TIFF image');
  }
  const littleEndian = bytes[0] === 0x49;
  if (u16(bytes, 2, littleEndian) !== 42) {
    throw new Error('Invalid TIFF magic');
  }
  const ifd = u32(bytes, 4, littleEndian);
  const entryCount = u16(bytes, ifd, littleEndian);
  const tags = new Map<number, number[]>();
  for (let index = 0; index < entryCount; index++) {
    const entry = ifd + 2 + index * 12;
    const tag = u16(bytes, entry, littleEndian);
    const type = u16(bytes, entry + 2, littleEndian);
    const count = u32(bytes, entry + 4, littleEndian);
    tags.set(tag, readTiffValue(bytes, entry + 8, type, count, littleEndian));
  }

  const width = tags.get(TIFF_IMAGE_WIDTH)?.[0];
  const height = tags.get(TIFF_IMAGE_LENGTH)?.[0];
  const bits = tags.get(TIFF_BITS_PER_SAMPLE)?.[0] ?? 16;
  const compression = tags.get(TIFF_COMPRESSION)?.[0] ?? 1;
  const samples = tags.get(TIFF_SAMPLES_PER_PIXEL)?.[0] ?? 1;
  const stripOffsets = tags.get(TIFF_STRIP_OFFSETS);
  const stripBytes = tags.get(TIFF_STRIP_BYTE_COUNTS);
  if (!width || !height || !stripOffsets?.length) {
    throw new Error('TIFF is missing width, height, or strip offsets');
  }
  if (compression !== 1) {
    throw new Error(`Unsupported TIFF compression ${compression}`);
  }
  if (samples !== 1 || (bits !== 8 && bits !== 16)) {
    throw new Error(`Unsupported TIFF layout bits=${bits} samples=${samples}`);
  }

  const pixels = new Uint16Array(width * height);
  let written = 0;
  for (let strip = 0; strip < stripOffsets.length; strip++) {
    const start = stripOffsets[strip];
    const length = stripBytes?.[strip] ?? bytes.length - start;
    if (bits === 8) {
      for (let offset = 0; offset < length && written < pixels.length; offset++) {
        pixels[written++] = bytes[start + offset];
      }
    } else {
      for (let offset = 0; offset + 1 < length && written < pixels.length; offset += 2) {
        pixels[written++] = u16(bytes, start + offset, littleEndian);
      }
    }
  }
  if (written !== pixels.length) {
    throw new Error(`TIFF strip size mismatch: got ${written} pixels, expected ${pixels.length}`);
  }

  return {
    width,
    height,
    bitsPerSample: bits === 8 ? 8 : 16,
    littleEndian,
    pixels,
  };
}

function turboColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  const stops: Array<[number, number, number, number]> = [
    [0, 13, 8, 135],
    [0.25, 31, 150, 139],
    [0.5, 201, 221, 52],
    [0.75, 253, 141, 9],
    [1, 144, 12, 0],
  ];
  for (let index = 0; index < stops.length - 1; index++) {
    const left = stops[index];
    const right = stops[index + 1];
    if (x <= right[0]) {
      const span = right[0] - left[0] || 1;
      const f = (x - left[0]) / span;
      return [
        Math.round(left[1] + (right[1] - left[1]) * f),
        Math.round(left[2] + (right[2] - left[2]) * f),
        Math.round(left[3] + (right[3] - left[3]) * f),
      ];
    }
  }
  return [144, 12, 0];
}

export function colorizeUint16Depth(
  pixels: Uint16Array,
  width: number,
  height: number,
): DepthPreview {
  let min = 0xffff;
  let max = 0;
  for (let index = 0; index < pixels.length; index++) {
    const value = pixels[index];
    if (value === 0) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = Math.max(1, max - min);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index++) {
    const value = pixels[index];
    const offset = index * 4;
    if (value === 0 || max === 0) {
      rgba[offset + 3] = 255;
      continue;
    }
    const [red, green, blue] = turboColor((value - min) / span);
    rgba[offset] = red;
    rgba[offset + 1] = green;
    rgba[offset + 2] = blue;
    rgba[offset + 3] = 255;
  }
  return { width, height, rgba };
}

/** Decode official 16-bit depth TIFF into a false-color preview for playback. */
export function renderTiffDepthPreview(bytes: Uint8Array): DepthPreview {
  const tiff = decodeUncompressedGrayscaleTiff(bytes);
  return colorizeUint16Depth(tiff.pixels, tiff.width, tiff.height);
}

export function isDepthMapFeature(
  feature: { dtype?: string; info?: Record<string, unknown> } | undefined,
): boolean {
  if (!feature) return false;
  if (feature.dtype === 'depth') return true;
  return feature.info?.is_depth_map === true;
}
