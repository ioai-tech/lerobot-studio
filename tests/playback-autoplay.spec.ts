import { describe, expect, it } from 'vitest';
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
