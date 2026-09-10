import { useCallback, useMemo, useState } from 'react';
import type { EpisodeMetadata, LeRobotVersionCapability } from '@/core';
import { validateEpisodeTrim, type EpisodeTrimRange } from '@/core';
import { assertEpisodeMutationAllowed, createEpisodeTaskEdit } from './versionMutationPolicy';

export function getEffectiveEpisode(
  episode: EpisodeMetadata,
  modifiedEpisodes: ReadonlyMap<number, Partial<EpisodeMetadata>>,
): EpisodeMetadata {
  const modified = modifiedEpisodes.get(episode.episode_index);
  return modified ? ({ ...episode, ...modified } as EpisodeMetadata) : episode;
}

export function deriveEffectiveEpisodes(
  episodes: readonly EpisodeMetadata[],
  deletedEpisodes: ReadonlySet<number>,
  modifiedEpisodes: ReadonlyMap<number, Partial<EpisodeMetadata>>,
): EpisodeMetadata[] {
  return episodes
    .filter((episode) => !deletedEpisodes.has(episode.episode_index))
    .map((episode) => getEffectiveEpisode(episode, modifiedEpisodes));
}

export function selectEpisodesForExport(
  effectiveEpisodes: EpisodeMetadata[],
  selectedEpisodeIndices: ReadonlySet<number>,
): EpisodeMetadata[] {
  if (selectedEpisodeIndices.size === 0) return effectiveEpisodes;
  return effectiveEpisodes.filter((episode) => selectedEpisodeIndices.has(episode.episode_index));
}

export function toggleEpisodeIndex(indices: ReadonlySet<number>, index: number): Set<number> {
  const next = new Set(indices);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

type UseEpisodeViewOptions = {
  episodes: EpisodeMetadata[];
  versionCapability: LeRobotVersionCapability | null;
};

export function useEpisodeView({ episodes, versionCapability }: UseEpisodeViewOptions) {
  const [trimRanges, setTrimRanges] = useState<Map<number, EpisodeTrimRange>>(() => new Map());
  const lengths = useMemo(
    () => new Map(episodes.map((episode) => [episode.episode_index, episode.length])),
    [episodes],
  );
  const trimEpisodes = useCallback(
    (ranges: ReadonlyMap<number, EpisodeTrimRange | null>) => {
      assertEpisodeMutationAllowed(versionCapability);
      const validated = new Map<number, EpisodeTrimRange | null>();
      for (const [index, range] of ranges) {
        const length = lengths.get(index);
        if (length === undefined) throw new Error(`Unknown episode ${index}`);
        if (range) validateEpisodeTrim(range, length);
        validated.set(
          index,
          !range || (range.startFrame === 0 && range.endFrame === length - 1) ? null : { ...range },
        );
      }
      setTrimRanges((previous) => {
        const next = new Map(previous);
        for (const [index, range] of validated) {
          if (range) next.set(index, range);
          else next.delete(index);
        }
        return next;
      });
    },
    [lengths, versionCapability],
  );
  const trimEpisode = useCallback(
    (index: number, range: EpisodeTrimRange | null) => trimEpisodes(new Map([[index, range]])),
    [trimEpisodes],
  );
  const [modifiedEpisodes, setModifiedEpisodes] = useState<Map<number, Partial<EpisodeMetadata>>>(
    () => new Map(),
  );
  const [deletedEpisodes, setDeletedEpisodes] = useState<Set<number>>(() => new Set());
  const [selectedEpisodeIndices, setSelectedEpisodeIndices] = useState<Set<number>>(
    () => new Set(),
  );

  const editEpisodeTask = useCallback(
    (episodeIndex: number, newTask: string) => {
      assertEpisodeMutationAllowed(versionCapability);
      setModifiedEpisodes((previous) => {
        if (!episodes.some((episode) => episode.episode_index === episodeIndex)) return previous;
        const next = new Map(previous);
        next.set(episodeIndex, createEpisodeTaskEdit(newTask));
        return next;
      });
    },
    [episodes, versionCapability],
  );

  const deleteEpisode = useCallback(
    (episodeIndex: number) => {
      assertEpisodeMutationAllowed(versionCapability);
      setDeletedEpisodes((previous) => new Set(previous).add(episodeIndex));
    },
    [versionCapability],
  );

  const restoreEpisode = useCallback(
    (episodeIndex: number) => {
      assertEpisodeMutationAllowed(versionCapability);
      setDeletedEpisodes((previous) => {
        const next = new Set(previous);
        next.delete(episodeIndex);
        return next;
      });
    },
    [versionCapability],
  );

  const resolveEffectiveEpisode = useCallback(
    (episode: EpisodeMetadata) => getEffectiveEpisode(episode, modifiedEpisodes),
    [modifiedEpisodes],
  );

  const effectiveEpisodes = useMemo(
    () => deriveEffectiveEpisodes(episodes, deletedEpisodes, modifiedEpisodes),
    [episodes, deletedEpisodes, modifiedEpisodes],
  );

  const episodesForExport = useMemo(
    () => selectEpisodesForExport(effectiveEpisodes, selectedEpisodeIndices),
    [effectiveEpisodes, selectedEpisodeIndices],
  );

  const toggleEpisodeSelection = useCallback((index: number) => {
    setSelectedEpisodeIndices((previous) => toggleEpisodeIndex(previous, index));
  }, []);

  const selectAllInList = useCallback((indices: number[]) => {
    setSelectedEpisodeIndices(new Set(indices));
  }, []);

  const clearEpisodeSelection = useCallback(() => {
    setSelectedEpisodeIndices(new Set());
  }, []);

  return {
    trimRanges,
    setTrimRanges,
    trimEpisode,
    trimEpisodes,
    modifiedEpisodes,
    setModifiedEpisodes,
    deletedEpisodes,
    setDeletedEpisodes,
    selectedEpisodeIndices,
    setSelectedEpisodeIndices,
    effectiveEpisodes,
    episodesForExport,
    editEpisodeTask,
    deleteEpisode,
    restoreEpisode,
    getEffectiveEpisode: resolveEffectiveEpisode,
    toggleEpisodeSelection,
    selectAllInList,
    clearEpisodeSelection,
  };
}
