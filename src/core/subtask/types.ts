import type { LeRobotFeature } from '../types/lerobot';
import type { LeRobotVersionCapability } from '../versioning/versionCapability';

export const SUBTASK_INDEX_FEATURE_KEY = 'subtask_index';
export const SUBTASK_INDEX_FEATURE_KEY_CANDIDATES = [
  'subtask_index',
  'metadata.subtask_index',
] as const;
export const SUBTASK_LABEL_FEATURE_KEY_CANDIDATES = ['metadata.subtask_label', 'subtask'] as const;
export const SUBTASKS_PARQUET_PATH = 'meta/subtasks.parquet';

export const SUBTASK_INDEX_FEATURE: LeRobotFeature = {
  dtype: 'int64',
  shape: [1],
  names: null,
};

export const SUBTASK_LABEL_COLUMN_CANDIDATES = [
  'subtask',
  '__index_level_0__',
  'subtasks',
  'name',
] as const;

/** subtask_index → natural-language label. */
export type SubtaskTable = Record<number, string>;

export interface SubtaskSegment {
  /** Inclusive start frame within the episode. */
  startFrame: number;
  /** Inclusive end frame within the episode. */
  endFrame: number;
  label: string;
}

export interface SubtaskGap {
  startFrame: number;
  endFrame: number;
}

export interface SubtaskCoverage {
  labeledFrames: number;
  totalFrames: number;
  gaps: SubtaskGap[];
  complete: boolean;
}

export const SUBTASK_COVERAGE_INCOMPLETE = 'SUBTASK_COVERAGE_INCOMPLETE';

export class SubtaskCoverageError extends Error {
  readonly code = SUBTASK_COVERAGE_INCOMPLETE;
  readonly episodeIndex: number;
  readonly coverage: SubtaskCoverage;

  constructor(episodeIndex: number, coverage: SubtaskCoverage) {
    super(
      `Episode ${episodeIndex} has unlabeled frames (${coverage.labeledFrames}/${coverage.totalFrames}); export requires complete subtask coverage`,
    );
    this.name = 'SubtaskCoverageError';
    this.episodeIndex = episodeIndex;
    this.coverage = coverage;
  }
}

export function canMutateSubtasks(capability: LeRobotVersionCapability | null): boolean {
  return capability?.status === 'supported' && capability.adapterVersion === 'v3.0';
}

export function resolveSubtaskIndexFeatureKey(
  features: Record<string, LeRobotFeature> | undefined,
): string | null {
  if (!features) return null;
  return SUBTASK_INDEX_FEATURE_KEY_CANDIDATES.find((key) => features[key] != null) ?? null;
}

export function resolveSubtaskLabelFeatureKey(
  features: Record<string, LeRobotFeature> | undefined,
): string | null {
  if (!features) return null;
  return SUBTASK_LABEL_FEATURE_KEY_CANDIDATES.find((key) => features[key] != null) ?? null;
}

export function hasSubtaskIndexFeature(
  features: Record<string, LeRobotFeature> | undefined,
): boolean {
  return resolveSubtaskIndexFeatureKey(features) != null;
}
