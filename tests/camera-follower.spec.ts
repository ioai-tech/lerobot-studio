import { describe, expect, it } from 'vitest';
import { CameraFollower } from '../src/react/services/CameraFollower';
import { PlaybackClock, timeOfFrame } from '../src/react/services/PlaybackClock';

const FPS = 10;

/**
 * Minimal HTMLVideoElement stand-in: setting `currentTime` starts a seek that
 * finishes (`seeked`) on the next microtask, clamped to `duration` as a real
 * element does; frame callbacks are fired by hand.
 */
class FakeVideo extends EventTarget {
  readyState = 4;
  paused = true;
  playbackRate = 1;
  seeks: number[] = [];
  private time = 0;
  private frameCallback: ((now: number, metadata: object) => void) | null = null;

  /** When set, a seek lands on the start of the frame (as some decoders report). */
  snapToFrameStart = false;

  constructor(public duration: number) {
    super();
  }

  get currentTime() {
    return this.time;
  }

  set currentTime(value: number) {
    this.seeks.push(value);
    const landed = this.snapToFrameStart ? Math.floor(value * FPS) / FPS : value;
    this.time = Math.min(landed, this.duration);
    queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
  }

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  requestVideoFrameCallback(callback: (now: number, metadata: object) => void) {
    this.frameCallback = callback;
    return 1;
  }

  cancelVideoFrameCallback() {
    this.frameCallback = null;
  }

  /** Present a frame at `mediaTime`, displayed at wall time `at` (ms). */
  present(mediaTime: number, at: number) {
    this.time = mediaTime;
    this.frameCallback?.(at, { mediaTime, expectedDisplayTime: at });
  }
}

async function settle(turns = 50) {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

function setup(options: { videoFrames: number; dataFrames: number }) {
  let wall = 0;
  const clock = new PlaybackClock(() => wall);
  const video = new FakeVideo(options.videoFrames / FPS);
  const follower = new CameraFollower(video as unknown as HTMLVideoElement, clock, {
    id: 'cam',
    fps: () => FPS,
    range: () => ({ start: 0, end: options.dataFrames / FPS }),
  });
  return {
    clock,
    video,
    follower,
    setWall: (ms: number) => (wall = ms),
  };
}

describe('CameraFollower', () => {
  it('paused: parks on the centre of the clock frame with one seek', async () => {
    const t = setup({ videoFrames: 100, dataFrames: 100 });
    t.clock.seek(timeOfFrame(42, FPS));
    await settle();
    expect(t.video.seeks).toEqual([4.25]);
    expect(t.video.paused).toBe(true);
    t.follower.sync();
    await settle();
    expect(t.video.seeks).toHaveLength(1);
    t.follower.dispose();
  });

  it('paused at the natural end of a video shorter than the data: seeks once, never loops', async () => {
    // 9-frame video, 10 data frames, paused on the last data frame.
    const t = setup({ videoFrames: 9, dataFrames: 10 });
    t.clock.seek(timeOfFrame(9, FPS));
    await settle(200);
    expect(t.video.seeks.length).toBeLessThanOrEqual(1);
    t.follower.sync();
    await settle(200);
    expect(t.video.seeks.length).toBeLessThanOrEqual(1);
    t.follower.dispose();
  });

  it('paused: a seek that lands off target (frame-start snapping) is not repeated', async () => {
    const t = setup({ videoFrames: 100, dataFrames: 100 });
    t.video.snapToFrameStart = true;
    t.clock.seek(timeOfFrame(42, FPS));
    await settle(200);
    t.follower.sync();
    await settle(200);
    expect(t.video.seeks).toEqual([4.25]);
    t.follower.dispose();
  });

  it('settled while paused: only once its seek back to the clock frame has landed', async () => {
    const t = setup({ videoFrames: 100, dataFrames: 100 });
    t.clock.seek(timeOfFrame(42, FPS));
    await settle();
    expect(t.follower.isSettledWhilePaused()).toBe(true);
    // Playing, it is not paused at all.
    t.clock.play();
    await settle();
    expect(t.follower.isSettledWhilePaused()).toBe(false);
    // Paused while the element had run 3 frames past the clock (the pause
    // reached it late): it seeks back, and is settled once that lands.
    t.video.present(4.55, 0);
    t.clock.pause();
    expect(t.video.seeks.at(-1)).toBeCloseTo(4.25);
    expect(t.follower.isSettledWhilePaused()).toBe(false);
    await settle();
    expect(t.video.currentTime).toBeCloseTo(4.25);
    expect(t.follower.isSettledWhilePaused()).toBe(true);
    // A seek that lands off target is settled too: it is not sought again.
    t.video.snapToFrameStart = true;
    t.clock.seek(timeOfFrame(10, FPS));
    await settle();
    expect(t.video.currentTime).toBeCloseTo(1.0);
    expect(t.follower.isSettledWhilePaused()).toBe(true);
    t.follower.dispose();
  });

  it('coalesces scrubbing: one seek in flight, the latest target wins', async () => {
    const t = setup({ videoFrames: 100, dataFrames: 100 });
    t.clock.seek(timeOfFrame(10, FPS));
    t.clock.seek(timeOfFrame(20, FPS));
    t.clock.seek(timeOfFrame(30, FPS));
    await settle();
    expect(t.video.seeks).toEqual([1.05, 3.05]);
    t.follower.dispose();
  });

  it('playing: plays natively, holds the clock while buffering and releases when ready', async () => {
    const t = setup({ videoFrames: 1000, dataFrames: 1000 });
    t.clock.play();
    await settle();
    expect(t.video.paused).toBe(false);
    expect(t.clock.isRunning).toBe(true);

    t.video.readyState = 2;
    t.video.dispatchEvent(new Event('waiting'));
    expect(t.clock.isRunning).toBe(false);
    t.video.readyState = 4;
    t.video.dispatchEvent(new Event('canplay'));
    expect(t.clock.isRunning).toBe(true);
    t.follower.dispose();
  });

  it('playing: trims the rate for small drift and seeks once past 0.5 s', async () => {
    const t = setup({ videoFrames: 1000, dataFrames: 1000 });
    t.clock.play();
    await settle();
    const seeksBefore = t.video.seeks.length;
    // Camera runs 3 frames ahead of the clock for a while: slow down, no seek.
    for (let k = 1; k <= 40; k++) {
      t.setWall(k * 100);
      t.video.present(k * 0.1 + 0.3, k * 100);
    }
    expect(t.video.playbackRate).toBeLessThan(1);
    expect(t.video.seeks.length).toBe(seeksBefore);
    // 0.8 s behind: one seek to the clock time.
    t.setWall(5_000);
    t.video.present(4.2, 5_000);
    expect(t.video.seeks.at(-1)).toBeCloseTo(5, 5);
    t.follower.dispose();
  });

  it('held by another camera: pauses, and seeks only when more than 2 frames off', async () => {
    const t = setup({ videoFrames: 1000, dataFrames: 1000 });
    t.clock.play();
    await settle();
    const seeksAtStart = t.video.seeks.length;
    t.setWall(1_000);
    t.video.present(1.01, 1_000); // within a frame of the clock (1.0 s)
    t.clock.hold('other-camera');
    await settle();
    expect(t.video.paused).toBe(true);
    expect(t.video.seeks.length).toBe(seeksAtStart);
    t.clock.release('other-camera');
    t.setWall(1_500);
    t.video.present(1.2, 1_500); // 3 frames behind the clock (1.5 s)
    t.clock.hold('other-camera');
    await settle();
    expect(t.video.seeks.at(-1)).toBeCloseTo(1.5, 5);
    t.follower.dispose();
  });
});
