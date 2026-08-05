import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybackEngine, type PlaybackEngineCallbacks } from '../src/react/services/PlaybackEngine';

let scheduled: FrameRequestCallback | null = null;

vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
  scheduled = callback;
  return 1;
});
vi.stubGlobal('cancelAnimationFrame', () => undefined);
vi.stubGlobal('window', globalThis);

afterEach(() => {
  scheduled = null;
});

function callbacks(overrides: Partial<PlaybackEngineCallbacks> = {}): PlaybackEngineCallbacks {
  return {
    getFrameIndex: () => 0,
    setFrameIndexSilent: vi.fn(),
    notifyFrame: vi.fn(),
    getFrameCount: () => 1,
    getFps: () => 30,
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
}

describe('PlaybackEngine', () => {
  it('does not resume playback when advancing an episode fails', async () => {
    const state = callbacks({ onAdvanceEpisode: vi.fn(async () => false) });
    const engine = new PlaybackEngine(state);
    engine.start();

    scheduled?.(100);
    scheduled?.(200);
    await Promise.resolve();

    expect(state.onStop).toHaveBeenCalledOnce();
    expect(state.onAdvanceEpisode).toHaveBeenCalledWith(1);
    expect(state.onResumeAfterEpisode).not.toHaveBeenCalled();
    engine.dispose();
  });

  it('resumes only after the next episode is ready', async () => {
    const state = callbacks();
    const engine = new PlaybackEngine(state);
    engine.start();

    scheduled?.(100);
    scheduled?.(200);
    await Promise.resolve();

    expect(state.onResumeAfterEpisode).toHaveBeenCalledOnce();
    engine.dispose();
  });

  it('advances frames and loops to the first frame in loop mode', () => {
    const normal = callbacks({ getFrameCount: () => 3 });
    const normalEngine = new PlaybackEngine(normal);
    normalEngine.start();
    (normalEngine as any).tick(1);
    (normalEngine as any).tick(40);
    expect(normal.setFrameIndexSilent).toHaveBeenCalledWith(1);
    expect(normal.notifyFrame).toHaveBeenCalledWith(1);
    normalEngine.dispose();

    const loop = callbacks({ getPlaybackMode: () => 'loop' });
    const loopEngine = new PlaybackEngine(loop);
    loopEngine.start();
    (loopEngine as any).tick(1);
    (loopEngine as any).tick(40);
    expect(loop.setFrameIndexSilent).toHaveBeenCalledWith(0);
    expect(loop.notifyFrame).toHaveBeenCalledWith(0);
    loopEngine.dispose();
  });

  it('stops immediately when no frames are available', () => {
    const state = callbacks({ getFrameCount: () => 0 });
    const engine = new PlaybackEngine(state);
    engine.start();
    (engine as any).tick(1);

    scheduled = null;
    (engine as any).tick(2);
    expect(scheduled).toBeNull();
  });

  it('uses a timeout before scheduling a frame when the next interval is distant', () => {
    const timeout = vi.spyOn(window, 'setTimeout').mockImplementation((callback) => {
      if (typeof callback === 'function') callback();
      return 1;
    });
    const engine = new PlaybackEngine(callbacks({ getFrameCount: () => 3 }));
    engine.start();
    (engine as any).tick(1);
    expect(timeout).toHaveBeenCalled();
    expect(scheduled).not.toBeNull();
    engine.dispose();
    timeout.mockRestore();
  });

  it('keeps using animation frames near the next playback interval', () => {
    const engine = new PlaybackEngine(callbacks({ getFrameCount: () => 3 }));
    engine.start();
    (engine as any).tick(1);
    scheduled = null;
    (engine as any).tick(30.5);
    expect(scheduled).not.toBeNull();
    engine.dispose();
  });

  it('skips a deleted sequential episode before requesting the next load', async () => {
    const state = callbacks({ getDeletedEpisodes: () => new Set([1]) });
    const engine = new PlaybackEngine(state);
    engine.start();
    (engine as any).tick(1);
    (engine as any).tick(40);
    await Promise.resolve();

    expect(state.onAdvanceEpisode).toHaveBeenCalledWith(0);
    engine.dispose();
  });
});
