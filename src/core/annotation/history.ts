import { applyChange } from './reducer';
import type { AnnotationChange, AnnotationContext, AnnotationDocument, Segment } from './types';

/** Undo / redo keeps at most this many steps. */
export const ANNOTATION_HISTORY_LIMIT = 100;

/**
 * One undoable step. `forward` is what was applied (in order); `inverse`
 * undoes it (in order). A batch (e.g. applying suggestions) is one step.
 */
export interface AnnotationHistoryEntry {
  forward: AnnotationChange[];
  inverse: AnnotationChange[];
}

export interface AnnotationHistory {
  undo: AnnotationHistoryEntry[];
  redo: AnnotationHistoryEntry[];
}

export const EMPTY_ANNOTATION_HISTORY: AnnotationHistory = Object.freeze({
  undo: [],
  redo: [],
}) as AnnotationHistory;

/** Record an applied step; a new step drops the redo stack. */
export function pushHistory(
  history: AnnotationHistory,
  entry: AnnotationHistoryEntry,
): AnnotationHistory {
  if (entry.forward.length === 0 || entry.inverse.length !== entry.forward.length) return history;
  const undo = [...history.undo, entry];
  return { undo: undo.slice(Math.max(0, undo.length - ANNOTATION_HISTORY_LIMIT)), redo: [] };
}

/** Take the newest step: emit `changes` and keep the step for redo. */
export function takeUndo(
  history: AnnotationHistory,
): { history: AnnotationHistory; changes: AnnotationChange[] } | null {
  const entry = history.undo[history.undo.length - 1];
  if (!entry) return null;
  return {
    history: { undo: history.undo.slice(0, -1), redo: [...history.redo, entry] },
    changes: entry.inverse,
  };
}

function renameSegmentId(segment: Segment, from: string, to: string): Segment {
  return segment.id === from ? { ...segment, id: to } : segment;
}

function renameInChange(change: AnnotationChange, from: string, to: string): AnnotationChange {
  const swap = (id: string) => (id === from ? to : id);
  switch (change.op) {
    case 'create':
    case 'restore':
      return { ...change, segment: renameSegmentId(change.segment, from, to) };
    case 'update':
    case 'delete':
      return { ...change, id: swap(change.id) };
    case 'split':
      return { ...change, id: swap(change.id), newId: swap(change.newId) };
    case 'merge':
      return { ...change, id: swap(change.id), withId: swap(change.withId) };
    case 'unmerge':
      return {
        ...change,
        id: swap(change.id),
        restored: renameSegmentId(change.restored, from, to),
        before: renameSegmentId(change.before, from, to),
      };
    case 'confirm':
      return { ...change, ids: change.ids.map(swap) };
  }
}

function renameInEntry(
  entry: AnnotationHistoryEntry,
  from: string,
  to: string,
): AnnotationHistoryEntry {
  return {
    forward: entry.forward.map((change) => renameInChange(change, from, to)),
    inverse: entry.inverse.map((change) => renameInChange(change, from, to)),
  };
}

/**
 * Take the most recently undone step for redo. Ids are never reused for new
 * rows: a redone `split` mints a fresh `newId` (the undo merged the old one
 * away), and later redo steps follow the new id. A redone `create` brings its
 * segment back with `restore` (the undo deleted it).
 */
export function takeRedo(
  history: AnnotationHistory,
  createSegmentId: () => string,
): { history: AnnotationHistory; changes: AnnotationChange[] } | null {
  const entry = history.redo[history.redo.length - 1];
  if (!entry) return null;
  let current = entry;
  let rest = history.redo.slice(0, -1);
  const changes: AnnotationChange[] = [];
  for (let index = 0; index < current.forward.length; index++) {
    const change = current.forward[index];
    if (change.op === 'split') {
      const fresh = createSegmentId();
      current = renameInEntry(current, change.newId, fresh);
      rest = rest.map((item) => renameInEntry(item, change.newId, fresh));
      changes.push(current.forward[index]);
    } else if (change.op === 'create') {
      changes.push({ op: 'restore', episodeIndex: change.episodeIndex, segment: change.segment });
    } else {
      changes.push(change);
    }
  }
  return {
    history: { undo: [...history.undo, { ...current, forward: changes }], redo: rest },
    changes,
  };
}

function replay(
  doc: AnnotationDocument,
  changes: readonly AnnotationChange[],
  ctx: AnnotationContext,
): AnnotationDocument | null {
  let current = doc;
  for (const change of changes) {
    const result = applyChange(current, change, ctx);
    if (!result.ok) return null;
    current = result.doc;
  }
  return current;
}

/**
 * Keep only the history that still applies to `doc` (e.g. after a host
 * reload). Undo is dry-run newest first; redo is dry-run from `doc`. A stack
 * that no longer applies is cleared, never partially replayed.
 */
export function reconcileHistory(
  history: AnnotationHistory,
  doc: AnnotationDocument,
  ctx: AnnotationContext,
): AnnotationHistory {
  let undoOk = true;
  let current: AnnotationDocument | null = doc;
  for (let index = history.undo.length - 1; index >= 0 && current; index--) {
    current = replay(current, history.undo[index].inverse, ctx);
  }
  if (!current) undoOk = false;

  let redoOk = true;
  current = doc;
  let probe = 0;
  let pending: AnnotationHistory = { undo: [], redo: history.redo };
  while (current && pending.redo.length > 0) {
    const step = takeRedo(pending, () => `\u0000probe-${probe++}`);
    if (!step) break;
    pending = step.history;
    current = replay(current, step.changes, ctx);
  }
  if (!current) redoOk = false;

  if (undoOk && redoOk) return history;
  return { undo: undoOk ? history.undo : [], redo: redoOk ? history.redo : [] };
}
