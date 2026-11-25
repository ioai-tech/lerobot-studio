import { segmentIssueMarkers, type TimelineMarker } from './markers';
import { getEpisodeSegments } from './reducer';
import type {
  AnnotationDocument,
  AnnotationField,
  ReviewState,
  Segment,
  SegmentReviewDisplay,
  SegmentSubtask,
} from './types';

/** A segment with the dataset episode it belongs to (dataset order lists). */
export interface OrderedSegment {
  episodeIndex: number;
  segment: Segment;
}

/** The segment that contains `frame`, if any. */
export function segmentAtFrame(segments: readonly Segment[], frame: number): Segment | null {
  return segments.find((item) => frame >= item.startFrame && frame <= item.endFrame) ?? null;
}

/**
 * Range for a new segment starting at `frame`: up to the next segment's start
 * (or the episode end). `null` when `frame` is inside a segment.
 */
export function newSegmentRangeAt(
  segments: readonly Segment[],
  frame: number,
  episodeLength: number,
): { startFrame: number; endFrame: number } | null {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= episodeLength) return null;
  if (segmentAtFrame(segments, frame)) return null;
  const next = [...segments]
    .sort((a, b) => a.startFrame - b.startFrame)
    .find((item) => item.startFrame > frame);
  return { startFrame: frame, endFrame: next ? next.startFrame - 1 : episodeLength - 1 };
}

/** Ranges of an episode not covered by any segment, in order. */
export function uncoveredRanges(
  segments: readonly Segment[],
  episodeLength: number,
): Array<{ startFrame: number; endFrame: number }> {
  const gaps: Array<{ startFrame: number; endFrame: number }> = [];
  let cursor = 0;
  for (const segment of [...segments].sort((a, b) => a.startFrame - b.startFrame)) {
    if (segment.startFrame > cursor)
      gaps.push({ startFrame: cursor, endFrame: segment.startFrame - 1 });
    cursor = Math.max(cursor, segment.endFrame + 1);
  }
  if (cursor < episodeLength) gaps.push({ startFrame: cursor, endFrame: episodeLength - 1 });
  return gaps;
}

/**
 * Start of the next uncovered range after `frame` (wrapping to the first),
 * or `null` when every frame is covered.
 */
export function nextUncoveredFrame(
  segments: readonly Segment[],
  frame: number,
  episodeLength: number,
): number | null {
  const gaps = uncoveredRanges(segments, episodeLength);
  if (gaps.length === 0) return null;
  const after = gaps.find((gap) => gap.startFrame > frame);
  return (after ?? gaps[0]).startFrame;
}

/**
 * Segments with a warning or failure: a `warn` / `fail` badge, or an overlap
 * with a `warn` / `fail` marker of the same episode (`episodeMarkers`).
 */
export function hasSegmentIssue(
  segment: Segment,
  episodeMarkers: readonly TimelineMarker[] = [],
): boolean {
  if (segment.status?.severity === 'warn' || segment.status?.severity === 'fail') return true;
  return segmentIssueMarkers(segment, episodeMarkers).length > 0;
}

/**
 * The one rule for how a segment is shown and counted: an excluded segment is
 * `excluded` whatever its review state (never drawn or counted as confirmed or
 * to review); any other segment shows its review state.
 */
export function segmentReviewDisplay(segment: Segment): SegmentReviewDisplay {
  return segment.excluded ? 'excluded' : segment.review;
}

export type SegmentFilter = 'all' | 'to_review' | 'issues';

export function matchesSegmentFilter(
  segment: Segment,
  filter: SegmentFilter,
  episodeMarkers: readonly TimelineMarker[] = [],
): boolean {
  if (filter === 'to_review') return segmentReviewDisplay(segment) === 'to_review';
  if (filter === 'issues') return hasSegmentIssue(segment, episodeMarkers);
  return true;
}

/** How many segments each filter shows. */
export function segmentFilterCounts(
  segments: readonly Segment[],
  episodeMarkers: readonly TimelineMarker[] = [],
): Record<SegmentFilter, number> {
  const counts: Record<SegmentFilter, number> = { all: segments.length, to_review: 0, issues: 0 };
  for (const segment of segments) {
    if (matchesSegmentFilter(segment, 'to_review', episodeMarkers)) counts.to_review += 1;
    if (matchesSegmentFilter(segment, 'issues', episodeMarkers)) counts.issues += 1;
  }
  return counts;
}

/**
 * The filters worth offering: Issues only when it narrows the list
 * (`0 < issues < all`). When every segment has an issue (one recording-level
 * warning reaches them all) or none does, it would show All or nothing.
 */
export function offeredSegmentFilters(counts: Record<SegmentFilter, number>): SegmentFilter[] {
  return counts.issues > 0 && counts.issues < counts.all
    ? ['all', 'to_review', 'issues']
    : ['all', 'to_review'];
}

/** The filter in effect: one that is not offered shows All. */
export function effectiveSegmentFilter(
  filter: SegmentFilter,
  offered: readonly SegmentFilter[],
): SegmentFilter {
  return offered.includes(filter) ? filter : 'all';
}

/**
 * "N / M confirmed" over the segments of the document that are not excluded;
 * excluded segments are their own count, never confirmed.
 */
export function reviewProgress(doc: AnnotationDocument): {
  confirmed: number;
  total: number;
  excluded: number;
} {
  let confirmed = 0;
  let total = 0;
  let excluded = 0;
  for (const entry of Object.values(doc.episodes)) {
    for (const segment of entry?.segments ?? []) {
      const display = segmentReviewDisplay(segment);
      if (display === 'excluded') {
        excluded += 1;
        continue;
      }
      total += 1;
      if (display === 'confirmed') confirmed += 1;
    }
  }
  return { confirmed, total, excluded };
}

/** The edge of a segment nearer to `frame` (ties go to the end). */
export function nearerEdge(segment: Segment, frame: number): 'start' | 'end' {
  return Math.abs(frame - segment.startFrame) < Math.abs(frame - segment.endFrame)
    ? 'start'
    : 'end';
}

/** Keep the parts of subtasks that lie inside `range` (used when a person resizes a segment). */
export function clipSubtasksToRange(
  subtasks: readonly SegmentSubtask[],
  range: { startFrame: number; endFrame: number },
): SegmentSubtask[] {
  return subtasks.flatMap((subtask) => {
    const startFrame = Math.max(subtask.startFrame, range.startFrame);
    const endFrame = Math.min(subtask.endFrame, range.endFrame);
    return startFrame <= endFrame ? [{ ...subtask, startFrame, endFrame }] : [];
  });
}

/** A segment a person makes. */
export function createManualSegment(input: {
  id: string;
  startFrame: number;
  endFrame: number;
  review: ReviewState;
  task?: string | null;
  subtasks?: SegmentSubtask[];
  values?: Segment['values'];
}): Segment {
  return {
    id: input.id,
    startFrame: input.startFrame,
    endFrame: input.endFrame,
    task: input.task ?? null,
    subtasks: input.subtasks ?? [],
    values: input.values ?? {},
    review: input.review,
    origin: { kind: 'manual' },
  };
}

/** Option of a `select` field bound to a shortcut key. */
export function fieldOptionForKey(
  fields: readonly AnnotationField[] | undefined,
  key: string,
): { field: AnnotationField; value: string } | null {
  for (const field of fields ?? []) {
    if (field.kind !== 'select') continue;
    const option = field.options?.find((item) => item.key === key);
    if (option) return { field, value: option.value };
  }
  return null;
}

/** Number of the segment (1-based) in its episode, by start frame. */
export function segmentNumber(doc: AnnotationDocument, episodeIndex: number, id: string): number {
  return getEpisodeSegments(doc, episodeIndex).findIndex((item) => item.id === id) + 1;
}

/**
 * The segment a new range continues: the nearest one that ends before it,
 * else the nearest one that starts after it; `null` in an empty episode.
 */
export function neighbourOfRange(
  segments: readonly Segment[],
  range: { startFrame: number; endFrame: number },
): Segment | null {
  let before: Segment | null = null;
  let after: Segment | null = null;
  for (const segment of segments) {
    if (segment.endFrame < range.startFrame) {
      if (!before || segment.endFrame > before.endFrame) before = segment;
    } else if (segment.startFrame > range.endFrame) {
      if (!after || segment.startFrame < after.startFrame) after = segment;
    }
  }
  return before ?? after;
}

/** The values of the fields marked `inherit` that `from` holds (a new segment's start). */
export function inheritedValues(
  from: Segment | null,
  fields: readonly AnnotationField[] | undefined,
): Segment['values'] {
  const values: Segment['values'] = {};
  if (!from) return values;
  for (const field of fields ?? []) {
    if (!field.inherit) continue;
    const value = from.values[field.id];
    if (value == null || (Array.isArray(value) && value.length === 0)) continue;
    values[field.id] = Array.isArray(value) ? [...value] : value;
  }
  return values;
}

/**
 * The item `delta` steps from `order[from]` among those `shows` accepts
 * (`order[from]` itself may be hidden); `null` past either end.
 */
export function stepSegment<T extends OrderedSegment>(
  order: readonly T[],
  from: number,
  delta: 1 | -1,
  shows: (item: T) => boolean,
): T | null {
  for (let at = from + delta; at >= 0 && at < order.length; at += delta) {
    if (shows(order[at]!)) return order[at]!;
  }
  return null;
}

/**
 * The segment review goes on with after `order[from]`: the next one that is to
 * review, editable and shown (`shows`), after it in order, else the first such
 * one before it; `null` when none is left.
 */
export function nextSegmentToReview<T extends OrderedSegment>(
  order: readonly T[],
  from: number,
  shows: (item: T) => boolean,
): T | null {
  const open = (item: T) =>
    segmentReviewDisplay(item.segment) === 'to_review' && !item.segment.readOnly && shows(item);
  for (let step = 1; step <= order.length; step++) {
    const item = order[(((from + step) % order.length) + order.length) % order.length]!;
    if (from >= 0 && item === order[from]) continue;
    if (open(item)) return item;
  }
  return null;
}
