import { describe, expect, it, vi } from 'vitest';
import { frameAtTime, PlaybackClock, timeOfFrame } from '../src/react/services/PlaybackClock';

function fake() {
  let wall = 0;
  const clock = new PlaybackClock(() => wall);
  return { clock, set: (ms: number) => (wall = ms) };
}

describe('PlaybackClock', () => {
  it('advances with wall time only while playing', () => {
    const { clock, set } = fake();
    set(1_000);
    expect(clock.now()).toBe(0);
    clock.play();
    set(2_500);
    expect(clock.now()).toBeCloseTo(1.5);
    clock.pause();
    set(9_000);
    expect(clock.now()).toBeCloseTo(1.5);
  });

  it('holds while any participant holds and resumes from the held time', () => {
    const { clock, set } = fake();
    clock.play();
    set(1_000);
    clock.hold('a');
    clock.hold('b');
    expect(clock.isPlaying).toBe(true);
    expect(clock.isRunning).toBe(false);
    set(3_000);
    clock.release('a');
    expect(clock.now()).toBeCloseTo(1);
    set(4_000);
    expect(clock.now()).toBeCloseTo(1);
    clock.release('b');
    set(4_500);
    expect(clock.now()).toBeCloseTo(1.5);
  });

  it('counts seeks and notifies listeners on every state change', () => {
    const { clock } = fake();
    const listener = vi.fn();
    const unsubscribe = clock.subscribe(listener);
    clock.seek(2);
    clock.setRate(2);
    clock.play();
    clock.hold('x');
    clock.hold('x');
    clock.release('x');
    clock.pause();
    expect(clock.seekVersion).toBe(1);
    expect(listener).toHaveBeenCalledTimes(6);
    unsubscribe();
    clock.seek(0);
    expect(listener).toHaveBeenCalledTimes(6);
  });

  it('applies rate changes from the current time on', () => {
    const { clock, set } = fake();
    clock.play();
    set(1_000);
    clock.setRate(2);
    set(2_000);
    expect(clock.now()).toBeCloseTo(3);
  });

  it('maps frames to the start of their interval and back', () => {
    for (const fps of [10, 15, 30, 50]) {
      for (const frame of [0, 1, 7, 299, 39_599]) {
        expect(frameAtTime(timeOfFrame(frame, fps), fps)).toBe(frame);
        expect(frameAtTime(timeOfFrame(frame, fps) + 0.999 / fps, fps)).toBe(frame);
      }
    }
  });
});
