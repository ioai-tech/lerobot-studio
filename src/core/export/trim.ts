import type { SubtaskSegment } from '../subtask';

/** Inclusive frame indices in the original episode, like subtask ranges. */
export interface EpisodeTrimRange {
  startFrame: number;
  endFrame: number;
}

export function validateEpisodeTrim(range: EpisodeTrimRange, length: number): void {
  if (
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    !Number.isSafeInteger(range.startFrame) ||
    !Number.isSafeInteger(range.endFrame) ||
    range.startFrame < 0 ||
    range.endFrame < range.startFrame ||
    range.endFrame >= length
  ) {
    throw new Error(`Invalid trim ${range.startFrame}–${range.endFrame} for ${length} frames`);
  }
}

export function trimSubtaskSegments(
  segments: readonly SubtaskSegment[],
  range: EpisodeTrimRange,
): SubtaskSegment[] {
  return segments.flatMap((segment) => {
    const start = Math.max(segment.startFrame, range.startFrame);
    const end = Math.min(segment.endFrame, range.endFrame);
    return start <= end
      ? [{ ...segment, startFrame: start - range.startFrame, endFrame: end - range.startFrame }]
      : [];
  });
}
