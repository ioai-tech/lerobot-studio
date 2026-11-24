import type {
  AnnotationChange,
  AnnotationContext,
  AnnotationDocument,
  AnnotationRefusal,
  AnnotationRefusalCode,
  ApplyChangeResult,
  Segment,
  SegmentFieldValue,
  SegmentPatch,
  SegmentSubtask,
} from './types';
import { hasSubtaskLabel } from './hints';

/** An empty document: every episode is whole and unannotated. */
export const EMPTY_ANNOTATION_DOCUMENT: AnnotationDocument = Object.freeze({
  episodes: Object.freeze({}) as AnnotationDocument['episodes'],
});

const PATCH_KEYS = new Set(['startFrame', 'endFrame', 'task', 'subtasks', 'values']);

class Refused extends Error {
  readonly refusal: Omit<AnnotationRefusal, 'op' | 'episodeIndex'>;
  constructor(refusal: Omit<AnnotationRefusal, 'op' | 'episodeIndex'>) {
    super(refusal.message);
    this.refusal = refusal;
  }
}

function refuse(
  code: AnnotationRefusalCode,
  message: string,
  extra: Partial<Pick<AnnotationRefusal, 'segmentId' | 'otherId' | 'fieldId'>> = {},
): never {
  throw new Refused({ code, message, ...extra });
}

/** Segments of one episode, sorted by start (the stored order is not trusted). */
export function getEpisodeSegments(doc: AnnotationDocument, episodeIndex: number): Segment[] {
  const segments = doc.episodes[episodeIndex]?.segments ?? [];
  return sortSegments(segments);
}

export function sortSegments(segments: readonly Segment[]): Segment[] {
  return [...segments].sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
}

/** Find a segment by id anywhere in the document. */
export function findSegment(
  doc: AnnotationDocument,
  id: string,
): { episodeIndex: number; segment: Segment } | null {
  for (const [key, entry] of Object.entries(doc.episodes)) {
    const segment = entry?.segments.find((item) => item.id === id);
    if (segment) return { episodeIndex: Number(key), segment };
  }
  return null;
}

function cloneSegment(segment: Segment): Segment {
  return {
    ...segment,
    subtasks: segment.subtasks.map((subtask) => ({ ...subtask })),
    values: Object.fromEntries(
      Object.entries(segment.values).map(([key, value]) => [
        key,
        Array.isArray(value) ? [...value] : value,
      ]),
    ),
    origin: { ...segment.origin },
    ...(segment.status ? { status: { ...segment.status } } : {}),
  };
}

function checkRange(
  startFrame: unknown,
  endFrame: unknown,
  length: number,
  segmentId?: string,
): void {
  if (
    !Number.isSafeInteger(startFrame) ||
    !Number.isSafeInteger(endFrame) ||
    (startFrame as number) > (endFrame as number)
  ) {
    refuse(
      'RANGE_INVALID',
      `Range ${String(startFrame)}–${String(endFrame)} must be integer frames with start ≤ end`,
      { segmentId },
    );
  }
  if ((startFrame as number) < 0 || (endFrame as number) >= length) {
    refuse(
      'RANGE_OUTSIDE_EPISODE',
      `Range ${String(startFrame)}–${String(endFrame)} is outside the episode (0–${length - 1})`,
      { segmentId },
    );
  }
}

function checkSubtasks(segment: Segment): void {
  if (!Array.isArray(segment.subtasks)) {
    refuse('SUBTASK_INVALID', 'Subtasks must be a list', { segmentId: segment.id });
  }
  const sorted = [...segment.subtasks].sort((a, b) => a.startFrame - b.startFrame);
  let previous: SegmentSubtask | null = null;
  for (const subtask of sorted) {
    if (
      !subtask ||
      typeof subtask.label !== 'string' ||
      !hasSubtaskLabel(subtask) ||
      !Number.isSafeInteger(subtask.startFrame) ||
      !Number.isSafeInteger(subtask.endFrame) ||
      subtask.startFrame > subtask.endFrame
    ) {
      refuse('SUBTASK_INVALID', 'A subtask needs a label and integer frames with start ≤ end', {
        segmentId: segment.id,
      });
    }
    if (subtask.startFrame < segment.startFrame || subtask.endFrame > segment.endFrame) {
      refuse(
        'SUBTASK_OUTSIDE_SEGMENT',
        `Subtask "${subtask.label}" ${subtask.startFrame}–${subtask.endFrame} is outside its segment ${segment.startFrame}–${segment.endFrame}`,
        { segmentId: segment.id },
      );
    }
    if (previous && subtask.startFrame <= previous.endFrame) {
      refuse('SUBTASK_OVERLAP', `Subtask "${subtask.label}" overlaps "${previous.label}"`, {
        segmentId: segment.id,
      });
    }
    previous = subtask;
  }
}

function checkValue(
  ctx: AnnotationContext,
  segmentId: string,
  fieldId: string,
  value: SegmentFieldValue | undefined,
): void {
  const valid =
    value === null ||
    typeof value === 'string' ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== ''));
  if (!valid) {
    refuse('FIELD_INVALID', `Field "${fieldId}" has an invalid value`, { segmentId, fieldId });
  }
  if (!ctx.fields) return;
  const field = ctx.fields.find((item) => item.id === fieldId);
  if (!field) {
    refuse('FIELD_UNKNOWN', `Field "${fieldId}" is not declared`, { segmentId, fieldId });
  }
  if (value === null) return;
  const kindMatches = field.kind === 'tags' ? Array.isArray(value) : typeof value === 'string';
  if (!kindMatches) {
    refuse('FIELD_INVALID', `Field "${fieldId}" (${field.kind}) has a value of the wrong kind`, {
      segmentId,
      fieldId,
    });
  }
  if (
    field.kind === 'select' &&
    field.options &&
    !field.options.some((option) => option.value === value)
  ) {
    refuse('FIELD_INVALID', `"${String(value)}" is not an option of field "${fieldId}"`, {
      segmentId,
      fieldId,
    });
  }
}

function checkSegmentShape(segment: Segment, length: number, ctx: AnnotationContext): void {
  if (!segment || typeof segment.id !== 'string' || segment.id.trim() === '') {
    refuse('SEGMENT_ID_INVALID', 'A segment needs a non-empty id');
  }
  checkRange(segment.startFrame, segment.endFrame, length, segment.id);
  if (segment.task !== null && typeof segment.task !== 'string') {
    refuse('PATCH_INVALID', 'Task must be text or null', { segmentId: segment.id });
  }
  checkSubtasks(segment);
  if (!segment.values || typeof segment.values !== 'object' || Array.isArray(segment.values)) {
    refuse('FIELD_INVALID', 'Values must be an object', { segmentId: segment.id });
  }
  for (const [fieldId, value] of Object.entries(segment.values)) {
    checkValue(ctx, segment.id, fieldId, value);
  }
}

function checkNoOverlap(segments: readonly Segment[], candidate: Segment): void {
  for (const other of segments) {
    if (other.id === candidate.id) continue;
    if (candidate.startFrame <= other.endFrame && other.startFrame <= candidate.endFrame) {
      refuse(
        'SEGMENT_OVERLAP',
        `Segment ${candidate.startFrame}–${candidate.endFrame} overlaps ${other.startFrame}–${other.endFrame}`,
        { segmentId: candidate.id, otherId: other.id },
      );
    }
  }
}

function requireSegment(segments: readonly Segment[], id: string): Segment {
  const segment = segments.find((item) => item.id === id);
  if (!segment) refuse('SEGMENT_NOT_FOUND', `Segment "${id}" does not exist`, { segmentId: id });
  return segment;
}

function requireEditable(segment: Segment): void {
  if (segment.readOnly) {
    refuse('SEGMENT_READ_ONLY', `Segment "${segment.id}" is read-only`, { segmentId: segment.id });
  }
}

function requireFreeId(doc: AnnotationDocument, id: unknown): void {
  if (typeof id !== 'string' || id.trim() === '') {
    refuse('SEGMENT_ID_INVALID', 'A segment needs a non-empty id');
  }
  if (findSegment(doc, id))
    refuse('SEGMENT_ID_TAKEN', `Segment id "${id}" is taken`, { segmentId: id });
}

function withEpisode(
  doc: AnnotationDocument,
  episodeIndex: number,
  segments: Segment[],
): AnnotationDocument {
  return {
    ...doc,
    episodes: { ...doc.episodes, [episodeIndex]: { segments: sortSegments(segments) } },
  };
}

function sameValue(a: SegmentFieldValue | undefined, b: SegmentFieldValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }
  return (a ?? null) === (b ?? null);
}

/** Split subtasks at `atFrame`: a subtask crossing the cut becomes two. */
export function partitionSubtasks(
  subtasks: readonly SegmentSubtask[],
  atFrame: number,
): { left: SegmentSubtask[]; right: SegmentSubtask[] } {
  const left: SegmentSubtask[] = [];
  const right: SegmentSubtask[] = [];
  for (const subtask of subtasks) {
    if (subtask.endFrame < atFrame) left.push({ ...subtask });
    else if (subtask.startFrame >= atFrame) right.push({ ...subtask });
    else {
      left.push({ ...subtask, endFrame: atFrame - 1 });
      right.push({ ...subtask, startFrame: atFrame });
    }
  }
  return { left, right };
}

/**
 * Concatenate the subtasks of two neighbouring segments. A subtask that a
 * split cut in two (same label, flush across the junction) joins back.
 */
export function concatSubtasks(
  first: readonly SegmentSubtask[],
  second: readonly SegmentSubtask[],
): SegmentSubtask[] {
  const left = [...first]
    .sort((a, b) => a.startFrame - b.startFrame)
    .map((subtask) => ({ ...subtask }));
  const right = [...second]
    .sort((a, b) => a.startFrame - b.startFrame)
    .map((subtask) => ({ ...subtask }));
  const last = left[left.length - 1];
  const next = right[0];
  if (last && next && last.label === next.label && last.endFrame + 1 === next.startFrame) {
    last.endFrame = next.endFrame;
    right.shift();
  }
  return [...left, ...right];
}

/** Merge values: the first segment's values win, list values (tags) are unioned. */
export function mergeValues(
  first: Segment['values'],
  second: Segment['values'],
): Segment['values'] {
  const result: Segment['values'] = {};
  for (const key of new Set([...Object.keys(first), ...Object.keys(second)])) {
    const a = first[key];
    const b = second[key];
    if (Array.isArray(a) || Array.isArray(b)) {
      const union = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
      result[key] = Array.from(new Set(union));
    } else {
      result[key] = key in first ? (a ?? null) : (b ?? null);
    }
  }
  return result;
}

function applyUnchecked(
  doc: AnnotationDocument,
  change: AnnotationChange,
  ctx: AnnotationContext,
): { doc: AnnotationDocument; inverse: AnnotationChange | null } {
  const { episodeIndex } = change;
  const length = ctx.episodeLength(episodeIndex);
  if (length === undefined || !Number.isSafeInteger(length) || length <= 0) {
    refuse('EPISODE_UNKNOWN', `Episode ${episodeIndex} is not part of this dataset`);
  }
  const segments = getEpisodeSegments(doc, episodeIndex);

  switch (change.op) {
    case 'create':
    case 'restore': {
      const segment = cloneSegment(change.segment);
      requireFreeId(doc, segment?.id);
      checkSegmentShape(segment, length, ctx);
      checkNoOverlap(segments, segment);
      return {
        doc: withEpisode(doc, episodeIndex, [...segments, segment]),
        inverse: { op: 'delete', episodeIndex, id: segment.id },
      };
    }
    case 'delete': {
      const segment = requireSegment(segments, change.id);
      requireEditable(segment);
      return {
        doc: withEpisode(
          doc,
          episodeIndex,
          segments.filter((item) => item.id !== change.id),
        ),
        inverse: { op: 'restore', episodeIndex, segment: cloneSegment(segment) },
      };
    }
    case 'update': {
      const segment = requireSegment(segments, change.id);
      requireEditable(segment);
      const patch = change.patch;
      if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
        refuse('PATCH_INVALID', 'An update needs a non-empty patch', { segmentId: segment.id });
      }
      for (const key of Object.keys(patch)) {
        if (!PATCH_KEYS.has(key)) {
          refuse('PATCH_INVALID', `"${key}" cannot be updated`, { segmentId: segment.id });
        }
      }
      const next = cloneSegment(segment);
      const old: SegmentPatch = {};
      if (patch.startFrame !== undefined) {
        old.startFrame = segment.startFrame;
        next.startFrame = patch.startFrame;
      }
      if (patch.endFrame !== undefined) {
        old.endFrame = segment.endFrame;
        next.endFrame = patch.endFrame;
      }
      if (patch.task !== undefined) {
        old.task = segment.task;
        next.task = patch.task;
      }
      if (patch.subtasks !== undefined) {
        old.subtasks = segment.subtasks.map((subtask) => ({ ...subtask }));
        next.subtasks = Array.isArray(patch.subtasks)
          ? patch.subtasks.map((subtask) => ({ ...subtask }))
          : (patch.subtasks as never);
      }
      if (patch.values !== undefined) {
        if (!patch.values || typeof patch.values !== 'object' || Array.isArray(patch.values)) {
          refuse('FIELD_INVALID', 'Values must be an object', { segmentId: segment.id });
        }
        const oldValues: Segment['values'] = {};
        for (const [fieldId, value] of Object.entries(patch.values)) {
          oldValues[fieldId] = segment.values[fieldId] ?? null;
          next.values[fieldId] = Array.isArray(value) ? [...value] : value;
        }
        old.values = oldValues;
      }
      checkSegmentShape(next, length, ctx);
      checkNoOverlap(segments, next);
      return {
        doc: withEpisode(
          doc,
          episodeIndex,
          segments.map((item) => (item.id === segment.id ? next : item)),
        ),
        inverse: { op: 'update', episodeIndex, id: segment.id, patch: old },
      };
    }
    case 'split': {
      const segment = requireSegment(segments, change.id);
      requireEditable(segment);
      requireFreeId(doc, change.newId);
      if (
        !Number.isSafeInteger(change.atFrame) ||
        change.atFrame <= segment.startFrame ||
        change.atFrame > segment.endFrame
      ) {
        refuse(
          'SPLIT_OUTSIDE_SEGMENT',
          `Frame ${String(change.atFrame)} cannot split ${segment.startFrame}–${segment.endFrame}`,
          { segmentId: segment.id },
        );
      }
      const { left: leftSubtasks, right: rightSubtasks } = partitionSubtasks(
        segment.subtasks,
        change.atFrame,
      );
      const left: Segment = {
        ...cloneSegment(segment),
        endFrame: change.atFrame - 1,
        subtasks: leftSubtasks,
      };
      const { status: _status, ...rest } = cloneSegment(segment);
      void _status;
      const right: Segment = {
        ...rest,
        id: change.newId,
        startFrame: change.atFrame,
        subtasks: rightSubtasks,
      };
      return {
        doc: withEpisode(doc, episodeIndex, [
          ...segments.filter((item) => item.id !== segment.id),
          left,
          right,
        ]),
        inverse: { op: 'merge', episodeIndex, id: segment.id, withId: change.newId },
      };
    }
    case 'merge': {
      const first = requireSegment(segments, change.id);
      const second = requireSegment(segments, change.withId);
      requireEditable(first);
      requireEditable(second);
      const position = segments.findIndex((item) => item.id === first.id);
      if (segments[position + 1]?.id !== second.id) {
        refuse('MERGE_NOT_ADJACENT', `Segment "${second.id}" is not the one after "${first.id}"`, {
          segmentId: first.id,
          otherId: second.id,
        });
      }
      const merged: Segment = {
        ...cloneSegment(first),
        endFrame: second.endFrame,
        subtasks: concatSubtasks(first.subtasks, second.subtasks),
        values: mergeValues(first.values, second.values),
        review:
          first.review === 'confirmed' && second.review === 'confirmed' ? 'confirmed' : 'to_review',
      };
      return {
        doc: withEpisode(doc, episodeIndex, [
          ...segments.filter((item) => item.id !== first.id && item.id !== second.id),
          merged,
        ]),
        inverse: {
          op: 'unmerge',
          episodeIndex,
          id: first.id,
          restored: cloneSegment(second),
          before: cloneSegment(first),
        },
      };
    }
    case 'unmerge': {
      const current = requireSegment(segments, change.id);
      requireEditable(current);
      const before = cloneSegment(change.before);
      const restored = cloneSegment(change.restored);
      if (before?.id !== current.id) {
        refuse('UNMERGE_MISMATCH', '`before` must describe the merged segment', {
          segmentId: current.id,
        });
      }
      requireFreeId(doc, restored?.id);
      if (
        current.startFrame !== before.startFrame ||
        current.endFrame !== restored.endFrame ||
        before.endFrame >= restored.startFrame
      ) {
        refuse(
          'UNMERGE_MISMATCH',
          `Segment "${current.id}" no longer spans ${before.startFrame}–${restored.endFrame}`,
          { segmentId: current.id, otherId: restored.id },
        );
      }
      checkSegmentShape(before, length, ctx);
      checkSegmentShape(restored, length, ctx);
      const others = segments.filter((item) => item.id !== current.id);
      checkNoOverlap(others, before);
      checkNoOverlap(others, restored);
      return {
        doc: withEpisode(doc, episodeIndex, [...others, before, restored]),
        inverse: { op: 'merge', episodeIndex, id: current.id, withId: restored.id },
      };
    }
    case 'confirm': {
      if (!Array.isArray(change.ids) || change.ids.length === 0) {
        refuse('PATCH_INVALID', 'Confirm needs at least one segment id');
      }
      const ids = new Set(change.ids);
      for (const id of ids) requireEditable(requireSegment(segments, id));
      return {
        doc: withEpisode(
          doc,
          episodeIndex,
          segments.map((item) =>
            ids.has(item.id) && item.review !== 'confirmed'
              ? { ...cloneSegment(item), review: 'confirmed' }
              : item,
          ),
        ),
        inverse: null,
      };
    }
    default: {
      const unknown = change as { op?: unknown };
      refuse('PATCH_INVALID', `Unknown change "${String(unknown.op)}"`);
    }
  }
}

/**
 * Apply one change. Pure: the input document is never mutated. Every invalid
 * change returns a typed refusal; nothing is clamped or dropped silently.
 * In a host-controlled viewer this is only a preview: the host's answer
 * (its next `value`) replaces the result.
 */
export function applyChange(
  doc: AnnotationDocument,
  change: AnnotationChange,
  ctx: AnnotationContext,
): ApplyChangeResult {
  try {
    const { doc: next, inverse } = applyUnchecked(doc, change, ctx);
    return { ok: true, doc: next, inverse };
  } catch (error) {
    if (error instanceof Refused) {
      return {
        ok: false,
        refusal: { ...error.refusal, op: change?.op, episodeIndex: change?.episodeIndex },
      };
    }
    throw error;
  }
}

/** True when a segment patch would change nothing. */
export function isNoopPatch(segment: Segment, patch: SegmentPatch): boolean {
  if (patch.startFrame !== undefined && patch.startFrame !== segment.startFrame) return false;
  if (patch.endFrame !== undefined && patch.endFrame !== segment.endFrame) return false;
  if (patch.task !== undefined && patch.task !== segment.task) return false;
  if (patch.subtasks !== undefined) {
    const a = patch.subtasks;
    const b = segment.subtasks;
    if (
      a.length !== b.length ||
      a.some(
        (item, index) =>
          item.label !== b[index].label ||
          item.startFrame !== b[index].startFrame ||
          item.endFrame !== b[index].endFrame,
      )
    ) {
      return false;
    }
  }
  if (patch.values !== undefined) {
    for (const [key, value] of Object.entries(patch.values)) {
      if (!sameValue(value, segment.values[key])) return false;
    }
  }
  return true;
}
