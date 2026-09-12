import { describe, expect, it } from 'vitest';
import { fixedTrim, suggestTrim } from '../src/core/export/suggestTrim';

const fps = 30;
function recording(signal: (time: number, dimension: number) => number, seconds = 30, width = 2) {
  const rows = seconds * fps;
  return {
    rows,
    width,
    values: Float64Array.from({ length: rows * width }, (_, i) =>
      signal(Math.floor(i / width) / fps, i % width),
    ),
  };
}
const move = (t: number) => Math.min(10, Math.max(0, t - 10));

describe('batch trim suggestions', () => {
  it('uses original-frame coordinates, rounds outward and rejects destructive fixed removals', () => {
    expect(fixedTrim(100, 10, 2, 3)).toEqual({ startFrame: 20, endFrame: 69 });
    expect(fixedTrim(10, 30, 0.01, 0.01)).toEqual({ startFrame: 0, endFrame: 9 });
    for (const args of [
      [100, 10, 5, 5],
      [10, 30, -1, 0],
      [10, 0, 1, 1],
      [10, 30, NaN, 0],
      [10, 30, 0, Infinity],
    ]) {
      expect(() => fixedTrim(...(args as [number, number, number, number]))).toThrow();
    }
  });

  it('finds leading/trailing idle regions and independently adds the requested buffers', () => {
    const data = recording(move);
    const bare = suggestTrim(data, fps, [0], 0, 0)!;
    expect(bare.startFrame / fps).toBeGreaterThanOrEqual(9.5);
    expect(bare.startFrame / fps).toBeLessThanOrEqual(10);
    expect((bare.endFrame + 1) / fps).toBeGreaterThanOrEqual(20);
    expect((bare.endFrame + 1) / fps).toBeLessThanOrEqual(20.5);
    expect(suggestTrim(data, fps, [0])).toEqual({
      startFrame: bare.startFrame - 90,
      endFrame: bare.endFrame + 90,
    });
    expect(suggestTrim(data, fps, [0], 1, 4)).toEqual({
      startFrame: bare.startFrame - 30,
      endFrame: bare.endFrame + 120,
    });
    expect(suggestTrim(data, fps, [0], 100, 100)).toEqual({
      startFrame: 0,
      endFrame: data.rows - 1,
    });
  });

  it('retains slow movement, middle pauses and gripper-only actions across different units', () => {
    const slow = recording((t, d) => (d === 0 ? move(t) * 1e-5 : 500));
    expect(suggestTrim(slow, fps, [0], 0, 0)).toEqual(suggestTrim(recording(move), fps, [0], 0, 0));
    const gripper = recording((t, d) => (d === 0 ? 42 : t < 10 ? 0 : t < 20 ? 1 : 0));
    const range = suggestTrim(gripper, fps, [0, 1], 0, 0)!;
    expect(range.startFrame / fps).toBeLessThanOrEqual(10);
    expect(range.endFrame / fps).toBeGreaterThanOrEqual(20);
    expect(suggestTrim(gripper, fps, [0])).toBeNull();
  });

  it('does not trim continuous movement and only trims the idle side', () => {
    const whole = recording((t) => t);
    expect(suggestTrim(whole, fps, [0], 0, 0)).toEqual({ startFrame: 0, endFrame: whole.rows - 1 });
    expect(
      suggestTrim(
        recording((t) => Math.min(t, 20)),
        fps,
        [0],
        0,
        0,
      )?.startFrame,
    ).toBe(0);
    expect(
      suggestTrim(
        recording((t) => Math.max(0, t - 10)),
        fps,
        [0],
        0,
        0,
      )?.endFrame,
    ).toBe(whole.rows - 1);
  });

  it('rejects stationary, jitter-only, isolated spikes, missing and non-finite signals', () => {
    expect(
      suggestTrim(
        recording(() => 1),
        fps,
        [0],
      ),
    ).toBeNull();
    expect(
      suggestTrim(
        recording((t) => Math.sin(t * 70) * 0.001),
        fps,
        [0],
      ),
    ).toBeNull();
    expect(
      suggestTrim(
        recording((t) => (t === 10 ? 100 : 0)),
        fps,
        [0],
      ),
    ).toBeNull();
    const data = recording(move);
    expect(suggestTrim(data, fps, [])).toBeNull();
    expect(suggestTrim(data, fps, [2])).toBeNull();
    expect(suggestTrim({ ...data, rows: 1 }, fps, [0])).toBeNull();
    data.values[50] = NaN;
    expect(suggestTrim(data, fps, [0])).toBeNull();
    expect(() => suggestTrim(data, fps, [0], -1, 3)).toThrow();
  });

  it('finds motion despite static sensor jitter', () => {
    const data = recording((t, d) => move(t) + Math.sin(t * 70 + d) * 0.001);
    const result = suggestTrim(data, fps, [0, 1], 0, 0)!;
    expect(result.startFrame / fps).toBeGreaterThan(9);
    expect(result.endFrame / fps).toBeLessThan(21);
  });
});
