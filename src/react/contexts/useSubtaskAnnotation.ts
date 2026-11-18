import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AnnotationChange,
  AnnotationDocument,
  ReviewState,
  Segment,
  SubtaskSegment,
  SubtaskTable,
} from '@/core';
import {
  buildSubtaskTable,
  collectSubtaskLabels,
  computeSubtaskCoverage,
  createManualSegment,
  findOverlappingSegment,
  insertSubtaskSegment,
  replaceSubtaskSegment,
  segmentAtFrame,
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
  /** Subtask edits are allowed (segment editing on, and storable). */
  canAnnotate: boolean;
  /** Host-controlled: subtasks need an existing segment. */
  controlled: boolean;
  selectedEpisodeIndex: number | null;
  episodeLength: number;
  sourceTable: SubtaskTable;
  /** The dataset's own subtasks of the selected episode. */
  sourceSegments: SubtaskSegment[];
  /** Segments of the selected episode, sorted. */
  segments: Segment[];
  doc: AnnotationDocument;
  dispatch: (changes: AnnotationChange[]) => boolean;
  createId: () => string;
  newSegmentReview: ReviewState;
  showNotice: (
    key: string,
    values?: Record<string, string | number>,
    tone?: 'info' | 'error',
  ) => void;
};

/**
 * Subtasks live inside segments. The lane shows the subtasks of the selected
 * episode's segments (or the dataset's own labels when it has none); every
 * edit becomes `update { subtasks }` of the segment that contains it. In the
 * standalone app, labelling an episode without segments first makes one
 * segment spanning the whole episode (it exports exactly like the whole episode).
 */
export function useSubtaskAnnotation({
  canAnnotate,
  controlled,
  selectedEpisodeIndex,
  episodeLength,
  sourceTable,
  sourceSegments,
  segments,
  doc,
  dispatch,
  createId,
  newSegmentReview,
  showNotice,
}: UseSubtaskAnnotationOptions) {
  const [pendingRange, setPendingRange] = useState<PendingSubtaskRange | null>(null);

  const currentSegments = useMemo(() => {
    if (selectedEpisodeIndex == null || episodeLength <= 0) return [];
    const raw =
      segments.length > 0 ? segments.flatMap((segment) => segment.subtasks) : sourceSegments;
    return sortSubtaskSegments(segmentsInsideEpisode(raw, episodeLength));
  }, [episodeLength, segments, selectedEpisodeIndex, sourceSegments]);

  useEffect(() => {
    setPendingRange(null);
  }, [selectedEpisodeIndex]);

  const knownLabels = useMemo(() => {
    const all = Object.values(doc.episodes).flatMap((entry) =>
      (entry?.segments ?? []).map((segment) => segment.subtasks),
    );
    const table = buildSubtaskTable(collectSubtaskLabels([...all, sourceSegments], sourceTable));
    return Object.values(table);
  }, [doc, sourceSegments, sourceTable]);

  const coverage = useMemo(
    () => computeSubtaskCoverage(episodeLength, currentSegments),
    [currentSegments, episodeLength],
  );

  /** Store a new subtask list for the episode as segment updates (one undo step). */
  const replaceEpisodeSegments = useCallback(
    (nextSubtasks: SubtaskSegment[]): boolean => {
      if (!canAnnotate || selectedEpisodeIndex == null) return false;
      let next: SubtaskSegment[];
      try {
        next = sortSubtaskSegments(
          nextSubtasks.map((subtask) => validateSubtaskSegment(subtask, episodeLength)),
        );
        next.forEach((subtask, index) => {
          if (findOverlappingSegment(next, subtask, index)) throw new Error('overlap');
        });
      } catch {
        showNotice('segments.notice.subtaskInvalid', undefined, 'error');
        return false;
      }
      if (segments.length === 0) {
        if (controlled) {
          showNotice('segments.notice.subtaskNeedsSegment', undefined, 'error');
          return false;
        }
        const segment = createManualSegment({
          id: createId(),
          startFrame: 0,
          endFrame: episodeLength - 1,
          review: newSegmentReview,
          subtasks: next,
        });
        return dispatch([{ op: 'create', episodeIndex: selectedEpisodeIndex, segment }]);
      }
      const bySegment = new Map<string, SubtaskSegment[]>(segments.map((item) => [item.id, []]));
      for (const subtask of next) {
        const owner = segments.find(
          (item) => subtask.startFrame >= item.startFrame && subtask.endFrame <= item.endFrame,
        );
        if (!owner) {
          showNotice('segments.notice.subtaskOutside', undefined, 'error');
          return false;
        }
        bySegment.get(owner.id)!.push({ ...subtask });
      }
      const changes: AnnotationChange[] = [];
      for (const segment of segments) {
        const list = bySegment.get(segment.id)!;
        const current = sortSubtaskSegments(segment.subtasks);
        const same =
          list.length === current.length &&
          list.every(
            (item, index) =>
              item.label === current[index].label &&
              item.startFrame === current[index].startFrame &&
              item.endFrame === current[index].endFrame,
          );
        if (!same) {
          changes.push({
            op: 'update',
            episodeIndex: selectedEpisodeIndex,
            id: segment.id,
            patch: { subtasks: list },
          });
        }
      }
      return dispatch(changes);
    },
    [
      canAnnotate,
      controlled,
      createId,
      dispatch,
      episodeLength,
      newSegmentReview,
      segments,
      selectedEpisodeIndex,
      showNotice,
    ],
  );

  /** Bound a lane range to the segment that contains `frame` (when segments exist). */
  const boundToSegment = useCallback(
    (range: PendingSubtaskRange, frame: number): PendingSubtaskRange | null => {
      if (segments.length === 0) return controlled ? null : range;
      const owner = segmentAtFrame(segments, frame);
      if (!owner) return null;
      const startFrame = Math.max(range.startFrame, owner.startFrame);
      const endFrame = Math.min(range.endFrame, owner.endFrame);
      return startFrame <= endFrame ? { startFrame, endFrame } : null;
    },
    [controlled, segments],
  );

  const endAtPlayhead = useCallback(
    (frameIndex: number): boolean => {
      if (!canAnnotate || selectedEpisodeIndex == null) return false;
      const range = subtaskRangeToPlayhead(currentSegments, frameIndex, episodeLength);
      const bounded = range ? boundToSegment(range, frameIndex) : null;
      if (!bounded) return false;
      setPendingRange(bounded);
      return true;
    },
    [boundToSegment, canAnnotate, currentSegments, episodeLength, selectedEpisodeIndex],
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
      const next = insertSubtaskSegment(currentSegments, { ...range, label }, episodeLength);
      if (replaceEpisodeSegments(next)) setPendingRange(null);
    },
    [
      canAnnotate,
      currentSegments,
      episodeLength,
      pendingRange,
      replaceEpisodeSegments,
      selectedEpisodeIndex,
    ],
  );

  const updateSegment = useCallback(
    (index: number, segment: SubtaskSegment) => {
      if (!canAnnotate || selectedEpisodeIndex == null) return;
      try {
        replaceEpisodeSegments(
          replaceSubtaskSegment(currentSegments, index, segment, episodeLength),
        );
      } catch {
        showNotice('segments.notice.subtaskInvalid', undefined, 'error');
      }
    },
    [
      canAnnotate,
      currentSegments,
      episodeLength,
      replaceEpisodeSegments,
      selectedEpisodeIndex,
      showNotice,
    ],
  );

  const removeSegment = useCallback(
    (index: number) => {
      if (!canAnnotate || selectedEpisodeIndex == null) return;
      if (index < 0 || index >= currentSegments.length) return;
      replaceEpisodeSegments(currentSegments.filter((_, itemIndex) => itemIndex !== index));
    },
    [canAnnotate, currentSegments, replaceEpisodeSegments, selectedEpisodeIndex],
  );

  return useMemo(
    () => ({
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
    }),
    [
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
    ],
  );
}
