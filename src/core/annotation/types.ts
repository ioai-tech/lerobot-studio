/**
 * Segment annotation model: any episode can be split into an ordered list of
 * non-overlapping frame ranges, each with a task, subtasks, host-declared
 * field values and a review state. Frames are inclusive and relative to the
 * dataset episode (row 0 = the episode's first frame).
 */

/** `to_review`: proposed and not yet confirmed by a person. */
export type ReviewState = 'to_review' | 'confirmed';

/**
 * How a segment is shown and counted: `excluded` when the host marks it
 * excluded (it wins over the review state), else its review state.
 */
export type SegmentReviewDisplay = ReviewState | 'excluded';

/** A labelled range inside a segment (inclusive episode frames). */
export interface SegmentSubtask {
  /** Inclusive first frame within the episode. */
  startFrame: number;
  /** Inclusive last frame within the episode. */
  endFrame: number;
  /** Subtask name; non-empty unless `labelHint` is set. */
  label: string;
  /**
   * Host display text for an empty `label` (for example the label in another
   * language): shown muted on the subtask track and as the rename dialog's
   * placeholder. An empty label with a hint is valid. It is never the label,
   * never in a change the viewer emits and never exported.
   */
  labelHint?: string;
}

/** Who made the segment: a person, or a suggestion (motion, a model, another process). */
export type SegmentOrigin = { kind: 'manual' } | { kind: 'suggested'; confidence?: number };

/** A read-only badge the host attaches (e.g. failed checks). */
export interface SegmentStatus {
  /** `warn` and `fail` put the segment in the Issues filter. */
  severity: 'info' | 'warn' | 'fail';
  /** Short text shown on the badge. */
  label: string;
  /** Optional number shown after the label. */
  count?: number;
}

/** Value of a host-declared field: `select` and `text` hold a string, `tags` a string list. */
export type SegmentFieldValue = string | string[] | null;

/** One reviewed range of an episode; exported as its own episode. */
export interface Segment {
  /** Stable id from the host's `createSegmentId` (default `crypto.randomUUID()`). */
  id: string;
  /** Inclusive first frame within the episode. */
  startFrame: number;
  /** Inclusive last frame within the episode. */
  endFrame: number;
  /** Task text; `null` keeps the dataset episode's own task. */
  task: string | null;
  /**
   * Host display text while `task` is `null` (for example the task in another
   * language): shown muted in the segment list and details instead of the
   * inherited-task copy, and as the task input's placeholder. It is never the
   * task or the input's value, never in a change the viewer emits and never
   * exported.
   */
  taskHint?: string;
  /** Subtasks inside this segment (episode frames), sorted, non-overlapping; gaps allowed. */
  subtasks: SegmentSubtask[];
  /** Values keyed by host field id. */
  values: Record<string, SegmentFieldValue>;
  /** Editing never changes it; only `confirm` sets `confirmed`. */
  review: ReviewState;
  /** Who made the segment. */
  origin: SegmentOrigin;
  /** Host badge, read-only for the viewer. */
  status?: SegmentStatus;
  /**
   * Host fact: the range is excluded (rejected, left out of what the host
   * builds from it). The viewer draws it greyed and hatched with the Excluded
   * text, never as confirmed or to review, and leaves it out of review progress,
   * the To review filter and Confirm all. Editing and confirming never change
   * it; a split keeps it on both halves.
   */
  excluded?: boolean;
  /** When true the viewer refuses every edit of this segment. */
  readOnly?: boolean;
}

/** Segments keyed by dataset `episode_index`. A missing or empty entry = the whole episode, unannotated. */
export interface AnnotationDocument {
  episodes: Record<number, { segments: Segment[] }>;
}

/** Fields an `update` may change. `values` merges key by key (`null` clears a key). */
export type SegmentPatch = Partial<
  Pick<Segment, 'startFrame' | 'endFrame' | 'task' | 'subtasks' | 'values'>
>;

/** A typed edit. Hosts persist these; the viewer's undo emits the inverse change. */
export type AnnotationChange =
  | { op: 'create'; episodeIndex: number; segment: Segment }
  | { op: 'update'; episodeIndex: number; id: string; patch: SegmentPatch }
  | { op: 'delete'; episodeIndex: number; id: string }
  /** Inverse of `delete`: brings the segment back with its fields. */
  | { op: 'restore'; episodeIndex: number; segment: Segment }
  /** Left part keeps `id` (`startFrame..atFrame-1`); the right part gets `newId` (`atFrame..endFrame`). */
  | { op: 'split'; episodeIndex: number; id: string; atFrame: number; newId: string }
  /** `withId` must be the segment right after `id`; the result keeps `id`. */
  | { op: 'merge'; episodeIndex: number; id: string; withId: string }
  /** Inverse of `merge`: `id` returns to `before` and `restored` comes back. */
  | { op: 'unmerge'; episodeIndex: number; id: string; restored: Segment; before: Segment }
  | { op: 'confirm'; episodeIndex: number; ids: string[] };

export type AnnotationChangeOp = AnnotationChange['op'];

/** A host-declared field rendered in the inspector, in order. */
export interface AnnotationField {
  /** Key in `segment.values`; also the export column `segment_<id>`. */
  id: string;
  /** Label shown in the inspector. */
  label: string;
  /** `select`: one option; `tags`: a string list; `text`: free text. */
  kind: 'select' | 'tags' | 'text';
  /** `select` options; `key` is a single-key shortcut that sets the option. */
  options?: Array<{
    value: string;
    label: string;
    key?: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
  }>;
  /** `tags` / `text` suggestions. */
  suggestions?: string[];
  /**
   * A new segment (`N`) starts with this field's value from the segment it
   * continues (the one before it, else the one after it), as it starts with
   * that segment's task. A split keeps every value on both halves either way.
   */
  inherit?: boolean;
}

export type AnnotationRefusalCode =
  | 'EPISODE_UNKNOWN'
  | 'SEGMENT_NOT_FOUND'
  | 'SEGMENT_ID_TAKEN'
  | 'SEGMENT_ID_INVALID'
  | 'SEGMENT_READ_ONLY'
  | 'RANGE_INVALID'
  | 'RANGE_OUTSIDE_EPISODE'
  | 'SEGMENT_OVERLAP'
  | 'SUBTASK_INVALID'
  | 'SUBTASK_OUTSIDE_SEGMENT'
  | 'SUBTASK_OVERLAP'
  | 'FIELD_UNKNOWN'
  | 'FIELD_INVALID'
  | 'PATCH_INVALID'
  | 'SPLIT_OUTSIDE_SEGMENT'
  | 'MERGE_NOT_ADJACENT'
  | 'UNMERGE_MISMATCH';

/** Why a change was refused. The reducer never clamps or drops input silently. */
export interface AnnotationRefusal {
  code: AnnotationRefusalCode;
  op: AnnotationChangeOp;
  episodeIndex: number;
  /** The segment the change targets, when there is one. */
  segmentId?: string;
  /** The other segment involved (overlap, merge). */
  otherId?: string;
  /** The field involved. */
  fieldId?: string;
  /** English diagnostic for logs; UIs translate `code`. */
  message: string;
}

/** What the reducer needs to know about the dataset. */
export interface AnnotationContext {
  /** Number of frames of a dataset episode, or `undefined` when it does not exist. */
  episodeLength: (episodeIndex: number) => number | undefined;
  /** Declared fields. When given, `values` are checked against them. */
  fields?: readonly AnnotationField[];
}

export type ApplyChangeResult =
  | {
      ok: true;
      doc: AnnotationDocument;
      /** The change that undoes this one, or `null` (confirm has no inverse). */
      inverse: AnnotationChange | null;
    }
  | { ok: false; refusal: AnnotationRefusal };
