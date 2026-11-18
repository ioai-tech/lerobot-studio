import type { Segment } from './types';

/**
 * A host mark on an episode's time axis (for example a failed quality check
 * over a range). Frames are inclusive episode frames, like segments.
 */
export interface TimelineMarker {
  /** Stable id (React key and `onSelectionChange`-independent identity). */
  id: string;
  /** Dataset `episode_index` the marker belongs to. */
  episodeIndex: number;
  /** Inclusive first frame. */
  startFrame: number;
  /** Inclusive last frame (equal to `startFrame` for a single-frame tick). */
  endFrame: number;
  /** `warn` and `fail` put overlapping segments in the Issues filter. */
  severity: 'info' | 'warn' | 'fail';
  /** Display text, shown as-is in the tooltip and to assistive technology (localize it first). */
  label: string;
  /** Optional id of the check that produced the marker; the viewer never shows it. */
  checkId?: string;
}

/** A read-only segment from another process, shown in its own band. */
export type OverlaySegment = Pick<Segment, 'id' | 'startFrame' | 'endFrame' | 'task' | 'origin'>;

/** Read-only segments of one dataset episode (for example another process's proposals). */
export interface OverlaySegmentGroup {
  /** Dataset `episode_index` the segments belong to. */
  episodeIndex: number;
  /** Inclusive frame ranges of that episode. */
  segments: OverlaySegment[];
}

/** Markers of one episode, in time order. */
export function markersOfEpisode(
  markers: readonly TimelineMarker[] | undefined,
  episodeIndex: number | null,
): TimelineMarker[] {
  if (!markers || episodeIndex == null) return [];
  return markers
    .filter((marker) => marker.episodeIndex === episodeIndex && isValidMarker(marker))
    .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
}

function isValidMarker(marker: TimelineMarker): boolean {
  return (
    Number.isSafeInteger(marker.startFrame) &&
    Number.isSafeInteger(marker.endFrame) &&
    marker.startFrame >= 0 &&
    marker.endFrame >= marker.startFrame
  );
}

/** `warn` and `fail` markers are issues; `info` markers are not. */
export function isIssueMarker(marker: TimelineMarker): boolean {
  return marker.severity === 'warn' || marker.severity === 'fail';
}

/** Issue markers of `episodeMarkers` that overlap `segment` (same episode assumed). */
export function segmentIssueMarkers(
  segment: Pick<Segment, 'startFrame' | 'endFrame'>,
  episodeMarkers: readonly TimelineMarker[],
): TimelineMarker[] {
  return episodeMarkers.filter(
    (marker) =>
      isIssueMarker(marker) &&
      marker.startFrame <= segment.endFrame &&
      marker.endFrame >= segment.startFrame,
  );
}

/** Overlay segments of one episode, sorted and limited to valid ranges. */
export function overlaySegmentsOfEpisode(
  groups: readonly OverlaySegmentGroup[] | undefined,
  episodeIndex: number | null,
): OverlaySegment[] {
  if (!groups || episodeIndex == null) return [];
  return groups
    .filter((group) => group.episodeIndex === episodeIndex)
    .flatMap((group) => group.segments)
    .filter(
      (segment) =>
        Number.isSafeInteger(segment.startFrame) &&
        Number.isSafeInteger(segment.endFrame) &&
        segment.startFrame >= 0 &&
        segment.endFrame >= segment.startFrame,
    )
    .sort((a, b) => a.startFrame - b.startFrame);
}
