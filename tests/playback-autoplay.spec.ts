import { describe, expect, it } from 'vitest';
import { nextEpisodeAutoplay } from '../src/react/contexts/episodeAutoplay';
import { shouldStartAutoplay } from '@/core';

describe('playback autoplay', () => {
  it('starts automatically when frames are ready', () => {
    expect(
      shouldStartAutoplay({
        totalFrames: 100,
        isLoading: false,
        isPlaying: false,
        userPaused: false,
        currentId: '0-100',
        lastAutoPlayId: null,
      }),
    ).toBe(true);
  });

  it('does not autoplay after user pauses manually', () => {
    expect(
      shouldStartAutoplay({
        totalFrames: 100,
        isLoading: false,
        isPlaying: false,
        userPaused: true,
        currentId: '0-100',
        lastAutoPlayId: null,
      }),
    ).toBe(false);
  });

  it('does not autoplay repeatedly for same episode/frame set', () => {
    expect(
      shouldStartAutoplay({
        totalFrames: 100,
        isLoading: false,
        isPlaying: false,
        userPaused: false,
        currentId: '0-100',
        lastAutoPlayId: '0-100',
      }),
    ).toBe(false);
  });

  it.each([
    [{ totalFrames: 0 }, 'empty timeline'],
    [{ isLoading: true }, 'loading'],
    [{ isPlaying: true }, 'already playing'],
  ] as const)('blocks autoplay when %s', (overrides) => {
    expect(
      shouldStartAutoplay({
        totalFrames: 100,
        isLoading: false,
        isPlaying: false,
        userPaused: false,
        currentId: '0-100',
        lastAutoPlayId: null,
        ...overrides,
      }),
    ).toBe(false);
  });
});

describe('episode autoplay intent', () => {
  const none = { episode: null, play: true };
  it('the first selection autoplays', () => {
    expect(nextEpisodeAutoplay(none, 0, false).play).toBe(true);
  });
  it('a later selection plays on only when chosen while playing', () => {
    const consumed = { episode: 0, play: false };
    expect(nextEpisodeAutoplay(consumed, 1, true).play).toBe(true);
    expect(nextEpisodeAutoplay(consumed, 1, false).play).toBe(false);
  });
  it('a quick reselection keeps the intent the previous selection did not use yet', () => {
    // chosen while playing (playback stops while it loads), then another before it autoplayed
    const waiting = nextEpisodeAutoplay({ episode: 0, play: false }, 1, true);
    expect(nextEpisodeAutoplay(waiting, 2, false)).toEqual({ episode: 2, play: true });
    // the first episode still loading
    expect(nextEpisodeAutoplay(nextEpisodeAutoplay(none, 0, false), 3, false).play).toBe(true);
  });
});
