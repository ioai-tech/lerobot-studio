import { describe, expect, it } from 'vitest';
import {
  EMPTY_ANNOTATION_DOCUMENT,
  EMPTY_ANNOTATION_HISTORY,
  applyChange,
  composeUpdateSteps,
  getEpisodeSegments,
  pushHistory,
  rebasePending,
  reconcileHistory,
  removeHistoryEntry,
  type AnnotationChange,
  type AnnotationContext,
  type AnnotationDocument,
  type AnnotationHistoryEntry,
  type Segment,
} from '@/core';

const ctx: AnnotationContext = { episodeLength: (index) => (index === 0 ? 100 : undefined) };

function seg(
  id: string,
  startFrame: number,
  endFrame: number,
  extra: Partial<Segment> = {},
): Segment {
  return {
    id,
    startFrame,
    endFrame,
    task: null,
    subtasks: [],
    values: {},
    review: 'to_review',
    origin: { kind: 'manual' },
    ...extra,
  };
}

function step(doc: AnnotationDocument, change: AnnotationChange) {
  const result = applyChange(doc, change, ctx);
  if (!result.ok) throw new Error(result.refusal.code);
  const entry: AnnotationHistoryEntry = { forward: [change], inverse: [result.inverse!] };
  return { doc: result.doc, entry };
}

const ids = (doc: AnnotationDocument) => getEpisodeSegments(doc, 0).map((item) => item.id);

describe('changes in flight on top of the host value', () => {
  const create: AnnotationChange = { op: 'create', episodeIndex: 0, segment: seg('x', 10, 29) };
  const split: AnnotationChange = {
    op: 'split',
    episodeIndex: 0,
    id: 'x',
    atFrame: 20,
    newId: 'y',
  };
  const afterCreate = step(EMPTY_ANNOTATION_DOCUMENT, create);
  const afterSplit = step(afterCreate.doc, split);
  const history = pushHistory(
    pushHistory(EMPTY_ANNOTATION_HISTORY, afterCreate.entry),
    afterSplit.entry,
  );
  const pending = [
    { change: create, changeId: 'c1', tag: afterCreate.entry },
    { change: split, changeId: 'c2', tag: afterSplit.entry },
  ];

  it('the host answered the first of two: the second stays shown and history stays whole', () => {
    // What went wrong before: reconciling against the bare host value wipes undo.
    expect(reconcileHistory(history, afterCreate.doc, ctx).undo).toHaveLength(0);
    const rebased = rebasePending(afterCreate.doc, pending, ctx);
    expect(ids(rebased.doc)).toEqual(['x', 'y']);
    expect(rebased.pending).toEqual([pending[1]]);
    expect(rebased.dropped).toBe(true);
    expect(reconcileHistory(history, rebased.doc, ctx)).toBe(history);
  });

  it('nothing answered yet: everything replays; all answered: nothing is left', () => {
    const none = rebasePending(EMPTY_ANNOTATION_DOCUMENT, pending, ctx);
    expect(ids(none.doc)).toEqual(['x', 'y']);
    expect(none.pending).toHaveLength(2);
    expect(none.dropped).toBe(false);
    const all = rebasePending(afterSplit.doc, pending, ctx);
    expect(all.pending).toEqual([]);
    expect(all.doc).toBe(afterSplit.doc);
  });

  it('an update or confirm the host already applied is dropped, one it has not stays', () => {
    const base = { episodes: { 0: { segments: [seg('a', 0, 9)] } } };
    const rename: AnnotationChange = {
      op: 'update',
      episodeIndex: 0,
      id: 'a',
      patch: { task: 'pick' },
    };
    const confirm: AnnotationChange = { op: 'confirm', episodeIndex: 0, ids: ['a'] };
    const queue = [
      { change: rename, changeId: 'c1', tag: null },
      { change: confirm, changeId: 'c2', tag: null },
    ];
    expect(rebasePending(base, queue, ctx).pending).toHaveLength(2);
    const applied = step(step(base, rename).doc, confirm).doc;
    expect(rebasePending(applied, queue, ctx).pending).toEqual([]);
  });

  it('a refused step leaves history by identity, the others stay', () => {
    const removed = removeHistoryEntry(history, afterSplit.entry);
    expect(removed.undo).toEqual([afterCreate.entry]);
    expect(removeHistoryEntry(removed, afterSplit.entry)).toBe(removed);
  });
});

describe('a burst of nudges folds into one step', () => {
  const start = {
    episodes: {
      0: {
        segments: [
          seg('a', 0, 10, { subtasks: [{ startFrame: 8, endFrame: 10, label: 'grasp' }] }),
        ],
      },
    },
  };
  // Extend, then shrink past the original end (clipping the subtask).
  const extend: AnnotationChange = {
    op: 'update',
    episodeIndex: 0,
    id: 'a',
    patch: { endFrame: 12 },
  };
  const shrink: AnnotationChange = {
    op: 'update',
    episodeIndex: 0,
    id: 'a',
    patch: { endFrame: 6, subtasks: [] },
  };
  const first = step(start, extend);
  const second = step(first.doc, shrink);

  it('undo restores the clipped subtask and redo applies (the old fold lost both)', () => {
    const folded = composeUpdateSteps(first.entry, second.entry)!;
    const undone = step(second.doc, folded.inverse[0]).doc;
    expect(getEpisodeSegments(undone, 0)).toEqual(getEpisodeSegments(start, 0));
    expect(getEpisodeSegments(step(undone, folded.forward[0]).doc, 0)).toEqual(
      getEpisodeSegments(second.doc, 0),
    );
    // The previous fold: newest forward with the oldest inverse.
    const oldUndo = step(second.doc, first.entry.inverse[0]).doc;
    expect(getEpisodeSegments(oldUndo, 0)[0].subtasks).toEqual([]);
  });

  it('only single updates of one segment fold', () => {
    const other = step(start, { op: 'update', episodeIndex: 0, id: 'a', patch: { task: 't' } });
    expect(composeUpdateSteps(first.entry, other.entry)).not.toBeNull();
    const del = step(start, { op: 'delete', episodeIndex: 0, id: 'a' });
    expect(composeUpdateSteps(first.entry, del.entry)).toBeNull();
  });
});
