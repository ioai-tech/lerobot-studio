/**
 * The one time axis of an episode. Frame `k` covers the time
 * `[k / fps, (k + 1) / fps)`, so on an axis of `totalFrames` frames it covers
 * the fraction `[k / totalFrames, (k + 1) / totalFrames)` and the episode ends
 * at 1. The playhead sits at the start of its frame, like every chart's time
 * axis (`timestamp = k / fps`). The slider, segment track, subtask track,
 * markers, overlay band and charts all place time with these functions.
 */

/** Fraction (0..1) where `frame` starts. */
export function frameStartFraction(frame: number, totalFrames: number): number {
  if (!(totalFrames > 0)) return 0;
  return Math.max(0, Math.min(1, frame / totalFrames));
}

/** Left and width fractions of the inclusive range `startFrame..endFrame`. */
export function frameRangeFractions(
  startFrame: number,
  endFrame: number,
  totalFrames: number,
): { left: number; width: number } {
  if (!(totalFrames > 0)) return { left: 0, width: 0 };
  const left = frameStartFraction(startFrame, totalFrames);
  const right = frameStartFraction(Math.max(startFrame, endFrame) + 1, totalFrames);
  return { left, width: Math.max(0, right - left) };
}

/** The frame under a fraction of the axis (the frame whose time span contains it). */
export function frameAtFraction(fraction: number, totalFrames: number): number {
  if (!(totalFrames > 0)) return 0;
  const clamped = Math.max(0, Math.min(1, fraction));
  // A tiny epsilon keeps a frame's own start (k / N) on frame k despite float error.
  return Math.min(totalFrames - 1, Math.floor(clamped * totalFrames + 1e-9));
}

/** CSS `left` / `width` percentages for a range on the axis. */
export function frameRangeStyle(
  startFrame: number,
  endFrame: number,
  totalFrames: number,
): { left: string; width: string } {
  const { left, width } = frameRangeFractions(startFrame, endFrame, totalFrames);
  return { left: `${(left * 100).toFixed(4)}%`, width: `${(width * 100).toFixed(4)}%` };
}

/**
 * Time domain of an episode's charts, seconds: from the first frame's time to
 * the end of the last frame, so a chart's playhead lands at the same fraction
 * as the slider's.
 */
export function episodeTimeDomain(
  firstFrameTime: number,
  totalFrames: number,
  fps: number,
): [number, number] {
  const rate = fps > 0 ? fps : 30;
  return [firstFrameTime, firstFrameTime + Math.max(1, totalFrames) / rate];
}
