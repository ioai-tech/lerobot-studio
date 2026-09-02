import { normalizeSubtaskLabel } from './subtaskPlan';

/** Distinct qualitative colors for neighboring subtask clips. */
export const SUBTASK_COLOR_PALETTE = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#65a30d',
  '#ea580c',
  '#4f46e5',
] as const;

function hashLabel(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function colorForSubtaskLabel(label: string, knownLabels: readonly string[] = []): string {
  const normalized = normalizeSubtaskLabel(label);
  if (!normalized) return '#64748b';
  const fromKnown = knownLabels.findIndex((item) => normalizeSubtaskLabel(item) === normalized);
  const index = fromKnown >= 0 ? fromKnown : hashLabel(normalized);
  return SUBTASK_COLOR_PALETTE[index % SUBTASK_COLOR_PALETTE.length];
}
