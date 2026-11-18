import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_HISTORY_LIMIT,
  EMPTY_ANNOTATION_DOCUMENT,
  EMPTY_ANNOTATION_HISTORY,
  applyChange,
  getEpisodeSegments,
  pushHistory,
  reconcileHistory,
  takeRedo,
  takeUndo,
  type AnnotationChange,
  type AnnotationContext,
  type AnnotationDocument,
  type AnnotationField,
  type AnnotationRefusalCode,
  type Segment,
} from '@/core';

const fields: AnnotationField[] = [
  {
    id: 'outcome',
    label: 'Outcome',
    kind: 'select',
    options: [
      { value: 'success', label: 'Success', key: '1' },
      { value: 'failure', label: 'Failure', key: '2' },
    ],
  },
  { id: 'tags', label: 'Tags', kind: 'tags' },
  { id: 'note', label: 'Note', kind: 'text' },
];

const ctx: AnnotationContext = {
  episodeLength: (index) => (index === 0 ? 100 : index === 1 ? 50 : undefined),
  fields,
};

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
    review: 'confirmed',
    origin: { kind: 'manual' },
    ...extra,
  };
}

function doc(...segments: Segment[]): AnnotationDocument {
  return { episodes: { 0: { segments } } };
}

function apply(state: AnnotationDocument, change: AnnotationChange): AnnotationDocument {
  const result = applyChange(state, change, ctx);
  if (!result.ok) throw new Error(`refused: ${result.refusal.code}`);
  return result.doc;
}

function refusal(state: AnnotationDocument, change: AnnotationChange): AnnotationRefusalCode {
  const result = applyChange(state, change, ctx);
  if (result.ok) throw new Error('expected a refusal');
  expect(result.refusal.op).toBe(change.op);
  expect(result.refusal.episodeIndex).toBe(change.episodeIndex);
  return result.refusal.code;
}

/** Apply a change, then its inverse: the document must come back exactly. */
function roundTrip(state: AnnotationDocument, change: AnnotationChange): AnnotationDocument {
  const forward = applyChange(state, change, ctx);
  if (!forward.ok) throw new Error(`refused: ${forward.refusal.code}`);
  expect(forward.inverse).not.toBeNull();
  const back = applyChange(forward.doc, forward.inverse!, ctx);
  if (!back.ok) throw new Error(`inverse refused: ${back.refusal.code}`);
  expect(getEpisodeSegments(back.doc, change.episodeIndex)).toEqual(
    getEpisodeSegments(state, change.episodeIndex),
  );
  return forward.doc;
}

const subtask = (startFrame: number, endFrame: number, label: string) => ({
  startFrame,
  endFrame,
  label,
});

describe('segment reducer: every op and its inverse', () => {
  it('create ↔ delete; restore ↔ delete', () => {
    const created = roundTrip(EMPTY_ANNOTATION_DOCUMENT, {
      op: 'create',
      episodeIndex: 0,
      segment: seg('a', 10, 20, { subtasks: [subtask(10, 12, 'reach')] }),
    });
    expect(getEpisodeSegments(created, 0).map((item) => item.id)).toEqual(['a']);
    const inverse = applyChange(created, { op: 'delete', episodeIndex: 0, id: 'a' }, ctx);
    expect(inverse.ok && inverse.inverse).toEqual({
      op: 'restore',
      episodeIndex: 0,
      segment: seg('a', 10, 20, { subtasks: [subtask(10, 12, 'reach')] }),
    });
    roundTrip(created, { op: 'delete', episodeIndex: 0, id: 'a' });
    roundTrip(EMPTY_ANNOTATION_DOCUMENT, {
      op: 'restore',
      episodeIndex: 0,
      segment: seg('a', 0, 5),
    });
  });

  it('update ↔ update with the old values (values merge key by key)', () => {
    const start = doc(seg('a', 10, 20, { values: { outcome: 'success' }, task: 'pick' }));
    const result = applyChange(
      start,
      {
        op: 'update',
        episodeIndex: 0,
        id: 'a',
        patch: { startFrame: 12, task: 'place', values: { tags: ['wipe'] } },
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getEpisodeSegments(result.doc, 0)[0]).toMatchObject({
      startFrame: 12,
      task: 'place',
      values: { outcome: 'success', tags: ['wipe'] },
    });
    expect(result.inverse).toEqual({
      op: 'update',
      episodeIndex: 0,
      id: 'a',
      patch: { startFrame: 10, task: 'pick', values: { tags: null } },
    });
    roundTrip(start, { op: 'update', episodeIndex: 0, id: 'a', patch: { endFrame: 30 } });
  });

  it('editing never changes review; confirm sets confirmed and has no inverse', () => {
    const start = doc(
      seg('a', 0, 9, { review: 'to_review' }),
      seg('b', 10, 19, { review: 'to_review' }),
    );
    const edited = apply(start, { op: 'update', episodeIndex: 0, id: 'a', patch: { task: 'x' } });
    expect(getEpisodeSegments(edited, 0)[0].review).toBe('to_review');
    const confirmed = applyChange(edited, { op: 'confirm', episodeIndex: 0, ids: ['a'] }, ctx);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.inverse).toBeNull();
    expect(getEpisodeSegments(confirmed.doc, 0).map((item) => item.review)).toEqual([
      'confirmed',
      'to_review',
    ]);
  });

  it('split copies task, values, review and origin; cuts a crossing subtask; inverse merge restores', () => {
    const start = doc(
      seg('a', 10, 29, {
        task: 'fold',
        values: { outcome: 'success', tags: ['cloth'] },
        review: 'to_review',
        origin: { kind: 'suggested', confidence: 0.8 },
        subtasks: [subtask(10, 14, 'grasp'), subtask(15, 24, 'fold'), subtask(26, 29, 'release')],
        status: { severity: 'warn', label: 'Check', count: 1 },
      }),
    );
    const split = applyChange(
      start,
      { op: 'split', episodeIndex: 0, id: 'a', atFrame: 20, newId: 'b' },
      ctx,
    );
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    const [left, right] = getEpisodeSegments(split.doc, 0);
    expect(left).toMatchObject({
      id: 'a',
      startFrame: 10,
      endFrame: 19,
      task: 'fold',
      review: 'to_review',
    });
    expect(left.subtasks).toEqual([subtask(10, 14, 'grasp'), subtask(15, 19, 'fold')]);
    expect(right).toMatchObject({
      id: 'b',
      startFrame: 20,
      endFrame: 29,
      task: 'fold',
      values: { outcome: 'success', tags: ['cloth'] },
      review: 'to_review',
      origin: { kind: 'suggested', confidence: 0.8 },
    });
    expect(right.status).toBeUndefined();
    expect(right.subtasks).toEqual([subtask(20, 24, 'fold'), subtask(26, 29, 'release')]);
    expect(split.inverse).toEqual({ op: 'merge', episodeIndex: 0, id: 'a', withId: 'b' });
    // The cut subtask joins back: undo of split restores the document exactly.
    roundTrip(start, { op: 'split', episodeIndex: 0, id: 'a', atFrame: 20, newId: 'b' });
  });

  it('merge keeps the first task/values/origin, unions tags, concatenates subtasks; review only if both', () => {
    const start = doc(
      seg('a', 0, 9, {
        task: 'first',
        values: { outcome: 'success', tags: ['x', 'y'] },
        subtasks: [subtask(0, 4, 'reach')],
      }),
      seg('b', 15, 29, {
        task: 'second',
        values: { outcome: 'failure', tags: ['y', 'z'], note: 'n' },
        review: 'to_review',
        origin: { kind: 'suggested' },
        subtasks: [subtask(15, 20, 'place')],
      }),
    );
    const merged = applyChange(start, { op: 'merge', episodeIndex: 0, id: 'a', withId: 'b' }, ctx);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const [only] = getEpisodeSegments(merged.doc, 0);
    expect(only).toMatchObject({
      id: 'a',
      startFrame: 0,
      endFrame: 29,
      task: 'first',
      values: { outcome: 'success', tags: ['x', 'y', 'z'], note: 'n' },
      review: 'to_review',
      origin: { kind: 'manual' },
      subtasks: [subtask(0, 4, 'reach'), subtask(15, 20, 'place')],
    });
    expect(merged.inverse).toMatchObject({ op: 'unmerge', id: 'a', restored: { id: 'b' } });
    roundTrip(start, { op: 'merge', episodeIndex: 0, id: 'a', withId: 'b' });
    const bothConfirmed = doc(seg('a', 0, 9), seg('b', 10, 19));
    expect(
      getEpisodeSegments(
        apply(bothConfirmed, { op: 'merge', episodeIndex: 0, id: 'a', withId: 'b' }),
        0,
      )[0].review,
    ).toBe('confirmed');
  });

  it('unmerge ↔ merge', () => {
    const merged = doc(seg('a', 0, 19));
    roundTrip(merged, {
      op: 'unmerge',
      episodeIndex: 0,
      id: 'a',
      before: seg('a', 0, 9),
      restored: seg('b', 10, 19),
    });
  });

  it('does not mutate its input', () => {
    const start = doc(seg('a', 0, 9, { values: { tags: ['x'] } }));
    const snapshot = JSON.parse(JSON.stringify(start));
    apply(start, {
      op: 'update',
      episodeIndex: 0,
      id: 'a',
      patch: { values: { tags: ['x', 'y'] } },
    });
    apply(start, { op: 'split', episodeIndex: 0, id: 'a', atFrame: 5, newId: 'b' });
    apply(start, { op: 'delete', episodeIndex: 0, id: 'a' });
    expect(start).toEqual(snapshot);
  });

  it('keeps segments sorted', () => {
    const state = apply(doc(seg('b', 50, 60)), {
      op: 'create',
      episodeIndex: 0,
      segment: seg('a', 0, 10),
    });
    expect(state.episodes[0].segments.map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('segment reducer: typed refusals, never clamping', () => {
  const base = doc(seg('a', 10, 19), seg('b', 20, 29), seg('ro', 40, 49, { readOnly: true }));
  const cases: Array<[string, AnnotationDocument, AnnotationChange, AnnotationRefusalCode]> = [
    [
      'unknown episode',
      base,
      { op: 'create', episodeIndex: 7, segment: seg('n', 0, 1) },
      'EPISODE_UNKNOWN',
    ],
    ['missing segment', base, { op: 'delete', episodeIndex: 0, id: 'zz' }, 'SEGMENT_NOT_FOUND'],
    [
      'id taken (create)',
      base,
      { op: 'create', episodeIndex: 0, segment: seg('a', 60, 70) },
      'SEGMENT_ID_TAKEN',
    ],
    [
      'id taken in another episode',
      { episodes: { ...base.episodes, 1: { segments: [seg('q', 0, 1)] } } },
      { op: 'create', episodeIndex: 0, segment: seg('q', 60, 70) },
      'SEGMENT_ID_TAKEN',
    ],
    [
      'empty id',
      base,
      { op: 'create', episodeIndex: 0, segment: seg(' ', 60, 70) },
      'SEGMENT_ID_INVALID',
    ],
    [
      'reversed range',
      base,
      { op: 'create', episodeIndex: 0, segment: seg('n', 70, 60) },
      'RANGE_INVALID',
    ],
    [
      'fractional frame',
      base,
      { op: 'create', episodeIndex: 0, segment: seg('n', 60.5, 70) },
      'RANGE_INVALID',
    ],
    [
      'past the episode end',
      base,
      { op: 'create', episodeIndex: 0, segment: seg('n', 90, 100) },
      'RANGE_OUTSIDE_EPISODE',
    ],
    [
      'negative start',
      base,
      { op: 'update', episodeIndex: 0, id: 'a', patch: { startFrame: -1 } },
      'RANGE_OUTSIDE_EPISODE',
    ],
    [
      'overlap on create',
      base,
      { op: 'create', episodeIndex: 0, segment: seg('n', 25, 35) },
      'SEGMENT_OVERLAP',
    ],
    [
      'overlap on update',
      base,
      { op: 'update', episodeIndex: 0, id: 'a', patch: { endFrame: 20 } },
      'SEGMENT_OVERLAP',
    ],
    [
      'subtask without label',
      base,
      { op: 'update', episodeIndex: 0, id: 'a', patch: { subtasks: [subtask(10, 12, ' ')] } },
      'SUBTASK_INVALID',
    ],
    [
      'subtask outside',
      base,
      { op: 'update', episodeIndex: 0, id: 'a', patch: { subtasks: [subtask(5, 12, 'x')] } },
      'SUBTASK_OUTSIDE_SEGMENT',
    ],
    [
      'shrinking past a subtask',
      doc(seg('a', 10, 19, { subtasks: [subtask(10, 19, 'x')] })),
      { op: 'update', episodeIndex: 0, id: 'a', patch: { endFrame: 15 } },
      'SUBTASK_OUTSIDE_SEGMENT',
    ],
    [
      'subtasks overlap',
      base,
      {
        op: 'update',
        episodeIndex: 0,
        id: 'a',
        patch: { subtasks: [subtask(10, 14, 'x'), subtask(14, 16, 'y')] },
      },
      'SUBTASK_OVERLAP',
    ],
    [
      'unknown field',
      base,
      { op: 'update', episodeIndex: 0, id: 'a', patch: { values: { mood: 'x' } } },
      'FIELD_UNKNOWN',
    ],
    [
      'select value not an option',
      base,
      { op: 'update', episodeIndex: 0, id: 'a', patch: { values: { outcome: 'great' } } },
      'FIELD_INVALID',
    ],
    [
      'tags must be a list',
      base,
      { op: 'update', episodeIndex: 0, id: 'a', patch: { values: { tags: 'x' } } },
      'FIELD_INVALID',
    ],
    [
      'text must be text',
      base,
      { op: 'update', episodeIndex: 0, id: 'a', patch: { values: { note: ['x'] } } },
      'FIELD_INVALID',
    ],
    ['empty patch', base, { op: 'update', episodeIndex: 0, id: 'a', patch: {} }, 'PATCH_INVALID'],
    [
      'patching review',
      base,
      { op: 'update', episodeIndex: 0, id: 'a', patch: { review: 'confirmed' } as never },
      'PATCH_INVALID',
    ],
    [
      'split at the first frame',
      base,
      { op: 'split', episodeIndex: 0, id: 'a', atFrame: 10, newId: 'n' },
      'SPLIT_OUTSIDE_SEGMENT',
    ],
    [
      'split past the end',
      base,
      { op: 'split', episodeIndex: 0, id: 'a', atFrame: 20, newId: 'n' },
      'SPLIT_OUTSIDE_SEGMENT',
    ],
    [
      'split with a taken id',
      base,
      { op: 'split', episodeIndex: 0, id: 'a', atFrame: 15, newId: 'b' },
      'SEGMENT_ID_TAKEN',
    ],
    [
      'merge backwards',
      base,
      { op: 'merge', episodeIndex: 0, id: 'b', withId: 'a' },
      'MERGE_NOT_ADJACENT',
    ],
    [
      'merge across a segment',
      doc(seg('a', 0, 9), seg('b', 10, 19), seg('c', 20, 29)),
      { op: 'merge', episodeIndex: 0, id: 'a', withId: 'c' },
      'MERGE_NOT_ADJACENT',
    ],
    [
      'unmerge after a change',
      doc(seg('a', 0, 15)),
      {
        op: 'unmerge',
        episodeIndex: 0,
        id: 'a',
        before: seg('a', 0, 9),
        restored: seg('b', 10, 19),
      },
      'UNMERGE_MISMATCH',
    ],
    [
      'read-only update',
      base,
      { op: 'update', episodeIndex: 0, id: 'ro', patch: { task: 'x' } },
      'SEGMENT_READ_ONLY',
    ],
    ['read-only delete', base, { op: 'delete', episodeIndex: 0, id: 'ro' }, 'SEGMENT_READ_ONLY'],
    [
      'read-only split',
      base,
      { op: 'split', episodeIndex: 0, id: 'ro', atFrame: 45, newId: 'n' },
      'SEGMENT_READ_ONLY',
    ],
    [
      'read-only confirm',
      base,
      { op: 'confirm', episodeIndex: 0, ids: ['ro'] },
      'SEGMENT_READ_ONLY',
    ],
    ['confirm nothing', base, { op: 'confirm', episodeIndex: 0, ids: [] }, 'PATCH_INVALID'],
    [
      'confirm a missing id',
      base,
      { op: 'confirm', episodeIndex: 0, ids: ['a', 'zz'] },
      'SEGMENT_NOT_FOUND',
    ],
  ];
  it.each(cases)('%s', (_name, state, change, code) => {
    expect(refusal(state, change)).toBe(code);
  });

  it('accepts values without declared fields only when the context declares none', () => {
    const open: AnnotationContext = { episodeLength: () => 100 };
    const result = applyChange(
      doc(seg('a', 0, 9)),
      { op: 'update', episodeIndex: 0, id: 'a', patch: { values: { anything: 'x' } } },
      open,
    );
    expect(result.ok).toBe(true);
  });
});

describe('undo / redo history', () => {
  const ids = () => {
    let next = 0;
    return () => `fresh-${++next}`;
  };

  function run(state: AnnotationDocument, changes: AnnotationChange[]) {
    let current = state;
    const inverses: AnnotationChange[] = [];
    for (const change of changes) {
      const result = applyChange(current, change, ctx);
      if (!result.ok) throw new Error(result.refusal.code);
      current = result.doc;
      inverses.unshift(result.inverse!);
    }
    return { doc: current, entry: { forward: changes, inverse: inverses } };
  }

  it('undo emits the inverse; redo of a split mints a fresh id and later steps follow it', () => {
    const start = doc(seg('a', 0, 99));
    const split = run(start, [{ op: 'split', episodeIndex: 0, id: 'a', atFrame: 50, newId: 'b' }]);
    const edit = run(split.doc, [
      { op: 'update', episodeIndex: 0, id: 'b', patch: { task: 'right half' } },
    ]);
    let history = pushHistory(pushHistory(EMPTY_ANNOTATION_HISTORY, split.entry), edit.entry);
    let state = edit.doc;

    const undo1 = takeUndo(history)!;
    expect(undo1.changes).toEqual([
      { op: 'update', episodeIndex: 0, id: 'b', patch: { task: null } },
    ]);
    state = run(state, undo1.changes).doc;
    history = undo1.history;
    const undo2 = takeUndo(history)!;
    expect(undo2.changes).toEqual([{ op: 'merge', episodeIndex: 0, id: 'a', withId: 'b' }]);
    state = run(state, undo2.changes).doc;
    history = undo2.history;
    expect(getEpisodeSegments(state, 0)).toEqual(getEpisodeSegments(start, 0));

    const createId = ids();
    const redo1 = takeRedo(history, createId)!;
    expect(redo1.changes).toEqual([
      { op: 'split', episodeIndex: 0, id: 'a', atFrame: 50, newId: 'fresh-1' },
    ]);
    state = run(state, redo1.changes).doc;
    history = redo1.history;
    const redo2 = takeRedo(history, createId)!;
    expect(redo2.changes).toEqual([
      { op: 'update', episodeIndex: 0, id: 'fresh-1', patch: { task: 'right half' } },
    ]);
    state = run(state, redo2.changes).doc;
    history = redo2.history;
    expect(getEpisodeSegments(state, 0).map((item) => item.id)).toEqual(['a', 'fresh-1']);
    // Undo after redo targets the new id too.
    expect(takeUndo(history)!.changes).toEqual([
      { op: 'update', episodeIndex: 0, id: 'fresh-1', patch: { task: null } },
    ]);
    expect(takeUndo(takeUndo(history)!.history)!.changes).toEqual([
      { op: 'merge', episodeIndex: 0, id: 'a', withId: 'fresh-1' },
    ]);
  });

  it('redo of an undone create brings the segment back with restore', () => {
    const created = run(EMPTY_ANNOTATION_DOCUMENT, [
      { op: 'create', episodeIndex: 0, segment: seg('a', 0, 9) },
    ]);
    const history = pushHistory(EMPTY_ANNOTATION_HISTORY, created.entry);
    const undone = takeUndo(history)!;
    expect(undone.changes).toEqual([{ op: 'delete', episodeIndex: 0, id: 'a' }]);
    const redone = takeRedo(undone.history, ids())!;
    expect(redone.changes).toEqual([{ op: 'restore', episodeIndex: 0, segment: seg('a', 0, 9) }]);
  });

  it('a batch is one step whose inverse runs in reverse order', () => {
    const batch = run(doc(seg('old', 0, 9)), [
      { op: 'delete', episodeIndex: 0, id: 'old' },
      { op: 'create', episodeIndex: 0, segment: seg('new', 2, 8) },
    ]);
    const history = pushHistory(EMPTY_ANNOTATION_HISTORY, batch.entry);
    const undo = takeUndo(history)!;
    expect(undo.changes.map((change) => change.op)).toEqual(['delete', 'restore']);
    expect(getEpisodeSegments(run(batch.doc, undo.changes).doc, 0)).toEqual([seg('old', 0, 9)]);
  });

  it('a new step clears redo, and the stack keeps the last 100 steps', () => {
    let history = EMPTY_ANNOTATION_HISTORY;
    const entry = {
      forward: [{ op: 'delete', episodeIndex: 0, id: 'a' } as AnnotationChange],
      inverse: [{ op: 'restore', episodeIndex: 0, segment: seg('a', 0, 1) } as AnnotationChange],
    };
    for (let i = 0; i < ANNOTATION_HISTORY_LIMIT + 5; i++) history = pushHistory(history, entry);
    expect(history.undo).toHaveLength(ANNOTATION_HISTORY_LIMIT);
    history = takeUndo(history)!.history;
    expect(history.redo).toHaveLength(1);
    expect(pushHistory(history, entry).redo).toHaveLength(0);
    // Confirm has no inverse and is never recorded.
    expect(
      pushHistory(EMPTY_ANNOTATION_HISTORY, {
        forward: [{ op: 'confirm', episodeIndex: 0, ids: ['a'] }],
        inverse: [],
      }).undo,
    ).toHaveLength(0);
  });

  it('reconcile keeps history that still applies and clears a stack that conflicts', () => {
    const start = doc(seg('a', 0, 9));
    const edit = run(start, [{ op: 'update', episodeIndex: 0, id: 'a', patch: { task: 'x' } }]);
    const history = pushHistory(EMPTY_ANNOTATION_HISTORY, edit.entry);
    // The host answered with the expected document: keep.
    expect(reconcileHistory(history, edit.doc, ctx)).toBe(history);
    // The host reloaded a document where the segment is gone: the undo stack cannot apply.
    expect(reconcileHistory(history, EMPTY_ANNOTATION_DOCUMENT, ctx).undo).toHaveLength(0);
    // Redo that no longer applies is cleared, undo that does is kept.
    const undone = takeUndo(history)!;
    const reloaded = doc(seg('a', 0, 9), seg('b', 50, 60));
    expect(reconcileHistory(undone.history, reloaded, ctx).redo).toHaveLength(1);
    const conflicting = doc(seg('z', 0, 9));
    expect(reconcileHistory(undone.history, conflicting, ctx).redo).toHaveLength(0);
  });
});
