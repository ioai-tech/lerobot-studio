import { describe, expect, it } from 'vitest';
import type { EpisodeMetadata } from '../src/core';
import {
  deriveEffectiveEpisodes,
  getEffectiveEpisode,
  selectEpisodesForExport,
  toggleEpisodeIndex,
} from '../src/react/contexts/useEpisodeView';

const episodes: EpisodeMetadata[] = [
  { episode_index: 0, length: 10, tasks: ['zero'] },
  { episode_index: 1, length: 20, tasks: ['one'] },
  { episode_index: 2, length: 30, tasks: ['two'] },
];

describe('episode view derivation', () => {
  it('applies edits without changing untouched episode references', () => {
    const modified = new Map([[1, { tasks: ['edited'] }]]);

    expect(getEffectiveEpisode(episodes[0], modified)).toBe(episodes[0]);
    expect(getEffectiveEpisode(episodes[1], modified)).toEqual({
      ...episodes[1],
      tasks: ['edited'],
    });
  });

  it('filters deleted episodes before applying edits', () => {
    const result = deriveEffectiveEpisodes(
      episodes,
      new Set([0]),
      new Map([[1, { tasks: ['edited'] }]]),
    );

    expect(result.map((episode) => episode.episode_index)).toEqual([1, 2]);
    expect(result[0].tasks).toEqual(['edited']);
  });

  it('exports all effective episodes for an empty selection and subsets otherwise', () => {
    expect(selectEpisodesForExport(episodes, new Set())).toBe(episodes);
    expect(selectEpisodesForExport(episodes, new Set([2, 0]))).toEqual([episodes[0], episodes[2]]);
  });

  it('toggles selection immutably', () => {
    const original = new Set([1]);
    expect(toggleEpisodeIndex(original, 1)).toEqual(new Set());
    expect(toggleEpisodeIndex(original, 2)).toEqual(new Set([1, 2]));
    expect(original).toEqual(new Set([1]));
  });
});
