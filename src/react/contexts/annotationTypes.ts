import type {
  AnnotationChange,
  AnnotationDocument,
  AnnotationField,
  ReviewState,
  Segment,
} from '../../core/annotation/types';

/** What the host reports about persisting the changes it received. */
export interface LeRobotAnnotationSaveState {
  /** `refused` drops the viewer's preview of the last change. */
  kind: 'idle' | 'saving' | 'saved' | 'offline' | 'reloaded' | 'refused';
  /** Shown in the viewer's status line (e.g. the refusal reason). */
  message?: string;
  /** Buttons shown next to the message (e.g. Retry, Reopen). */
  actions?: Array<{ id: string; label: string; onSelect: () => void }>;
}

/**
 * Host-controlled segments. The viewer shows each change at once and calls
 * `onChange` (in order); the host applies and persists it and passes the new
 * `value` back. Changes not yet in `value` stay shown on top of it. To refuse
 * a change, keep `value` and set a new `saveState` object with
 * `kind: 'refused'`: the oldest change in flight and its undo step are
 * dropped. `value` and `saveState` are compared by identity.
 */
export interface LeRobotAnnotationProps {
  /** The persisted document; replaces the viewer's preview whenever it changes. */
  value: AnnotationDocument;
  /** Omit for a view-only document (no edit control is shown). */
  onChange?: (change: AnnotationChange) => void;
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
}
