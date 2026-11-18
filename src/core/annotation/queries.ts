import { getEpisodeSegments } from './reducer';
import type {
  AnnotationDocument,
  AnnotationField,
  ReviewState,
  Segment,
  SegmentSubtask,
} from './types';

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

/** Segments with a warning or failure badge. */
export function hasSegmentIssue(segment: Segment): boolean {
  return segment.status?.severity === 'warn' || segment.status?.severity === 'fail';
}

export type SegmentFilter = 'all' | 'to_review' | 'issues';

export function matchesSegmentFilter(segment: Segment, filter: SegmentFilter): boolean {
  if (filter === 'to_review') return segment.review === 'to_review';
  if (filter === 'issues') return hasSegmentIssue(segment);
  return true;
}

/** "N / M confirmed" over every segment of the document. */
export function reviewProgress(doc: AnnotationDocument): { confirmed: number; total: number } {
  let confirmed = 0;
  let total = 0;
  for (const entry of Object.values(doc.episodes)) {
    for (const segment of entry?.segments ?? []) {
      total += 1;
      if (segment.review === 'confirmed') confirmed += 1;
    }
  }
  return { confirmed, total };
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
