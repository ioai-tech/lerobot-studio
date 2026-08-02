import { describe, expect, it } from 'vitest';
import { shouldStartAutoplay } from '@ioai/lerobot-studio-core';

describe('playback autoplay guard', () => {
  it('starts autoplay when all conditions are satisfied', () => {
    expect(
      shouldStartAutoplay({
        totalFrames: 100,
        isLoading: false,
        shouldAutoplay: true,
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
        shouldAutoplay: true,
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
        shouldAutoplay: true,
        isPlaying: false,
        userPaused: false,
        currentId: '0-100',
        lastAutoPlayId: '0-100',
      }),
    ).toBe(false);
  });
});
