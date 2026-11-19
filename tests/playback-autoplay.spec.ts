import { describe, expect, it } from 'vitest';
import { shouldPlayShownEpisode, type ShownEpisodePlayInput } from '@/core';

const shown = (overrides: Partial<ShownEpisodePlayInput> = {}): ShownEpisodePlayInput => ({
  totalFrames: 100,
  isLoading: false,
  isPlaying: false,
  userPaused: false,
  resumeRequested: false,
  ...overrides,
});

describe('play state of a newly shown episode (s10 F-14)', () => {
  it('an episode opens paused: nothing starts on its own', () => {
    expect(shouldPlayShownEpisode(shown())).toBe(false);
  });

  it('a selection made while playing keeps playing', () => {
    expect(shouldPlayShownEpisode(shown({ resumeRequested: true }))).toBe(true);
  });

  it.each([
    [{ totalFrames: 0 }, 'empty timeline'],
    [{ isLoading: true }, 'loading'],
    [{ isPlaying: true }, 'already playing'],
    [{ userPaused: true }, 'the person paused'],
  ] as const)('never starts when %s', (overrides) => {
    expect(shouldPlayShownEpisode(shown({ resumeRequested: true, ...overrides }))).toBe(false);
  });
});
