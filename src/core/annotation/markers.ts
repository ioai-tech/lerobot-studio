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
  /**
   * Id of a row declared in the viewer's `markerLanes`; markers with one id draw
   * in that row. Without one, or with an id no row declares, the marker draws
   * in the default row, as before rows existed.
   */
  lane?: string;
}

/** A row of the marker lane, declared by the host (`LeRobotViewerProps.markerLanes`). */
export interface TimelineMarkerLane {
  /** Matches `TimelineMarker.lane`. */
  id: string;
  /** Row name, shown as-is above the row and to assistive technology (localize it first). */
  label: string;
  /**
   * Next / previous keys (`Shift+.` / `Shift+,`) and buttons in the row's header
   * move the paused playhead to the next / previous marker start of this row
   * and announce the position ("3 of 39").
   */
  navigable?: boolean;
}

/** One drawn row of the marker lane: a declared lane, or the default row (`lane: null`). */
export interface MarkerRow {
  lane: TimelineMarkerLane | null;
  /** The row's markers of one episode, in time order. */
  markers: TimelineMarker[];
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

/**
 * The rows the marker lane draws for one episode's markers (in time order):
 * declared lanes that hold markers, top to bottom in declaration order, then
 * the default row (markers without a declared lane). Empty rows are left out.
 * A lane id declared twice counts once (the first declaration).
 */
export function markerRowsOf(
  episodeMarkers: readonly TimelineMarker[],
  lanes: readonly TimelineMarkerLane[] | undefined,
): MarkerRow[] {
  const declared = new Map<string, TimelineMarkerLane>();
  for (const lane of lanes ?? []) {
    if (lane && typeof lane.id === 'string' && !declared.has(lane.id)) declared.set(lane.id, lane);
  }
  const byLane = new Map<string, TimelineMarker[]>();
  const rest: TimelineMarker[] = [];
  for (const marker of episodeMarkers) {
    const lane = marker.lane != null ? declared.get(marker.lane) : undefined;
    if (!lane) {
      rest.push(marker);
      continue;
    }
    const list = byLane.get(lane.id);
    if (list) list.push(marker);
    else byLane.set(lane.id, [marker]);
  }
  const rows: MarkerRow[] = [];
  for (const lane of declared.values()) {
    const markers = byLane.get(lane.id);
    if (markers) rows.push({ lane, markers });
  }
  if (rest.length > 0) rows.push({ lane: null, markers: rest });
  return rows;
}

/**
 * The marker of a row the playhead rests on, as its index in `markers` (time
 * order), or -1: `current` (the marker the last step went to) while the
 * playhead is still on its start, else the first marker that starts on `frame`.
 */
export function laneMarkerAt(
  markers: readonly TimelineMarker[],
  current: string | null,
  frame: number,
): number {
  if (current != null) {
    const at = markers.findIndex((marker) => marker.id === current);
    if (at >= 0 && markers[at].startFrame === frame) return at;
  }
  return markers.findIndex((marker) => marker.startFrame === frame);
}

/**
 * The marker a next / previous step of a navigable row goes to, as its index
 * in `markers` (time order), or `null` when there is none in that direction.
 * From the marker the playhead rests on (`laneMarkerAt`), the step goes to its
 * neighbour, so markers that start on the same frame are each visited;
 * elsewhere it goes to the first marker starting after `frame`, or the last
 * one starting before it.
 */
export function stepLaneMarker(
  markers: readonly TimelineMarker[],
  current: string | null,
  frame: number,
  direction: 1 | -1,
): number | null {
  const at = laneMarkerAt(markers, current, frame);
  if (at >= 0) {
    const next = at + direction;
    return next >= 0 && next < markers.length ? next : null;
  }
  if (direction === 1) {
    const next = markers.findIndex((marker) => marker.startFrame > frame);
    return next >= 0 ? next : null;
  }
  for (let index = markers.length - 1; index >= 0; index -= 1) {
    if (markers[index].startFrame < frame) return index;
  }
  return null;
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
