import { describe, expect, it } from 'vitest';
import {
  inspectMp4AvcSeekInfo,
  sanitizeMp4ForBrowserSeek,
} from '../src/platform/utils/mp4SeekSanitizer';
import { buildAvcMp4 } from './helpers/brokenAvcMp4';

describe('sanitizeMp4ForBrowserSeek', () => {
  it('returns non-MP4 bytes unchanged', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(sanitizeMp4ForBrowserSeek(bytes)).toBe(bytes);
  });

  it('leaves a correct stss table on the same buffer', () => {
    const bytes = buildAvcMp4({ idrAt: [1], stss: [1], extraPFrames: 3 });
    const info = inspectMp4AvcSeekInfo(bytes);
    expect(info?.idrSamples).toEqual([1]);
    expect(info?.stssSamples).toEqual([1]);
    expect(sanitizeMp4ForBrowserSeek(bytes)).toBe(bytes);
  });

  it('rewrites VideoToolbox-style stss so only real IDR samples stay sync', () => {
    const bytes = buildAvcMp4({ idrAt: [1, 5], stss: [1, 2, 3, 4, 5, 6], extraPFrames: 1 });
    const before = inspectMp4AvcSeekInfo(bytes);
    expect(before?.idrSamples).toEqual([1, 5]);
    expect(before?.stssSamples).toEqual([1, 2, 3, 4, 5, 6]);

    const sanitized = sanitizeMp4ForBrowserSeek(bytes);
    expect(sanitized).not.toBe(bytes);
    const after = inspectMp4AvcSeekInfo(sanitized);
    expect(after?.idrSamples).toEqual([1, 5]);
    expect(after?.stssSamples).toEqual([1, 5]);
    expect(after?.sampleCount).toBe(before?.sampleCount);
  });

  it('does not change sample payload bytes when shrinking stss', () => {
    const bytes = buildAvcMp4({ idrAt: [1], stss: [1, 2, 3, 4] });
    const sanitized = sanitizeMp4ForBrowserSeek(bytes);
    const originalMdat = bytes.subarray(bytes.length - 80);
    const nextMdat = sanitized.subarray(sanitized.length - 80);
    expect(Buffer.from(nextMdat)).toEqual(Buffer.from(originalMdat));
  });
});
