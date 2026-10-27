import { describe, expect, it } from 'vitest';
import {
  SeekController,
  frameAtTime,
  frameCentreTime,
  type SeekableMedia,
} from '../src/react/services/video/SeekController';

/** A media element whose seeks complete when the test says so. */
class FakeMedia implements SeekableMedia {
  readyState = 4;
  seeking = false;
  private time = 0;
  readonly seekLog: number[] = [];
  fastSeeks: number[] = [];
  private readonly listeners = new Map<string, Set<() => void>>();

  get currentTime(): number {
    return this.time;
  }

  set currentTime(value: number) {
    this.seekLog.push(value);
    this.time = value;
    this.seeking = true;
  }

  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    this.listeners.get(type)?.forEach((listener) => listener());
  }

  /** The pending seek completes (optionally landing elsewhere). */
  complete(landAt?: number): void {
    if (landAt !== undefined) this.time = landAt;
    this.seeking = false;
    this.emit('seeked');
  }

  /** A new source: time 0, no metadata. */
  reset(): void {
    this.time = 0;
    this.readyState = 0;
    this.seeking = false;
    this.emit('emptied');
  }
}

const FPS = 30;
const setup = () => {
  const media = new FakeMedia();
  const controller = new SeekController(media, () => 1 / FPS);
  return { media, controller };
};

describe('frame time mapping', () => {
  it('targets the centre of a frame and maps any time inside it back to the frame', () => {
    for (const frame of [0, 1, 29, 30, 1234, 40_041]) {
      const time = frameCentreTime(12.5, frame, FPS);
      expect(frameAtTime(12.5, time, FPS)).toBe(frame);
      // the start of the frame (where float rounding can land just below) still maps to it
      expect(frameAtTime(12.5, 12.5 + frame / FPS, FPS)).toBe(frame);
    }
  });
});

describe('SeekController', () => {
  it('keeps one seek in flight and applies only the latest target afterwards', () => {
    const { media, controller } = setup();
    controller.seek(1);
    controller.seek(2);
    controller.seek(3);
    expect(media.seekLog).toEqual([1]);
    media.complete();
    expect(media.seekLog).toEqual([1, 3]);
    media.complete();
    expect(controller.isSettled()).toBe(true);
    expect(media.currentTime).toBe(3);
  });

  it('does not drop the trailing target of a fast scrub', () => {
    const { media, controller } = setup();
    for (let index = 0; index < 50; index++) controller.seek(index / 10);
    // 1 seek in flight, the final target pending
    expect(media.seekLog.length).toBe(1);
    media.complete();
    media.complete();
    expect(media.currentTime).toBeCloseTo(4.9);
    expect(controller.pendingTarget).toBeNull();
  });

  it('waits for metadata, then seeks (a new source starts at 0)', () => {
    const { media, controller } = setup();
    media.readyState = 0;
    controller.seek(5);
    expect(media.seekLog).toEqual([]);
    media.readyState = 1;
    media.emit('loadedmetadata');
    expect(media.seekLog).toEqual([5]);
  });

  it('re-applies the target when the element ends elsewhere (a source swap mid-seek)', () => {
    const { media, controller } = setup();
    controller.seek(5);
    media.reset();
    media.readyState = 1;
    media.emit('loadedmetadata');
    expect(media.seekLog).toEqual([5, 5]);
    media.readyState = 2;
    media.complete();
    expect(controller.isSettled()).toBe(true);
  });

  it('re-applies after seeked when off by more than half a frame, and gives up after a few tries', () => {
    const { media, controller } = setup();
    controller.seek(5);
    media.complete(4.5);
    expect(media.seekLog).toEqual([5, 5]);
    media.complete(4.5);
    media.complete(4.5);
    media.complete(4.5);
    // three re-applications, then it accepts where the element is (beyond its duration)
    expect(media.seekLog.length).toBeLessThanOrEqual(4);
    expect(controller.pendingTarget).toBeNull();
  });

  it('settles without a seek when the element is already within half a frame', () => {
    const { media, controller } = setup();
    media.currentTime = 2;
    media.complete();
    media.seekLog.length = 0;
    controller.seek(2 + 0.4 / FPS);
    expect(media.seekLog).toEqual([]);
    expect(controller.isSettled()).toBe(true);
  });

  it('waits for the frame to decode before reporting settled', async () => {
    const { media, controller } = setup();
    controller.seek(3);
    media.readyState = 1;
    media.complete();
    expect(controller.isSettled()).toBe(false);
    media.readyState = 2;
    media.emit('loadeddata');
    await controller.whenSettled();
    expect(controller.isSettled()).toBe(true);
  });

  it('uses fastSeek while dragging and accepts the keyframe it lands on', () => {
    const { media, controller } = setup();
    media.fastSeek = (time: number) => {
      media.fastSeeks.push(time);
      media.seeking = true;
    };
    controller.seek(7.3, { fast: true });
    expect(media.fastSeeks).toEqual([7.3]);
    media.complete(7);
    expect(controller.pendingTarget).toBeNull();
    expect(media.fastSeeks).toEqual([7.3]);
    // release: the exact seek
    controller.seek(7.3);
    expect(media.seekLog.at(-1)).toBe(7.3);
  });

  it('applies a newer fast target set while a fast seek was in flight (the pointer stopped)', () => {
    const { media, controller } = setup();
    media.fastSeek = (time: number) => {
      media.fastSeeks.push(time);
      media.seeking = true;
    };
    controller.seek(2, { fast: true });
    controller.seek(5, { fast: true });
    controller.seek(6, { fast: true });
    expect(media.fastSeeks).toEqual([2]);
    media.complete(2);
    // the latest target is applied, not dropped
    expect(media.fastSeeks).toEqual([2, 6]);
    media.complete(6);
    expect(controller.pendingTarget).toBeNull();
  });

  it('does not re-check a sync correction of a playing element', () => {
    const { media, controller } = setup();
    controller.seek(3, { once: true });
    expect(media.seekLog).toEqual([3]);
    // it plays on: lands, then is a few frames further by the time `seeked` fires
    media.complete(3.2);
    expect(controller.pendingTarget).toBeNull();
    expect(media.seekLog).toEqual([3]);
  });

  it('stops listening when disposed', () => {
    const { media, controller } = setup();
    controller.dispose();
    controller.seek(4);
    expect(media.seekLog).toEqual([]);
  });
});
