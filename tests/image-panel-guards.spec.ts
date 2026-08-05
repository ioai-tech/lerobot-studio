import { describe, expect, it } from 'vitest';
import { isLatestRequest, shouldShowInitialImageLoading, shouldSkipFrameLoad } from '@/core';

describe('image panel load guards', () => {
  it('skips load when same frame already loaded', () => {
    expect(
      shouldSkipFrameLoad(
        { episode: 1, frame: 10, key: 'observation.image' },
        1,
        10,
        'observation.image',
        false,
      ),
    ).toBe(true);
  });

  it('skips load while another request is in progress', () => {
    expect(
      shouldSkipFrameLoad(
        { episode: 1, frame: 9, key: 'observation.image' },
        1,
        10,
        'observation.image',
        true,
      ),
    ).toBe(true);
  });

  it('does not skip load for a new frame request', () => {
    expect(
      shouldSkipFrameLoad(
        { episode: 1, frame: 9, key: 'observation.image' },
        1,
        10,
        'observation.image',
        false,
      ),
    ).toBe(false);
  });

  it('only applies latest request result', () => {
    expect(isLatestRequest(3, 3)).toBe(true);
    expect(isLatestRequest(2, 3)).toBe(false);
  });

  it('shows loading only before first image is available', () => {
    expect(shouldShowInitialImageLoading(null)).toBe(true);
    expect(shouldShowInitialImageLoading('blob:cached-url')).toBe(false);
  });
});
