import { describe, expect, it } from 'vitest';
import type { EpisodeMetadata } from '../src/core';
import {
  applyTrimEpisodeUpdates,
  deriveEffectiveEpisodes,
  getEffectiveEpisode,
  selectEpisodesForExport,
  toggleEpisodeIndex,
  validateTrimEpisodeUpdates,
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

  it('validates a trim batch atomically and drops full-episode ranges', () => {
    const lengths = new Map(episodes.map((episode) => [episode.episode_index, episode.length]));
    expect(
      validateTrimEpisodeUpdates(
        new Map([
          [0, { startFrame: 1, endFrame: 4 }],
          [2, { startFrame: 0, endFrame: 29 }],
        ]),
        lengths,
      ),
    ).toEqual(
      new Map([
        [0, { startFrame: 1, endFrame: 4 }],
        [2, null],
      ]),
    );
    expect(() =>
      validateTrimEpisodeUpdates(
        new Map([
          [0, { startFrame: 0, endFrame: 4 }],
          [1, { startFrame: 4, endFrame: 900 }],
        ]),
        lengths,
      ),
    ).toThrow(/Invalid trim/);
    expect(() =>
      validateTrimEpisodeUpdates(new Map([[9, { startFrame: 0, endFrame: 1 }]]), lengths),
    ).toThrow(/Unknown episode 9/);
  });

  it('applies validated trim updates without mutating the previous map', () => {
    const previous = new Map([[1, { startFrame: 2, endFrame: 8 }]]);
    const next = applyTrimEpisodeUpdates(
      previous,
      new Map([
        [0, { startFrame: 1, endFrame: 3 }],
        [1, null],
      ]),
    );
    expect(next).toEqual(new Map([[0, { startFrame: 1, endFrame: 3 }]]));
    expect(previous).toEqual(new Map([[1, { startFrame: 2, endFrame: 8 }]]));
  });
});
