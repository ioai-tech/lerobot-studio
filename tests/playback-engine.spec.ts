import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybackEngine, type PlaybackEngineCallbacks } from '../src/react/services/PlaybackEngine';
import { frameAtTime, PlaybackClock } from '../src/react/services/PlaybackClock';

let scheduled: (() => void) | null = null;
vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
  scheduled = callback;
  return 1;
});
vi.stubGlobal('cancelAnimationFrame', () => undefined);

afterEach(() => {
  scheduled = null;
});

/** Engine on a fake wall clock; `at(ms)` advances wall time and runs one animation frame. */
function setup(overrides: Partial<PlaybackEngineCallbacks> = {}) {
  let wall = 0;
  let frame = 0;
  const clock = new PlaybackClock(() => wall);
  const state: PlaybackEngineCallbacks = {
    getFrameIndex: () => frame,
    setFrameIndexSilent: vi.fn((index: number) => {
      frame = index;
    }),
    notifyFrame: vi.fn(),
    getFrameCount: () => 1,
    getFps: () => 10,
    getPlaybackSpeed: () => 1,
    getPlaybackMode: () => 'sequential',
    getEpisodes: () => [
      { episode_index: 0, length: 1, tasks: [] },
      { episode_index: 1, length: 1, tasks: [] },
    ],
    getSelectedEpisodeIndex: () => 0,
    getDeletedEpisodes: () => new Set(),
    onStop: vi.fn(),
    onAdvanceEpisode: vi.fn(async () => true),
    onResumeAfterEpisode: vi.fn(),
    ...overrides,
  };
  const engine = new PlaybackEngine(state, clock);
  return {
    engine,
    clock,
    state,
    frame: () => frame,
    /** Advance wall time without running an animation frame. */
    atWithoutTick(ms: number) {
      wall = ms;
    },
    at(ms: number) {
      wall = ms;
      const run = scheduled;
      scheduled = null;
      run?.();
    },
  };
}

describe('PlaybackEngine (clock-driven)', () => {
  it('derives the frame from wall time, not from tick count', () => {
    const t = setup({ getFrameCount: () => 100 });
    t.engine.start();
    t.at(50); // 0.05 s at 10 fps → still frame 0
    expect(t.frame()).toBe(0);
    t.at(1_050); // one second later, even after a single late tick → frame 10
    expect(t.frame()).toBe(10);
    expect(t.state.notifyFrame).toHaveBeenCalledWith(10);
    t.engine.dispose();
  });

  it('pauses exactly on the frame the last animation frame published', () => {
    const t = setup({ getFrameCount: () => 100 });
    t.engine.start();
    t.at(190); // published frame 1
    expect(t.frame()).toBe(1);
    // The user pauses 20 ms later, after the clock crossed into frame 2.
    t.atWithoutTick(210);
    expect(frameAtTime(t.clock.now(), 10)).toBe(2);
    t.engine.stop();
    expect(t.frame()).toBe(1);
    expect(frameAtTime(t.clock.now(), 10)).toBe(1);
    expect(t.clock.isPlaying).toBe(false);
  });

  it('holds the frame while the clock is held and resumes without a jump', () => {
    const t = setup({ getFrameCount: () => 100 });
    t.engine.start();
    t.at(500);
    expect(t.frame()).toBe(5);
    t.clock.hold('camera-1');
    t.at(5_000);
    expect(t.frame()).toBe(5);
    t.clock.release('camera-1');
    t.at(5_200);
    expect(t.frame()).toBe(7);
    t.engine.dispose();
  });

  it('previews exactly the retained frames without advancing or opening annotation', () => {
    const t = setup({
      getFrameCount: () => 10,
      getPreviewRange: () => ({ startFrame: 3, endFrame: 4 }),
      onNaturalEnd: vi.fn(),
    });
    t.engine.start();
    expect(t.frame()).toBe(3);
    t.at(150);
    expect(t.frame()).toBe(4);
    t.at(300);
    expect(t.state.onStop).toHaveBeenCalledOnce();
    expect(t.frame()).toBe(4);
    expect(t.state.onNaturalEnd).not.toHaveBeenCalled();
    expect(t.state.onAdvanceEpisode).not.toHaveBeenCalled();
    t.engine.start();
    expect(t.frame()).toBe(3);
    t.engine.dispose();
  });

  it('does not resume playback when advancing an episode fails', async () => {
    const t = setup({ onAdvanceEpisode: vi.fn(async () => false) });
    t.engine.start();
    t.at(200);
    await Promise.resolve();
    expect(t.state.onStop).toHaveBeenCalledOnce();
    expect(t.state.onAdvanceEpisode).toHaveBeenCalledWith(1);
    expect(t.state.onResumeAfterEpisode).not.toHaveBeenCalled();
    expect(t.clock.isPlaying).toBe(false);
    t.engine.dispose();
  });

  it('resumes only after the next episode is ready', async () => {
    const t = setup();
    t.engine.start();
    t.at(200);
    await Promise.resolve();
    await Promise.resolve();
    expect(t.state.onResumeAfterEpisode).toHaveBeenCalledOnce();
    t.engine.dispose();
  });

  it('loops to the first frame in loop mode', () => {
    const t = setup({ getFrameCount: () => 3, getPlaybackMode: () => 'loop' });
    t.engine.start();
    t.at(150);
    expect(t.frame()).toBe(1);
    t.at(350);
    expect(t.frame()).toBe(0);
    expect(t.clock.now()).toBe(0);
    t.engine.dispose();
  });

  it('stops immediately when no frames are available', () => {
    const t = setup({ getFrameCount: () => 0 });
    t.engine.start();
    t.at(10);
    expect(t.state.onStop).toHaveBeenCalledOnce();
    expect(t.clock.isPlaying).toBe(false);
  });

  it('holds at the last frame and skips advancing when annotation asks to hold', () => {
    const onNaturalEnd = vi.fn();
    const t = setup({ getFrameCount: () => 5, shouldHoldAtEpisodeEnd: () => true, onNaturalEnd });
    t.engine.start();
    t.at(900);
    expect(t.frame()).toBe(4);
    expect(t.state.onStop).toHaveBeenCalledOnce();
    expect(onNaturalEnd).toHaveBeenCalledOnce();
    expect(t.state.onAdvanceEpisode).not.toHaveBeenCalled();
    expect(t.clock.now()).toBeCloseTo(0.4);
  });

  it('skips a deleted sequential episode before requesting the next load', async () => {
    const t = setup({
      getEpisodes: () => [
        { episode_index: 0, length: 1, tasks: [] },
        { episode_index: 1, length: 1, tasks: [] },
        { episode_index: 2, length: 1, tasks: [] },
      ],
      getDeletedEpisodes: () => new Set([1]),
    });
    t.engine.start();
    t.at(200);
    await Promise.resolve();
    expect(t.state.onAdvanceEpisode).toHaveBeenCalledWith(2);
  });

  it('follows playback speed through the clock rate', () => {
    let speed = 1;
    const t = setup({ getFrameCount: () => 1_000, getPlaybackSpeed: () => speed });
    t.engine.start();
    t.at(1_000);
    expect(t.frame()).toBe(10);
    speed = 2;
    t.at(1_000);
    t.at(2_000);
    expect(t.frame()).toBe(30);
    t.engine.dispose();
  });
});
