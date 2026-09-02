import { describe, expect, it } from 'vitest';
import {
  colorizeUint16Depth,
  decodeUncompressedGrayscaleTiff,
  mimeTypeForImageFormat,
  renderTiffDepthPreview,
  sniffImageFormat,
} from '@/core';

function u16le(value: number): [number, number] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function u32le(value: number): [number, number, number, number] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}

function writeEntry(tag: number, type: number, count: number, value: number): number[] {
  return [...u16le(tag), ...u16le(type), ...u32le(count), ...u32le(value)];
}

function writeGray16Tiff(width: number, height: number, pixels: Uint16Array): Uint8Array {
  const entries = 8;
  const header = 8;
  const ifdSize = 2 + entries * 12 + 4;
  const stripOffset = header + ifdSize;
  const body: number[] = [
    0x49,
    0x49,
    42,
    0,
    ...u32le(header),
    ...u16le(entries),
    ...writeEntry(256, 4, 1, width),
    ...writeEntry(257, 4, 1, height),
    ...writeEntry(258, 3, 1, 16),
    ...writeEntry(259, 3, 1, 1),
    ...writeEntry(262, 3, 1, 1),
    ...writeEntry(273, 4, 1, stripOffset),
    ...writeEntry(277, 3, 1, 1),
    ...writeEntry(279, 4, 1, pixels.length * 2),
    ...u32le(0),
  ];
  const bytes = new Uint8Array(stripOffset + pixels.length * 2);
  bytes.set(body, 0);
  for (let index = 0; index < pixels.length; index++) {
    const offset = stripOffset + index * 2;
    bytes[offset] = pixels[index] & 0xff;
    bytes[offset + 1] = (pixels[index] >> 8) & 0xff;
  }
  return bytes;
}

describe('official depth TIFF preview', () => {
  it('sniffs jpeg, png, and tiff magic bytes', () => {
    expect(sniffImageFormat(Uint8Array.of(0xff, 0xd8, 0xff))).toBe('jpeg');
    expect(sniffImageFormat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      'png',
    );
    expect(sniffImageFormat(Uint8Array.of(0x49, 0x49, 0x2a, 0x00))).toBe('tiff');
    expect(mimeTypeForImageFormat('tiff')).toBe('image/tiff');
  });

  it('decodes uncompressed 16-bit grayscale TIFF and colorizes non-zero depth', () => {
    const pixels = Uint16Array.from([0, 100, 400, 800]);
    const encoded = writeGray16Tiff(2, 2, pixels);
    const decoded = decodeUncompressedGrayscaleTiff(encoded);
    expect(decoded).toMatchObject({ width: 2, height: 2, bitsPerSample: 16 });
    expect([...decoded.pixels]).toEqual([0, 100, 400, 800]);

    const preview = renderTiffDepthPreview(encoded);
    expect(preview.width).toBe(2);
    expect(preview.height).toBe(2);
    expect(preview.rgba[3]).toBe(255);
    expect(preview.rgba[0] + preview.rgba[1] + preview.rgba[2]).toBe(0);
    expect(preview.rgba[4] + preview.rgba[5] + preview.rgba[6]).toBeGreaterThan(0);
  });

  it('keeps invalid zero samples black while stretching valid range', () => {
    const preview = colorizeUint16Depth(Uint16Array.from([0, 0, 50, 50]), 2, 2);
    expect(preview.rgba[0]).toBe(0);
    expect(preview.rgba[8]).toBeGreaterThan(0);
  });
});
