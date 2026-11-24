import type { AnnotationChange, Segment, SegmentPatch, SegmentSubtask } from './types';

/** A hint is shown only as non-empty text. */
function hintText(hint: unknown): string | null {
  return typeof hint === 'string' && hint.trim() !== '' ? hint : null;
}

/** The host's display hint for a segment without a task, or `null`. */
export function segmentTaskHint(segment: Pick<Segment, 'task' | 'taskHint'>): string | null {
  return segment.task == null || segment.task === '' ? hintText(segment.taskHint) : null;
}

/** The host's display hint for a subtask without a label, or `null`. */
export function subtaskLabelHint(
  subtask: Pick<SegmentSubtask, 'label' | 'labelHint'>,
): string | null {
  return subtask.label.trim() === '' ? hintText(subtask.labelHint) : null;
}

/** A subtask with an empty label is valid only while it carries a hint. */
export function hasSubtaskLabel(subtask: Pick<SegmentSubtask, 'label' | 'labelHint'>): boolean {
  return subtask.label.trim() !== '' || subtaskLabelHint(subtask) != null;
}

function subtasksWithoutHints(subtasks: readonly SegmentSubtask[]): SegmentSubtask[] {
  return subtasks.map(({ startFrame, endFrame, label }) => ({ startFrame, endFrame, label }));
}

function segmentWithoutHints(segment: Segment): Segment {
  const { taskHint: _taskHint, ...rest } = segment;
  return Array.isArray(rest.subtasks)
    ? { ...rest, subtasks: subtasksWithoutHints(rest.subtasks) }
    : rest;
}

function patchWithoutHints(patch: SegmentPatch): SegmentPatch {
  return Array.isArray(patch.subtasks)
    ? { ...patch, subtasks: subtasksWithoutHints(patch.subtasks) }
    : patch;
}

/**
 * The change as the host receives it: display hints (`Segment.taskHint`,
 * `SegmentSubtask.labelHint`) are the host's own display text, never data, so
 * a segment copied into a change (a restore, an unmerge, a subtask list) does
 * not carry them back.
 */
export function withoutDisplayHints(change: AnnotationChange): AnnotationChange {
  switch (change.op) {
    case 'create':
    case 'restore':
      return { ...change, segment: segmentWithoutHints(change.segment) };
    case 'unmerge':
      return {
        ...change,
        restored: segmentWithoutHints(change.restored),
        before: segmentWithoutHints(change.before),
      };
    case 'update':
      return { ...change, patch: patchWithoutHints(change.patch) };
    default:
      return change;
  }
}
