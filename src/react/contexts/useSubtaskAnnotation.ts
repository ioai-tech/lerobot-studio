import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LeRobotVersionCapability, SubtaskSegment, SubtaskTable } from '@/core';
import {
  buildSubtaskTable,
  canMutateSubtasks,
  collectSubtaskLabels,
  computeSubtaskCoverage,
  findOverlappingSegment,
  insertSubtaskSegment,
  replaceSubtaskSegment,
  segmentsFromFrameIndices,
  segmentsInsideEpisode,
  sortSubtaskSegments,
  subtaskRangeToPlayhead,
  validateSubtaskSegment,
} from '@/core';

export interface PendingSubtaskRange {
  startFrame: number;
  endFrame: number;
}

type UseSubtaskAnnotationOptions = {
  versionCapability: LeRobotVersionCapability | null;
  selectedEpisodeIndex: number | null;
  episodeLength: number;
  sourceTable: SubtaskTable;
  sourceIndices: Array<number | null>;
};

function cloneOverlay(
  overlay: ReadonlyMap<number, SubtaskSegment[]>,
): Map<number, SubtaskSegment[]> {
  return new Map(Array.from(overlay.entries()).map(([key, value]) => [key, [...value]]));
}

export function useSubtaskAnnotation({
  versionCapability,
  selectedEpisodeIndex,
  episodeLength,
  sourceTable,
  sourceIndices,
}: UseSubtaskAnnotationOptions) {
  const [overlay, setOverlay] = useState<Map<number, SubtaskSegment[]>>(() => new Map());
  const [pendingRange, setPendingRange] = useState<PendingSubtaskRange | null>(null);
  const canAnnotate = canMutateSubtasks(versionCapability);

  const resetSubtasks = useCallback(() => {
    setOverlay(new Map());
    setPendingRange(null);
  }, []);

  const sourceSegments = useMemo(() => {
    if (sourceIndices.length !== episodeLength) return [];
    return segmentsFromFrameIndices(sourceIndices, sourceTable);
  }, [episodeLength, sourceIndices, sourceTable]);

  const currentSegments = useMemo(() => {
    if (selectedEpisodeIndex == null || episodeLength <= 0) return [];
    const raw = overlay.has(selectedEpisodeIndex)
      ? (overlay.get(selectedEpisodeIndex) ?? [])
      : sourceSegments;
    return segmentsInsideEpisode(raw, episodeLength);
  }, [episodeLength, overlay, selectedEpisodeIndex, sourceSegments]);

  useEffect(() => {
    setPendingRange(null);
  }, [selectedEpisodeIndex]);

  const knownLabels = useMemo(() => {
    const table = buildSubtaskTable(collectSubtaskLabels(overlay.values(), sourceTable));
    return Object.values(table);
  }, [overlay, sourceTable]);

  const coverage = useMemo(
    () => computeSubtaskCoverage(episodeLength, currentSegments),
    [currentSegments, episodeLength],
  );

  const ensureOverlayEpisode = useCallback(
    (episodeIndex: number, length: number): SubtaskSegment[] => {
      const existing = overlay.get(episodeIndex);
      if (existing) return existing;
      return episodeIndex === selectedEpisodeIndex
        ? sourceSegments.filter((segment) => segment.endFrame < length)
        : [];
    },
    [overlay, selectedEpisodeIndex, sourceSegments],
  );

  const endAtPlayhead = useCallback(
    (frameIndex: number): boolean => {
      if (!canAnnotate || selectedEpisodeIndex == null) return false;
      const range = subtaskRangeToPlayhead(currentSegments, frameIndex, episodeLength);
      if (!range) return false;
      setPendingRange(range);
      return true;
    },
    [canAnnotate, currentSegments, episodeLength, selectedEpisodeIndex],
  );

  const beginPendingRange = useCallback(
    (startFrame: number, endFrame: number): boolean => {
      if (!canAnnotate || selectedEpisodeIndex == null || episodeLength <= 0) return false;
      if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)) return false;
      const start = Math.min(startFrame, endFrame);
      const end = Math.max(startFrame, endFrame);
      if (start < 0 || end >= episodeLength) return false;
      const candidate = { startFrame: start, endFrame: end, label: '_' };
      if (findOverlappingSegment(currentSegments, candidate)) return false;
      setPendingRange({ startFrame: start, endFrame: end });
      return true;
    },
    [canAnnotate, currentSegments, episodeLength, selectedEpisodeIndex],
  );

  const cancelPending = useCallback(() => {
    setPendingRange(null);
  }, []);

  const clearPendingAnnotation = cancelPending;

  const commitPending = useCallback(
    (label: string, range: PendingSubtaskRange | null = pendingRange) => {
      if (!canAnnotate || selectedEpisodeIndex == null || !range) {
        throw new Error('No pending subtask range');
      }
      const nextSegments = insertSubtaskSegment(
        ensureOverlayEpisode(selectedEpisodeIndex, episodeLength),
        { ...range, label },
        episodeLength,
      );
      setOverlay((previous) => {
        const next = cloneOverlay(previous);
        next.set(selectedEpisodeIndex, nextSegments);
        return next;
      });
      setPendingRange(null);
    },
    [canAnnotate, ensureOverlayEpisode, episodeLength, pendingRange, selectedEpisodeIndex],
  );

  const replaceEpisodeSegments = useCallback(
    (nextSegments: SubtaskSegment[]) => {
      if (!canAnnotate || selectedEpisodeIndex == null) return;
      const sorted = sortSubtaskSegments(
        nextSegments.map((segment) => validateSubtaskSegment(segment, episodeLength)),
      );
      for (let index = 0; index < sorted.length; index++) {
        const overlap = findOverlappingSegment(sorted, sorted[index], index);
        if (overlap) {
          throw new Error(
            `Subtask "${sorted[index].label}" overlaps "${overlap.label}" (${overlap.startFrame}-${overlap.endFrame})`,
          );
        }
      }
      setOverlay((previous) => {
        const next = cloneOverlay(previous);
        next.set(selectedEpisodeIndex, sorted);
        return next;
      });
    },
    [canAnnotate, episodeLength, selectedEpisodeIndex],
  );

  const updateSegment = useCallback(
    (index: number, segment: SubtaskSegment) => {
      if (!canAnnotate || selectedEpisodeIndex == null) return;
      const nextSegments = replaceSubtaskSegment(
        ensureOverlayEpisode(selectedEpisodeIndex, episodeLength),
        index,
        segment,
        episodeLength,
      );
      setOverlay((previous) => {
        const next = cloneOverlay(previous);
        next.set(selectedEpisodeIndex, nextSegments);
        return next;
      });
    },
    [canAnnotate, ensureOverlayEpisode, episodeLength, selectedEpisodeIndex],
  );

  const removeSegment = useCallback(
    (index: number) => {
      if (!canAnnotate || selectedEpisodeIndex == null) return;
      const current = ensureOverlayEpisode(selectedEpisodeIndex, episodeLength);
      if (index < 0 || index >= current.length) return;
      const nextSegments = current.filter((_, itemIndex) => itemIndex !== index);
      setOverlay((previous) => {
        const next = cloneOverlay(previous);
        next.set(selectedEpisodeIndex, nextSegments);
        return next;
      });
    },
    [canAnnotate, ensureOverlayEpisode, episodeLength, selectedEpisodeIndex],
  );

  return useMemo(
    () => ({
      overlay,
      canAnnotate,
      currentSegments,
      knownLabels,
      coverage,
      pendingRange,
      endAtPlayhead,
      beginPendingRange,
      cancelPending,
      clearPendingAnnotation,
      commitPending,
      updateSegment,
      replaceEpisodeSegments,
      removeSegment,
      resetSubtasks,
    }),
    [
      overlay,
      canAnnotate,
      currentSegments,
      knownLabels,
      coverage,
      pendingRange,
      endAtPlayhead,
      beginPendingRange,
      cancelPending,
      clearPendingAnnotation,
      commitPending,
      updateSegment,
      replaceEpisodeSegments,
      removeSegment,
      resetSubtasks,
    ],
  );
}
