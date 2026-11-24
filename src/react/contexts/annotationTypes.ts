import type {
  OverlaySegmentGroup,
  TimelineMarker,
  TimelineMarkerLane,
} from '../../core/annotation/markers';
import type {
  AnnotationChange,
  AnnotationDocument,
  AnnotationField,
  ReviewState,
  Segment,
} from '../../core/annotation/types';

/** What the viewer passes with each change. */
export interface AnnotationChangeMeta {
  /** The viewer's stable id for this change; name it in `saveState.changeIds` to refuse it. */
  changeId: string;
}

/** What the host reports about persisting the changes it received. */
export interface LeRobotAnnotationSaveState {
  /**
   * `refused`: the changes named in `changeIds` are dropped with their undo
   * steps. `reloaded`: `value` replaced the document (another writer, a
   * reload); every change still in flight is dropped and `value` is shown as is.
   */
  kind: 'idle' | 'saving' | 'saved' | 'offline' | 'reloaded' | 'refused';
  /**
   * With `kind: 'refused'`: the `changeId`s the host refused. Each id is
   * handled once, so re-rendering the same refusal is harmless. Without ids,
   * each new refused `saveState` object refuses the oldest change in flight.
   */
  changeIds?: string[];
  /** Shown in the viewer's status line (e.g. the refusal reason). */
  message?: string;
  /** Buttons shown next to the message (e.g. Retry, Reopen). */
  actions?: Array<{ id: string; label: string; onSelect: () => void }>;
}

/**
 * Host-controlled segments. The viewer shows each change at once and calls
 * `onChange(change, { changeId })` in order; the host applies and persists it
 * and passes the new `value` back. Changes not yet in `value` stay shown on
 * top of it. To refuse a change, keep `value` and set `saveState` to
 * `{ kind: 'refused', changeIds: [changeId] }`: that change and its undo step
 * are dropped. When `value` overrides changes still in flight (another
 * writer, a reload), set `kind: 'reloaded'` with it. `value` is compared by
 * identity.
 */
export interface LeRobotAnnotationProps {
  /** The persisted document; replaces the viewer's preview whenever it changes. */
  value: AnnotationDocument;
  /** Omit for a view-only document (no edit control is shown). */
  onChange?: (change: AnnotationChange, meta: AnnotationChangeMeta) => void;
  /** Shown in the status line; `refused` rejects the last change. */
  saveState?: LeRobotAnnotationSaveState;
  /** Ids for new segments. @defaultValue `crypto.randomUUID()` */
  createSegmentId?: () => string;
  /** Whether a segment may be deleted. @defaultValue always */
  canDelete?: (segment: Segment) => boolean;
  /** Review state of a segment a person creates. @defaultValue 'confirmed' */
  newSegmentReview?: ReviewState;
}

/** Segment editing configuration pushed by the viewer into the data provider. */
export interface AnnotationConfig {
  annotation?: LeRobotAnnotationProps;
  readOnly?: boolean;
  fields?: readonly AnnotationField[];
  markers?: readonly TimelineMarker[];
  markerLanes?: readonly TimelineMarkerLane[];
  overlaySegments?: readonly OverlaySegmentGroup[];
}
