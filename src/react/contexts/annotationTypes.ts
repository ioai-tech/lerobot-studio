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
 * Host-controlled segments. The viewer previews each change locally and calls
 * `onChange`; the host applies and persists it and passes the new `value`
 * back, which replaces the preview. A host that refuses a change keeps
 * `value` and sets `saveState.kind` to `'refused'`.
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
