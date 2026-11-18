import { applyChange, findSegment, isNoopPatch } from './reducer';
import type {
  AnnotationChange,
  AnnotationContext,
  AnnotationDocument,
  SegmentPatch,
} from './types';

/** Changes sent to a host in one step, not yet reflected in its `value`. */
export interface PendingBatch<Tag = unknown> {
  changes: AnnotationChange[];
  /** Caller data kept with the batch (e.g. its history step). */
  tag: Tag;
}

/** Whether `change` is already reflected in `doc` (the host applied it). */
function alreadyApplied(doc: AnnotationDocument, change: AnnotationChange): boolean {
  if (change.op === 'update') {
    const found = findSegment(doc, change.id);
    return found !== null && isNoopPatch(found.segment, change.patch);
  }
  if (change.op === 'confirm') {
    return change.ids.every((id) => findSegment(doc, id)?.segment.review === 'confirmed');
  }
  return false;
}

/**
 * Replay changes still in flight on top of the host's latest `value`. A change
 * the host already applied, or one that no longer applies (refused or made
 * moot, e.g. a `create` whose id now exists or a `delete` of a missing
 * segment), is dropped; a batch with no change left is dropped.
 */
export function rebasePending<Tag>(
  value: AnnotationDocument,
  pending: readonly PendingBatch<Tag>[],
  ctx: AnnotationContext,
): { doc: AnnotationDocument; pending: PendingBatch<Tag>[]; dropped: boolean } {
  let doc = value;
  let dropped = false;
  const kept: PendingBatch<Tag>[] = [];
  for (const batch of pending) {
    const changes: AnnotationChange[] = [];
    for (const change of batch.changes) {
      if (alreadyApplied(doc, change)) {
        dropped = true;
        continue;
      }
      const result = applyChange(doc, change, ctx);
      if (!result.ok) {
        dropped = true;
        continue;
      }
      doc = result.doc;
      changes.push(change);
    }
    if (changes.length === batch.changes.length) kept.push(batch);
    else if (changes.length > 0) kept.push({ ...batch, changes });
  }
  return { doc, pending: kept, dropped };
}

function mergePatch(older: SegmentPatch, newer: SegmentPatch): SegmentPatch {
  const merged: SegmentPatch = { ...older, ...newer };
  if (older.values || newer.values) merged.values = { ...older.values, ...newer.values };
  return merged;
}

/**
 * Fold two consecutive single `update` steps of one segment into one step:
 * forward = older patch overlaid by newer; inverse = newer inverse overlaid by
 * the older inverse (the values before both). `null` when they cannot fold.
 */
export function composeUpdateSteps(
  older: { forward: AnnotationChange[]; inverse: AnnotationChange[] },
  newer: { forward: AnnotationChange[]; inverse: AnnotationChange[] },
): { forward: AnnotationChange[]; inverse: AnnotationChange[] } | null {
  const [of, oi] = [older.forward, older.inverse];
  const [nf, ni] = [newer.forward, newer.inverse];
  if (of.length !== 1 || oi.length !== 1 || nf.length !== 1 || ni.length !== 1) return null;
  const [a, ai, b, bi] = [of[0], oi[0], nf[0], ni[0]];
  if (a.op !== 'update' || ai.op !== 'update' || b.op !== 'update' || bi.op !== 'update') {
    return null;
  }
  if (a.id !== b.id || a.episodeIndex !== b.episodeIndex) return null;
  return {
    forward: [{ ...b, patch: mergePatch(a.patch, b.patch) }],
    inverse: [{ ...ai, patch: mergePatch(bi.patch, ai.patch) }],
  };
}
