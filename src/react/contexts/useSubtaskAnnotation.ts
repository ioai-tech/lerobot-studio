import { useCallback, useMemo, useState } from 'react';
import type { LeRobotVersionCapability, SubtaskSegment, SubtaskTable } from '@/core';
import {
  buildSubtaskTable,
  canMutateSubtasks,
  collectSubtaskLabels,
  computeSubtaskCoverage,
  currentSubtaskLabel,
  insertSubtaskSegment,
  replaceSubtaskSegment,
  segmentsFromFrameIndices,
  sortSubtaskSegments,
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
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const [pendingRange, setPendingRange] = useState<PendingSubtaskRange | null>(null);
  const canAnnotate = canMutateSubtasks(versionCapability);

  const resetSubtasks = useCallback(() => {
    setOverlay(new Map());
    setPendingStart(null);
    setPendingRange(null);
  }, []);

  const sourceSegments = useMemo(
    () => segmentsFromFrameIndices(sourceIndices, sourceTable),
    [sourceIndices, sourceTable],
  );

  const currentSegments = useMemo(() => {
    if (selectedEpisodeIndex == null) return [];
    if (overlay.has(selectedEpisodeIndex)) {
      return overlay.get(selectedEpisodeIndex) ?? [];
    }
    return sourceSegments;
  }, [overlay, selectedEpisodeIndex, sourceSegments]);

  const knownLabels = useMemo(() => {
    const table = buildSubtaskTable(collectSubtaskLabels(overlay.values(), sourceTable));
    return Object.values(table);
  }, [overlay, sourceTable]);

  const coverage = useMemo(
    () => computeSubtaskCoverage(episodeLength, currentSegments),
    [currentSegments, episodeLength],
  );

  const labelAtFrame = useCallback(
    (frameIndex: number) => currentSubtaskLabel(currentSegments, frameIndex),
    [currentSegments],
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

  const markStart = useCallback(
    (frameIndex: number) => {
      if (!canAnnotate || selectedEpisodeIndex == null) return;
      if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= episodeLength) {
        return;
      }
      setPendingStart(frameIndex);
      setPendingRange(null);
    },
    [canAnnotate, episodeLength, selectedEpisodeIndex],
  );

  const markEnd = useCallback(
    (frameIndex: number): boolean => {
      if (!canAnnotate || selectedEpisodeIndex == null || episodeLength <= 0) return false;
      if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= episodeLength) {
        return false;
      }
      const last = sortSubtaskSegments(currentSegments).at(-1);
      const fallbackStart =
        pendingStart ?? (last != null && last.endFrame + 1 < episodeLength ? last.endFrame + 1 : 0);
      const startFrame = Math.min(fallbackStart, frameIndex);
      const endFrame = Math.max(fallbackStart, frameIndex);
      setPendingRange({ startFrame, endFrame });
      return true;
    },
    [canAnnotate, currentSegments, episodeLength, pendingStart, selectedEpisodeIndex],
  );

  const cancelPending = useCallback(() => {
    setPendingRange(null);
  }, []);

  const commitPending = useCallback(
    (label: string) => {
      if (!canAnnotate || selectedEpisodeIndex == null || !pendingRange) {
        throw new Error('No pending subtask range');
      }
      const nextSegments = insertSubtaskSegment(
        ensureOverlayEpisode(selectedEpisodeIndex, episodeLength),
        { ...pendingRange, label },
        episodeLength,
      );
      setOverlay((previous) => {
        const next = cloneOverlay(previous);
        next.set(selectedEpisodeIndex, nextSegments);
        return next;
      });
      const nextStart = pendingRange.endFrame + 1;
      setPendingStart(nextStart < episodeLength ? nextStart : null);
      setPendingRange(null);
    },
    [canAnnotate, ensureOverlayEpisode, episodeLength, pendingRange, selectedEpisodeIndex],
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
      pendingStart,
      pendingRange,
      labelAtFrame,
      markStart,
      markEnd,
      cancelPending,
      commitPending,
      updateSegment,
      removeSegment,
      resetSubtasks,
    }),
    [
      overlay,
      canAnnotate,
      currentSegments,
      knownLabels,
      coverage,
      pendingStart,
      pendingRange,
      labelAtFrame,
      markStart,
      markEnd,
      cancelPending,
      commitPending,
      updateSegment,
      removeSegment,
      resetSubtasks,
    ],
  );
}
