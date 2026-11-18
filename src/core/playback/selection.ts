import type { EpisodeMetadata } from '../types/lerobot';

/**
 * A selection waiting for its episode to load: a host deep link
 * (`initialSelection`) or the selection carried across a data-source swap.
 */
export interface PendingSelection {
  /** Episode to open; the segment's episode, then the first available one, when omitted. */
  episodeIndex?: number;
  /** Segment to select once its episode is open. */
  segmentId?: string;
  /** Seconds from the episode start (a deep link). */
  timeS?: number;
  /** Exact frame (a carried selection); wins over `timeS`. */
  frame?: number;
  /** Apply only when the episode still has this many frames (same timeline). */
  requireLength?: number;
  /** Resume playback after landing. */
  resume?: boolean;
}

/**
 * The episode a pending selection opens, or `null` when it cannot apply (the
 * episode is gone or deleted, or its length changed: another timeline).
 */
export function pendingSelectionEpisode(
  pending: PendingSelection,
  episodes: readonly EpisodeMetadata[],
  deletedEpisodes: ReadonlySet<number>,
  segmentEpisode: number | null,
): number | null {
  const wanted = pending.episodeIndex ?? segmentEpisode;
  if (wanted == null) {
    const first = episodes.find((episode) => !deletedEpisodes.has(episode.episode_index));
    return first ? first.episode_index : null;
  }
  const episode = episodes.find((item) => item.episode_index === wanted);
  if (!episode || deletedEpisodes.has(wanted)) return null;
  if (pending.requireLength != null && episode.length !== pending.requireLength) return null;
  return wanted;
}

/** The frame that contains `timeS` (seconds from the episode start), clamped to the episode. */
export function frameAtSeconds(timeS: number, fps: number, totalFrames: number): number {
  if (!(totalFrames > 0)) return 0;
  const rate = fps > 0 ? fps : 30;
  // A tiny epsilon keeps exact frame times (k / fps) on frame k despite float error.
  const frame = Math.floor(Math.max(0, timeS) * rate + 1e-6);
  return Math.min(totalFrames - 1, frame);
}

/** Where a pending selection lands: its frame, its time, its segment's first frame, or 0. */
export function pendingSelectionFrame(
  pending: PendingSelection,
  segmentStartFrame: number | null,
  fps: number,
  totalFrames: number,
): number {
  if (!(totalFrames > 0)) return 0;
  if (pending.frame != null) return Math.max(0, Math.min(totalFrames - 1, pending.frame));
  if (pending.timeS != null && Number.isFinite(pending.timeS)) {
    return frameAtSeconds(pending.timeS, fps, totalFrames);
  }
  return segmentStartFrame != null ? Math.min(totalFrames - 1, segmentStartFrame) : 0;
}
