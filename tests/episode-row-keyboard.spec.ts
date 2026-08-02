import { describe, expect, it } from 'vitest';
import { isEpisodeRowActivationKey } from '@/core';

describe('EpisodeRow keyboard activation', () => {
  it('keeps Enter as the only activation key', () => {
    expect(isEpisodeRowActivationKey('Enter')).toBe(true);
    expect(isEpisodeRowActivationKey(' ')).toBe(false);
    expect(isEpisodeRowActivationKey('Space')).toBe(false);
  });
});
