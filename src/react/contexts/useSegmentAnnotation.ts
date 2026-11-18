import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EMPTY_ANNOTATION_DOCUMENT,
  EMPTY_ANNOTATION_HISTORY,
  applyChange,
  canMutateSubtasks,
  clipSubtasksToRange,
  createManualSegment,
  findSegment,
  getEpisodeSegments,
  isNoopPatch,
  matchesSegmentFilter,
  nearerEdge,
  newSegmentRangeAt,
  nextUncoveredFrame,
  pushHistory,
  reconcileHistory,
  segmentAtFrame,
  takeRedo,
  takeUndo,
  type AnnotationChange,
  type AnnotationContext,
  type AnnotationDocument,
  type AnnotationHistory,
  type AnnotationRefusal,
  type EpisodeMetadata,
  type LeRobotVersionCapability,
  type Segment,
  type SegmentFilter,
  type SegmentPatch,
  type SubtaskSegment,
} from '@/core';
import type { AnnotationConfig } from './annotationTypes';

/** What the status line says after the last action. */
export type AnnotationNotice =
  | { tone: 'error'; refusal: AnnotationRefusal; key?: undefined; undo?: undefined; at: number }
  | {
      tone: 'info' | 'error';
      key: string;
      values?: Record<string, string | number>;
      undo?: boolean;
      refusal?: undefined;
      at: number;
    };

type DispatchOptions = {
  /** Record an undo step. @defaultValue true */
  record?: boolean;
  /** Consecutive steps with the same key within a second form one undo step. */
  coalesceKey?: string;
  /** Notice shown after success. */
  notice?: { key: string; values?: Record<string, string | number>; undo?: boolean };
};

const COALESCE_MS = 1000;

function defaultSegmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `seg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type UseSegmentAnnotationOptions = {
  episodes: EpisodeMetadata[];
  selectedEpisodeIndex: number | null;
  versionCapability: LeRobotVersionCapability | null;
  /** Standalone opt-in edit mode; a host-controlled viewer is always in edit mode. */
  episodeEditMode: boolean;
  /** The dataset's own subtasks of the selected episode (seed for new segments). */
  sourceSubtasks: readonly SubtaskSegment[];
  getFrameIndex: () => number;
  setFrameIndex: (index: number) => void;
  selectEpisode: (index: number) => Promise<boolean>;
};

export function useSegmentAnnotation({
  episodes,
  selectedEpisodeIndex,
  versionCapability,
  episodeEditMode,
  sourceSubtasks,
  getFrameIndex,
  setFrameIndex,
  selectEpisode,
}: UseSegmentAnnotationOptions) {
  const [config, setConfig] = useState<AnnotationConfig>({});
  const [localDoc, setLocalDoc] = useState<AnnotationDocument>(EMPTY_ANNOTATION_DOCUMENT);
  const [preview, setPreview] = useState<{
    base: AnnotationDocument;
    doc: AnnotationDocument;
  } | null>(null);
  const [history, setHistory] = useState<AnnotationHistory>(EMPTY_ANNOTATION_HISTORY);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [filter, setFilter] = useState<SegmentFilter>('all');
  const [loop, setLoop] = useState(false);
  const [notice, setNotice] = useState<AnnotationNotice | null>(null);
  const [shortcutSheetOpen, setShortcutSheetOpen] = useState(false);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  /** Frame marked with `Shift+[` as the start of the next subtask. */
  const [subtaskStart, setSubtaskStart] = useState<number | null>(null);
  const lastStepRef = useRef<{ key: string; at: number } | null>(null);

  const annotation = config.annotation;
  const controlled = annotation !== undefined;
  const value = annotation?.value;
  const saveKind = annotation?.saveState?.kind;
  const fields = config.fields;

  const configure = useCallback((next: AnnotationConfig) => setConfig(next), []);

  // A refused change leaves the host's value as it was: drop the preview.
  useEffect(() => {
    if (saveKind === 'refused') setPreview(null);
  }, [saveKind]);

  const doc: AnnotationDocument = controlled
    ? preview && preview.base === value
      ? preview.doc
      : (value ?? EMPTY_ANNOTATION_DOCUMENT)
    : localDoc;

  const lengths = useMemo(
    () => new Map(episodes.map((episode) => [episode.episode_index, episode.length])),
    [episodes],
  );
  const ctx = useMemo<AnnotationContext>(
    () => ({ episodeLength: (index) => lengths.get(index), fields }),
    [fields, lengths],
  );

  const readOnly = Boolean(config.readOnly);
  const supported = versionCapability?.status === 'supported';
  /** Segment edit chrome and keys. `readOnly` always wins. */
  const canEdit = readOnly
    ? false
    : controlled
      ? typeof annotation?.onChange === 'function'
      : supported && episodeEditMode;
  /** Subtask edits additionally need a dataset that can store them when uncontrolled. */
  const canEditSubtasks = canEdit && (controlled || canMutateSubtasks(versionCapability));

  // The host replaced its value: keep only the history that still applies.
  const lastValueRef = useRef(value);
  useEffect(() => {
    if (!controlled || lastValueRef.current === value) return;
    lastValueRef.current = value;
    setHistory((previous) =>
      previous.undo.length || previous.redo.length
        ? reconcileHistory(previous, value ?? EMPTY_ANNOTATION_DOCUMENT, ctx)
        : previous,
    );
  }, [controlled, ctx, value]);

  const docRef = useRef(doc);
  docRef.current = doc;
  const configRef = useRef(config);
  configRef.current = config;
  const historyRef = useRef(history);
  historyRef.current = history;

  const createId = useCallback(
    () => (configRef.current.annotation?.createSegmentId ?? defaultSegmentId)(),
    [],
  );

  const noticeRef = useRef<AnnotationNotice | null>(null);
  const publishNotice = useCallback((next: AnnotationNotice | null) => {
    noticeRef.current = next;
    setNotice(next);
  }, []);
  /** The notice set by the last action, readable in the same event handler. */
  const getLastNotice = useCallback(() => noticeRef.current, []);

  const showRefusal = useCallback(
    (refusal: AnnotationRefusal) => {
      publishNotice({ tone: 'error', refusal, at: Date.now() });
    },
    [publishNotice],
  );

  const showNotice = useCallback(
    (
      key: string,
      values?: Record<string, string | number>,
      tone: 'info' | 'error' = 'info',
      undo?: boolean,
    ) => {
      publishNotice({ tone, key, values, undo, at: Date.now() });
    },
    [publishNotice],
  );

  /** Apply changes in order; all or nothing. Returns false (and shows why) on refusal. */
  const dispatch = useCallback(
    (changes: AnnotationChange[], options: DispatchOptions = {}): boolean => {
      if (changes.length === 0) return true;
      const current = configRef.current;
      const isControlled = current.annotation !== undefined;
      let working = docRef.current;
      const inverses: Array<AnnotationChange | null> = [];
      for (const change of changes) {
        const result = applyChange(working, change, ctx);
        if (!result.ok) {
          showRefusal(result.refusal);
          return false;
        }
        working = result.doc;
        inverses.push(result.inverse);
      }
      docRef.current = working;
      if (isControlled) {
        const base = current.annotation!.value;
        setPreview({ base, doc: working });
        for (const change of changes) current.annotation!.onChange?.(change);
      } else {
        setLocalDoc(working);
      }
      if (options.record !== false && inverses.every((item) => item !== null)) {
        const entry = {
          forward: changes,
          inverse: (inverses as AnnotationChange[]).slice().reverse(),
        };
        const now = Date.now();
        const last = lastStepRef.current;
        const top = historyRef.current.undo[historyRef.current.undo.length - 1];
        const next =
          options.coalesceKey &&
          last?.key === options.coalesceKey &&
          now - last.at < COALESCE_MS &&
          top &&
          historyRef.current.redo.length === 0
            ? {
                undo: [
                  ...historyRef.current.undo.slice(0, -1),
                  { forward: changes, inverse: top.inverse },
                ],
                redo: [],
              }
            : pushHistory(historyRef.current, entry);
        historyRef.current = next;
        setHistory(next);
        lastStepRef.current = options.coalesceKey ? { key: options.coalesceKey, at: now } : null;
      } else {
        lastStepRef.current = null;
      }
      if (options.notice) {
        showNotice(options.notice.key, options.notice.values, 'info', options.notice.undo);
      } else {
        publishNotice(null);
      }
      return true;
    },
    [ctx, publishNotice, showNotice, showRefusal],
  );

  /** Undo the newest step; callers check permission. */
  const performUndo = useCallback(() => {
    const step = takeUndo(historyRef.current);
    if (!step) {
      showNotice('segments.notice.nothingToUndo');
      return false;
    }
    lastStepRef.current = null;
    historyRef.current = step.history;
    if (!dispatch(step.changes, { record: false })) {
      historyRef.current = EMPTY_ANNOTATION_HISTORY;
      setHistory(EMPTY_ANNOTATION_HISTORY);
      return false;
    }
    setHistory(step.history);
    showNotice('segments.notice.undone');
    return true;
  }, [dispatch, showNotice]);

  const undo = useCallback(() => canEdit && performUndo(), [canEdit, performUndo]);

  /** The newest undo step, as an opaque token (`null` when there is none). */
  const latestStep = useCallback(
    (): object | null => historyRef.current.undo[historyRef.current.undo.length - 1] ?? null,
    [],
  );
  /**
   * Undo `step` only while it is still the newest step, so a tool that made a
   * batch (e.g. suggestions) never undoes someone else's later edit.
   */
  const undoStep = useCallback(
    (step: object | null) => step !== null && latestStep() === step && performUndo(),
    [latestStep, performUndo],
  );

  const redo = useCallback(() => {
    if (!canEdit) return false;
    const step = takeRedo(historyRef.current, createId);
    if (!step) {
      showNotice('segments.notice.nothingToRedo');
      return false;
    }
    lastStepRef.current = null;
    historyRef.current = step.history;
    if (!dispatch(step.changes, { record: false })) {
      historyRef.current = EMPTY_ANNOTATION_HISTORY;
      setHistory(EMPTY_ANNOTATION_HISTORY);
      return false;
    }
    setHistory(step.history);
    showNotice('segments.notice.redone');
    return true;
  }, [canEdit, createId, dispatch, showNotice]);

  const reset = useCallback(() => {
    setLocalDoc(EMPTY_ANNOTATION_DOCUMENT);
    setPreview(null);
    setHistory(EMPTY_ANNOTATION_HISTORY);
    historyRef.current = EMPTY_ANNOTATION_HISTORY;
    setSelectedSegmentId(null);
    publishNotice(null);
    setSubtaskStart(null);
    setConfirmAllOpen(false);
    lastStepRef.current = null;
  }, [publishNotice]);

  const episodeSegments = useMemo(
    () => (selectedEpisodeIndex == null ? [] : getEpisodeSegments(doc, selectedEpisodeIndex)),
    [doc, selectedEpisodeIndex],
  );
  const selected = useMemo(() => {
    if (!selectedSegmentId) return null;
    return findSegment(doc, selectedSegmentId);
  }, [doc, selectedSegmentId]);

  // A segment that disappeared (deleted, merged, host reload) is no longer selected.
  useEffect(() => {
    if (selectedSegmentId && !selected) setSelectedSegmentId(null);
  }, [selected, selectedSegmentId]);

  // Choosing another dataset episode drops a selection that belongs elsewhere.
  useEffect(() => {
    setSubtaskStart(null);
    setSelectedSegmentId((current) => {
      if (!current) return current;
      const found = findSegment(docRef.current, current);
      return found && found.episodeIndex === selectedEpisodeIndex ? current : null;
    });
  }, [selectedEpisodeIndex]);

  const pendingSeekRef = useRef<{ episodeIndex: number; frame: number } | null>(null);
  const flushPendingSeek = useCallback(
    (episodeIndex: number | null, frameCount: number) => {
      const pending = pendingSeekRef.current;
      if (!pending || pending.episodeIndex !== episodeIndex || frameCount <= 0) return;
      pendingSeekRef.current = null;
      setFrameIndex(Math.min(pending.frame, frameCount - 1));
    },
    [setFrameIndex],
  );

  /** Select a segment and move the playhead to its first frame. */
  const selectSegment = useCallback(
    (id: string | null) => {
      if (id == null) {
        setSelectedSegmentId(null);
        return;
      }
      const found = findSegment(docRef.current, id);
      if (!found) return;
      setSelectedSegmentId(id);
      if (found.episodeIndex === selectedEpisodeIndex) {
        setFrameIndex(found.segment.startFrame);
      } else {
        pendingSeekRef.current = {
          episodeIndex: found.episodeIndex,
          frame: found.segment.startFrame,
        };
        void selectEpisode(found.episodeIndex);
      }
    },
    [selectEpisode, selectedEpisodeIndex, setFrameIndex],
  );

  const requireEpisode = useCallback((): number | null => {
    if (selectedEpisodeIndex == null || !lengths.get(selectedEpisodeIndex)) return null;
    return selectedEpisodeIndex;
  }, [lengths, selectedEpisodeIndex]);

  const requireSelected = useCallback((): { episodeIndex: number; segment: Segment } | null => {
    if (!selectedSegmentId) {
      showNotice('segments.notice.selectFirst', undefined, 'error');
      return null;
    }
    const found = findSegment(docRef.current, selectedSegmentId);
    if (!found) {
      showNotice('segments.notice.selectFirst', undefined, 'error');
      return null;
    }
    return found;
  }, [selectedSegmentId, showNotice]);

  const seedSubtasks = useCallback(
    (range: { startFrame: number; endFrame: number }) =>
      clipSubtasksToRange(sourceSubtasks, range).map((subtask) => ({ ...subtask })),
    [sourceSubtasks],
  );

  const newReview = annotation?.newSegmentReview ?? 'confirmed';

  /** N: a new segment from the playhead to the next boundary. */
  const createAtPlayhead = useCallback(() => {
    const episodeIndex = requireEpisode();
    if (episodeIndex == null || !canEdit) return false;
    const frame = getFrameIndex();
    const length = lengths.get(episodeIndex)!;
    const range = newSegmentRangeAt(
      getEpisodeSegments(docRef.current, episodeIndex),
      frame,
      length,
    );
    if (!range) {
      showNotice('segments.notice.insideSegment', undefined, 'error');
      return false;
    }
    const segment = createManualSegment({
      id: createId(),
      ...range,
      review: newReview,
      subtasks: seedSubtasks(range),
    });
    const ok = dispatch([{ op: 'create', episodeIndex, segment }], {
      notice: { key: 'segments.notice.created' },
    });
    if (ok) setSelectedSegmentId(segment.id);
    return ok;
  }, [
    canEdit,
    createId,
    dispatch,
    getFrameIndex,
    lengths,
    newReview,
    requireEpisode,
    seedSubtasks,
    showNotice,
  ]);

  /** Change a segment's range; subtasks outside the new range are cut explicitly. */
  const updateRange = useCallback(
    (
      found: { episodeIndex: number; segment: Segment },
      range: { startFrame: number; endFrame: number },
      coalesceKey?: string,
    ) => {
      const { episodeIndex, segment } = found;
      const patch: SegmentPatch = {};
      if (range.startFrame !== segment.startFrame) patch.startFrame = range.startFrame;
      if (range.endFrame !== segment.endFrame) patch.endFrame = range.endFrame;
      if (Object.keys(patch).length === 0) return true;
      const clipped = clipSubtasksToRange(segment.subtasks, range);
      if (!isNoopPatch(segment, { subtasks: clipped })) patch.subtasks = clipped;
      return dispatch([{ op: 'update', episodeIndex, id: segment.id, patch }], { coalesceKey });
    },
    [dispatch],
  );

  /** `[` / `]`: set in / out of the selected segment at the playhead. */
  const setEdgeAtPlayhead = useCallback(
    (edge: 'start' | 'end') => {
      if (!canEdit) return false;
      const found = requireSelected();
      if (!found) return false;
      if (found.episodeIndex !== selectedEpisodeIndex) return false;
      const frame = getFrameIndex();
      return updateRange(
        found,
        edge === 'start'
          ? { startFrame: frame, endFrame: found.segment.endFrame }
          : { startFrame: found.segment.startFrame, endFrame: frame },
      );
    },
    [canEdit, getFrameIndex, requireSelected, selectedEpisodeIndex, updateRange],
  );

  /** `,` `.`: move one edge of the selected segment by `delta` frames. */
  const nudgeEdge = useCallback(
    (edge: 'start' | 'end', delta: number) => {
      if (!canEdit) return false;
      const found = requireSelected();
      if (!found) return false;
      const { segment } = found;
      const range =
        edge === 'start'
          ? { startFrame: segment.startFrame + delta, endFrame: segment.endFrame }
          : { startFrame: segment.startFrame, endFrame: segment.endFrame + delta };
      const ok = updateRange(found, range, `nudge:${segment.id}:${edge}`);
      if (ok && found.episodeIndex === selectedEpisodeIndex) {
        setFrameIndex(edge === 'start' ? range.startFrame : range.endFrame);
      }
      return ok;
    },
    [canEdit, requireSelected, selectedEpisodeIndex, setFrameIndex, updateRange],
  );

  /** Move the edge of the selected segment nearer to the playhead by `delta` frames. */
  const nudgeEdgeNearPlayhead = useCallback(
    (delta: number) => {
      if (!canEdit) return false;
      const found = requireSelected();
      if (!found) return false;
      return nudgeEdge(nearerEdge(found.segment, getFrameIndex()), delta);
    },
    [canEdit, getFrameIndex, nudgeEdge, requireSelected],
  );

  const setRange = useCallback(
    (id: string, range: { startFrame: number; endFrame: number }) => {
      if (!canEdit) return false;
      const found = findSegment(docRef.current, id);
      if (!found) return false;
      return updateRange(found, range);
    },
    [canEdit, updateRange],
  );

  const updateSegment = useCallback(
    (id: string, patch: SegmentPatch) => {
      if (!canEdit) return false;
      const found = findSegment(docRef.current, id);
      if (!found) return false;
      if (isNoopPatch(found.segment, patch)) return true;
      return dispatch([{ op: 'update', episodeIndex: found.episodeIndex, id, patch }]);
    },
    [canEdit, dispatch],
  );

  const splitAtPlayhead = useCallback(() => {
    if (!canEdit) return false;
    const episodeIndex = requireEpisode();
    if (episodeIndex == null) return false;
    const frame = getFrameIndex();
    const target =
      (selected &&
      selected.episodeIndex === episodeIndex &&
      frame > selected.segment.startFrame &&
      frame <= selected.segment.endFrame
        ? selected.segment
        : null) ?? segmentAtFrame(getEpisodeSegments(docRef.current, episodeIndex), frame);
    if (!target) {
      showNotice('segments.notice.splitOutside', undefined, 'error');
      return false;
    }
    if (frame === target.startFrame) {
      showNotice('segments.notice.splitAtStart', undefined, 'error');
      return false;
    }
    const ok = dispatch(
      [{ op: 'split', episodeIndex, id: target.id, atFrame: frame, newId: createId() }],
      { notice: { key: 'segments.notice.split', undo: true } },
    );
    return ok;
  }, [canEdit, createId, dispatch, getFrameIndex, requireEpisode, selected, showNotice]);

  const mergeWithNext = useCallback(() => {
    if (!canEdit) return false;
    const found = requireSelected();
    if (!found) return false;
    const segments = getEpisodeSegments(docRef.current, found.episodeIndex);
    const next = segments[segments.findIndex((item) => item.id === found.segment.id) + 1];
    if (!next) {
      showNotice('segments.notice.nothingToMerge', undefined, 'error');
      return false;
    }
    return dispatch(
      [{ op: 'merge', episodeIndex: found.episodeIndex, id: found.segment.id, withId: next.id }],
      { notice: { key: 'segments.notice.merged', undo: true } },
    );
  }, [canEdit, dispatch, requireSelected, showNotice]);

  const deleteSelected = useCallback(() => {
    if (!canEdit) return false;
    const found = requireSelected();
    if (!found) return false;
    const canDelete = configRef.current.annotation?.canDelete;
    if (canDelete && !canDelete(found.segment)) {
      showNotice('segments.notice.cannotDelete', undefined, 'error');
      return false;
    }
    const segments = getEpisodeSegments(docRef.current, found.episodeIndex);
    const position = segments.findIndex((item) => item.id === found.segment.id);
    const neighbour = segments[position + 1] ?? segments[position - 1] ?? null;
    const ok = dispatch(
      [{ op: 'delete', episodeIndex: found.episodeIndex, id: found.segment.id }],
      { notice: { key: 'segments.notice.deleted', values: { n: position + 1 }, undo: true } },
    );
    if (ok) setSelectedSegmentId(neighbour?.id ?? null);
    return ok;
  }, [canEdit, dispatch, requireSelected, showNotice]);

  const confirmIds = useCallback(
    (ids: ReadonlyArray<{ episodeIndex: number; id: string }>) => {
      if (!canEdit || ids.length === 0) return false;
      const byEpisode = new Map<number, string[]>();
      for (const { episodeIndex, id } of ids) {
        byEpisode.set(episodeIndex, [...(byEpisode.get(episodeIndex) ?? []), id]);
      }
      return dispatch(
        Array.from(byEpisode, ([episodeIndex, list]) => ({
          op: 'confirm' as const,
          episodeIndex,
          ids: list,
        })),
        {
          record: false,
          notice: { key: 'segments.notice.confirmed', values: { count: ids.length } },
        },
      );
    },
    [canEdit, dispatch],
  );

  const confirmSelected = useCallback(() => {
    if (!canEdit) return false;
    const found = requireSelected();
    if (!found) return false;
    return confirmIds([{ episodeIndex: found.episodeIndex, id: found.segment.id }]);
  }, [canEdit, confirmIds, requireSelected]);

  const setFieldValue = useCallback(
    (fieldId: string, fieldValue: string | string[] | null) => {
      if (!canEdit) return false;
      const found = requireSelected();
      if (!found) return false;
      return updateSegment(found.segment.id, { values: { [fieldId]: fieldValue } });
    },
    [canEdit, requireSelected, updateSegment],
  );

  /** G: the playhead goes to the next frame no segment covers. */
  const jumpToNextUncovered = useCallback(() => {
    const episodeIndex = requireEpisode();
    if (episodeIndex == null) return false;
    const frame = nextUncoveredFrame(
      getEpisodeSegments(docRef.current, episodeIndex),
      getFrameIndex(),
      lengths.get(episodeIndex)!,
    );
    if (frame == null) {
      showNotice('segments.notice.allCovered');
      return false;
    }
    setSelectedSegmentId(null);
    setFrameIndex(frame);
    return true;
  }, [getFrameIndex, lengths, requireEpisode, setFrameIndex, showNotice]);

  /** J / K: the next / previous segment, across episodes in dataset order. */
  const selectRelative = useCallback(
    (delta: 1 | -1) => {
      const order = episodes.flatMap((episode) =>
        getEpisodeSegments(docRef.current, episode.episode_index).map((segment) => ({
          episodeIndex: episode.episode_index,
          segment,
        })),
      );
      if (order.length === 0) {
        showNotice('segments.notice.none');
        return false;
      }
      let position = selectedSegmentId
        ? order.findIndex((item) => item.segment.id === selectedSegmentId)
        : -1;
      if (position < 0) {
        // Start from the playhead: the first segment after it (or before it for K).
        const frame = getFrameIndex();
        const here = order.filter((item) => item.episodeIndex === selectedEpisodeIndex);
        const candidate =
          delta === 1
            ? here.find((item) => item.segment.endFrame >= frame)
            : [...here].reverse().find((item) => item.segment.startFrame <= frame);
        const target = candidate ?? (delta === 1 ? order[0] : order[order.length - 1]);
        selectSegment(target.segment.id);
        return true;
      }
      position += delta;
      if (position < 0 || position >= order.length) {
        showNotice(delta === 1 ? 'segments.notice.last' : 'segments.notice.first');
        return false;
      }
      selectSegment(order[position].segment.id);
      return true;
    },
    [episodes, getFrameIndex, selectSegment, selectedEpisodeIndex, selectedSegmentId, showNotice],
  );

  const toggleLoop = useCallback(() => setLoop((previous) => !previous), []);
  const clearNotice = useCallback(() => publishNotice(null), [publishNotice]);

  const loopStart =
    loop && selected && selected.episodeIndex === selectedEpisodeIndex
      ? selected.segment.startFrame
      : null;
  const loopEnd = loopStart != null && selected ? selected.segment.endFrame : null;
  const loopRange = useMemo(
    () =>
      loopStart != null && loopEnd != null
        ? { startFrame: loopStart, endFrame: loopEnd }
        : undefined,
    [loopEnd, loopStart],
  );
  /** To-review segments of the selected episode that the current filter shows (Shift+A). */
  const toReviewInView = useMemo(
    () =>
      selectedEpisodeIndex == null
        ? []
        : episodeSegments
            .filter((segment) => segment.review === 'to_review' && !segment.readOnly)
            .filter((segment) => matchesSegmentFilter(segment, filter))
            .map((segment) => ({ episodeIndex: selectedEpisodeIndex, id: segment.id })),
    [episodeSegments, filter, selectedEpisodeIndex],
  );
  const saveState = annotation?.saveState ?? null;
  const canUndo = canEdit && history.undo.length > 0;
  const canRedo = canEdit && history.redo.length > 0;
  const resolvedFields = useMemo(() => fields ?? [], [fields]);

  return useMemo(
    () => ({
      configure,
      config,
      controlled,
      doc,
      ctx,
      canEdit,
      canEditSubtasks,
      readOnly,
      fields: resolvedFields,
      saveState,
      canUndo,
      canRedo,
      episodeSegments,
      selectedSegmentId,
      selected,
      filter,
      setFilter,
      loop,
      loopRange,
      toggleLoop,
      notice,
      getLastNotice,
      showNotice,
      clearNotice,
      dispatch,
      undo,
      latestStep,
      undoStep,
      redo,
      reset,
      createId,
      selectSegment,
      flushPendingSeek,
      createAtPlayhead,
      setEdgeAtPlayhead,
      nudgeEdge,
      nudgeEdgeNearPlayhead,
      setRange,
      updateSegment,
      splitAtPlayhead,
      mergeWithNext,
      deleteSelected,
      confirmSelected,
      confirmIds,
      setFieldValue,
      jumpToNextUncovered,
      selectRelative,
      toReviewInView,
      shortcutSheetOpen,
      setShortcutSheetOpen,
      confirmAllOpen,
      setConfirmAllOpen,
      subtaskStart,
      setSubtaskStart,
    }),
    [
      configure,
      config,
      controlled,
      doc,
      ctx,
      canEdit,
      canEditSubtasks,
      readOnly,
      resolvedFields,
      saveState,
      canUndo,
      canRedo,
      episodeSegments,
      selectedSegmentId,
      selected,
      filter,
      loop,
      loopRange,
      toggleLoop,
      notice,
      getLastNotice,
      showNotice,
      clearNotice,
      dispatch,
      undo,
      latestStep,
      undoStep,
      redo,
      reset,
      createId,
      selectSegment,
      flushPendingSeek,
      createAtPlayhead,
      setEdgeAtPlayhead,
      nudgeEdge,
      nudgeEdgeNearPlayhead,
      setRange,
      updateSegment,
      splitAtPlayhead,
      mergeWithNext,
      deleteSelected,
      confirmSelected,
      confirmIds,
      setFieldValue,
      jumpToNextUncovered,
      selectRelative,
      toReviewInView,
      shortcutSheetOpen,
      confirmAllOpen,
      subtaskStart,
    ],
  );
}

export type SegmentAnnotationState = ReturnType<typeof useSegmentAnnotation>;
