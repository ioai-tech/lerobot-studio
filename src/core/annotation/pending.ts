import { applyChange, findSegment, isNoopPatch } from './reducer';
import type {
  AnnotationChange,
  AnnotationContext,
  AnnotationDocument,
  SegmentPatch,
} from './types';

/** One change sent to a host, not yet reflected in its `value`. */
export interface PendingChange<Tag = unknown> {
  change: AnnotationChange;
  /** The viewer's id for this change, passed to the host with it. */
  changeId: string;
  /** Caller data kept with the change (e.g. its history step). */
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
 * segment), is dropped.
 */
export function rebasePending<Tag>(
  value: AnnotationDocument,
  pending: readonly PendingChange<Tag>[],
  ctx: AnnotationContext,
): { doc: AnnotationDocument; pending: PendingChange<Tag>[]; dropped: boolean } {
  let doc = value;
  const kept: PendingChange<Tag>[] = [];
  for (const item of pending) {
    if (alreadyApplied(doc, item.change)) continue;
    const result = applyChange(doc, item.change, ctx);
    if (!result.ok) continue;
    doc = result.doc;
    kept.push(item);
  }
  return { doc, pending: kept, dropped: kept.length !== pending.length };
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
