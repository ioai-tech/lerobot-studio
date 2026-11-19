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
  markersOfEpisode,
  effectiveSegmentFilter,
  matchesSegmentFilter,
  offeredSegmentFilters,
  segmentFilterCounts,
  nearerEdge,
  newSegmentRangeAt,
  nextUncoveredFrame,
  composeUpdateSteps,
  pushHistory,
  rebasePending,
  reconcileHistory,
  removeHistoryEntry,
  segmentAtFrame,
  takeRedo,
  takeUndo,
  type AnnotationChange,
  type AnnotationContext,
  type AnnotationDocument,
  type AnnotationHistory,
  type AnnotationHistoryEntry,
  type PendingChange,
  type AnnotationRefusal,
  type EpisodeMetadata,
  type LeRobotVersionCapability,
  type Segment,
  type SegmentFilter,
  type SegmentPatch,
  type SubtaskSegment,
  type TimelineMarker,
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
  /** The history step this dispatch performs (undo / redo), kept with the changes in flight. */
  entry?: AnnotationHistoryEntry;
};

const COALESCE_MS = 1000;

/** A change sent to the host and its undo step. */
type InFlight = PendingChange<AnnotationHistoryEntry | null>;

/** How many sent / refused change ids are remembered. */
const REMEMBERED_CHANGES = 1000;

/** Add to a bounded set or map (oldest entries go first). */
function remember(set: Set<string>, id: string): void;
function remember<V>(map: Map<string, V>, id: string, value: V): void;
function remember<V>(store: Set<string> | Map<string, V>, id: string, value?: V): void {
  if (store instanceof Set) store.add(id);
  else store.set(id, value as V);
  if (store.size > REMEMBERED_CHANGES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
}

let changeSequence = 0;
/** A stable, unique id for one emitted change. */
function newChangeId(): string {
  changeSequence += 1;
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${random}:${changeSequence}`;
}

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
  /**
   * Controlled mode: changes sent to the host that its `value` does not show
   * yet, oldest first. The viewer shows `value` with these replayed on top.
   */
  const [pending, setPendingState] = useState<InFlight[]>([]);
  const pendingRef = useRef(pending);
  const setPending = useCallback((next: InFlight[]) => {
    pendingRef.current = next;
    setPendingState(next);
  }, []);
  /** Every change sent, by `changeId`, with its undo step (bounded): a refusal can name one later. */
  const sentRef = useRef(new Map<string, AnnotationHistoryEntry | null>());
  /** Refused `changeId`s already handled: re-rendering a refusal is harmless. */
  const handledRefusalsRef = useRef(new Set<string>());
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
  const saveState = annotation?.saveState;
  const fields = config.fields;

  const configure = useCallback((next: AnnotationConfig) => setConfig(next), []);

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
  /** The viewer is narrower than editing needs (set by the layout). */
  const [narrow, setNarrow] = useState(false);
  /** Editing is configured; the window may still be too narrow for it. */
  const editable = readOnly
    ? false
    : controlled
      ? typeof annotation?.onChange === 'function'
      : supported && episodeEditMode;
  /** Segment edit chrome and keys. `readOnly` always wins; a narrow viewer only plays and lists. */
  const canEdit = editable && !narrow;
  /** True when editing is configured but the viewer is too narrow to show it. */
  const editNeedsWiderWindow = editable && narrow;
  /** Subtask edits additionally need a dataset that can store them when uncontrolled. */
  const canEditSubtasks = canEdit && (controlled || canMutateSubtasks(versionCapability));

  // Controlled: the host's value with the changes still in flight on top.
  const rebased = useMemo(
    () => (controlled ? rebasePending(value ?? EMPTY_ANNOTATION_DOCUMENT, pending, ctx) : null),
    [controlled, ctx, pending, value],
  );
  const doc: AnnotationDocument = rebased ? rebased.doc : localDoc;

  const historyRef = useRef(history);
  historyRef.current = history;
  const setHistoryNow = useCallback((next: AnnotationHistory) => {
    historyRef.current = next;
    setHistory(next);
  }, []);
  /** Keep only the history that still applies to `against`. */
  const reconcileWith = useCallback(
    (against: AnnotationDocument) => {
      const current = historyRef.current;
      if (!current.undo.length && !current.redo.length) return;
      const next = reconcileHistory(current, against, ctx);
      if (next !== current) setHistoryNow(next);
    },
    [ctx, setHistoryNow],
  );

  // The host answered (new value): forget the changes it now shows, then keep
  // the history that applies to what is shown (value + changes in flight).
  // Rebase the live list: a change sent after this render is kept.
  const lastValueRef = useRef(value);
  useEffect(() => {
    if (!controlled || lastValueRef.current === value) return;
    lastValueRef.current = value;
    const next = rebasePending(value ?? EMPTY_ANNOTATION_DOCUMENT, pendingRef.current, ctx);
    if (next.dropped) setPending(next.pending);
    reconcileWith(next.doc);
  }, [controlled, ctx, reconcileWith, setPending, value]);

  // A refusal drops exactly the changes it names (or, without ids, the oldest
  // change in flight) and their undo steps; the host's value stands.
  const lastRefusalRef = useRef(saveState);
  useEffect(() => {
    if (!controlled || saveState === lastRefusalRef.current) return;
    lastRefusalRef.current = saveState;
    if (saveState?.kind !== 'refused') return;
    const handled = handledRefusalsRef.current;
    const named = saveState.changeIds ?? [];
    const refused = new Set(
      named.length > 0
        ? named.filter((id) => !handled.has(id))
        : pendingRef.current.slice(0, 1).map((item) => item.changeId),
    );
    if (refused.size === 0) return;
    let history = historyRef.current;
    for (const id of refused) {
      remember(handled, id);
      const entry = sentRef.current.get(id);
      if (entry) history = removeHistoryEntry(history, entry);
      sentRef.current.delete(id);
    }
    if (history !== historyRef.current) setHistoryNow(history);
    const rest = pendingRef.current.filter((item) => !refused.has(item.changeId));
    if (rest.length !== pendingRef.current.length) setPending(rest);
    reconcileWith(rebasePending(value ?? EMPTY_ANNOTATION_DOCUMENT, rest, ctx).doc);
  }, [controlled, ctx, reconcileWith, saveState, setHistoryNow, setPending, value]);

  // `reloaded`: the host's value replaced the document (another writer, a
  // reload). It is authoritative: changes still in flight are dropped once per
  // reloaded saveState object, and only the history that applies is kept.
  // Later values under the same object are ordinary answers.
  const lastReloadRef = useRef<typeof saveState>(undefined);
  useEffect(() => {
    if (!controlled || saveState?.kind !== 'reloaded' || lastReloadRef.current === saveState) {
      return;
    }
    lastReloadRef.current = saveState;
    if (pendingRef.current.length > 0) setPending([]);
    reconcileWith(value ?? EMPTY_ANNOTATION_DOCUMENT);
  }, [controlled, reconcileWith, saveState, setPending, value]);

  const docRef = useRef(doc);
  docRef.current = doc;
  const configRef = useRef(config);
  configRef.current = config;

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
      let recorded: AnnotationHistoryEntry | null = options.entry ?? null;
      if (options.record !== false && inverses.every((item) => item !== null)) {
        const entry: AnnotationHistoryEntry = {
          forward: changes,
          inverse: (inverses as AnnotationChange[]).slice().reverse(),
        };
        const now = Date.now();
        const last = lastStepRef.current;
        const history = historyRef.current;
        const top = history.undo[history.undo.length - 1];
        const folded =
          options.coalesceKey &&
          last?.key === options.coalesceKey &&
          now - last.at < COALESCE_MS &&
          top &&
          history.redo.length === 0
            ? composeUpdateSteps(top, entry)
            : null;
        if (folded && top) {
          // One step for a burst of nudges: the changes in flight that belonged
          // to the older step now belong to the folded one.
          setPending(
            pendingRef.current.map((item) => (item.tag === top ? { ...item, tag: folded } : item)),
          );
          for (const [id, tagged] of sentRef.current) {
            if (tagged === top) sentRef.current.set(id, folded);
          }
          setHistoryNow({ undo: [...history.undo.slice(0, -1), folded], redo: [] });
          recorded = folded;
        } else {
          const next = pushHistory(history, entry);
          setHistoryNow(next);
          recorded = next.undo[next.undo.length - 1] === entry ? entry : null;
        }
        lastStepRef.current = options.coalesceKey ? { key: options.coalesceKey, at: now } : null;
      } else {
        lastStepRef.current = null;
      }
      if (isControlled) {
        const sent = changes.map((change) => ({
          change,
          changeId: newChangeId(),
          tag: recorded,
        }));
        for (const item of sent) remember(sentRef.current, item.changeId, item.tag);
        setPending([...pendingRef.current, ...sent]);
        for (const item of sent) {
          current.annotation!.onChange?.(item.change, { changeId: item.changeId });
        }
      } else {
        setLocalDoc(working);
      }
      if (options.notice) {
        showNotice(options.notice.key, options.notice.values, 'info', options.notice.undo);
      } else {
        publishNotice(null);
      }
      return true;
    },
    [ctx, publishNotice, setHistoryNow, setPending, showNotice, showRefusal],
  );

  /** Undo the newest step; callers check permission. */
  const performUndo = useCallback(() => {
    const entry = historyRef.current.undo[historyRef.current.undo.length - 1];
    const step = takeUndo(historyRef.current);
    if (!step) {
      showNotice('segments.notice.nothingToUndo');
      return false;
    }
    lastStepRef.current = null;
    historyRef.current = step.history;
    if (!dispatch(step.changes, { record: false, entry })) {
      setHistoryNow(EMPTY_ANNOTATION_HISTORY);
      return false;
    }
    setHistoryNow(step.history);
    showNotice('segments.notice.undone');
    return true;
  }, [dispatch, setHistoryNow, showNotice]);

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
    const entry = step.history.undo[step.history.undo.length - 1];
    if (!dispatch(step.changes, { record: false, entry })) {
      setHistoryNow(EMPTY_ANNOTATION_HISTORY);
      return false;
    }
    setHistoryNow(step.history);
    showNotice('segments.notice.redone');
    return true;
  }, [canEdit, createId, dispatch, setHistoryNow, showNotice]);

  const reset = useCallback(() => {
    setLocalDoc(EMPTY_ANNOTATION_DOCUMENT);
    setPending([]);
    setHistoryNow(EMPTY_ANNOTATION_HISTORY);
    setSelectedSegmentId(null);
    publishNotice(null);
    setSubtaskStart(null);
    setConfirmAllOpen(false);
    lastStepRef.current = null;
  }, [publishNotice, setHistoryNow, setPending]);

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

  /**
   * Select a segment and move the playhead to its first frame. With
   * `navigate: false` (a landing that sets the playhead itself) it only
   * marks the segment selected: no seek, no episode change.
   */
  const selectSegment = useCallback(
    (id: string | null, options: { navigate?: boolean } = {}) => {
      if (id == null) {
        setSelectedSegmentId(null);
        return;
      }
      const found = findSegment(docRef.current, id);
      if (!found) return;
      setSelectedSegmentId(id);
      if (options.navigate === false) return;
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
  const markers = config.markers;
  /** Host markers of one episode, in time order (they feed the Issues filter). */
  const markersOf = useCallback(
    (episodeIndex: number | null): TimelineMarker[] => markersOfEpisode(markers, episodeIndex),
    [markers],
  );
  const episodeMarkers = useMemo(
    () => markersOf(selectedEpisodeIndex),
    [markersOf, selectedEpisodeIndex],
  );
  /** To-review segments of the selected episode that the current filter shows (Shift+A). */
  const toReviewInView = useMemo(
    () =>
      selectedEpisodeIndex == null
        ? []
        : episodeSegments
            .filter((segment) => !segment.readOnly)
            .filter((segment) => matchesSegmentFilter(segment, 'to_review', episodeMarkers))
            .filter((segment) =>
              matchesSegmentFilter(
                segment,
                effectiveSegmentFilter(
                  filter,
                  offeredSegmentFilters(segmentFilterCounts(episodeSegments, episodeMarkers)),
                ),
                episodeMarkers,
              ),
            )
            .map((segment) => ({ episodeIndex: selectedEpisodeIndex, id: segment.id })),
    [episodeMarkers, episodeSegments, filter, selectedEpisodeIndex],
  );
  const shownSaveState = saveState ?? null;
  /**
   * Whether the segment UI and keys are on: a host opted in (`annotation`),
   * editing is possible, or segments exist. A plain viewer stays as it was.
   */
  const active = useMemo(
    () =>
      controlled ||
      canEdit ||
      Object.values(doc.episodes).some((entry) => (entry?.segments.length ?? 0) > 0),
    [canEdit, controlled, doc],
  );
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
      editNeedsWiderWindow,
      setNarrow,
      markersOf,
      episodeMarkers,
      readOnly,
      fields: resolvedFields,
      active,
      saveState: shownSaveState,
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
      editNeedsWiderWindow,
      markersOf,
      episodeMarkers,
      readOnly,
      resolvedFields,
      active,
      shownSaveState,
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
