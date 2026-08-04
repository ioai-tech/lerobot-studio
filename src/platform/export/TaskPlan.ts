import type { EpisodeMetadata } from '@/core';

export interface ExportTaskPlan {
  tasks: Record<number, string>;
  episodeTaskIndices: number[][];
  episodeSourceIndexToTargetIndex: Array<Map<number, number>>;
}

/**
 * Resolve one frame's final task_index from the canonical export task plan.
 * Single-task episodes intentionally ignore stale source frame indices.
 */
export function resolveExportTaskIndex(
  taskPlan: ExportTaskPlan,
  episodePosition: number,
  sourceTaskIndex: number,
): number | undefined {
  const episodeTargets = taskPlan.episodeTaskIndices[episodePosition] ?? [];
  if (episodeTargets.length === 1) return episodeTargets[0];
  return taskPlan.episodeSourceIndexToTargetIndex[episodePosition]?.get(sourceTaskIndex);
}

function normalizedLabels(episode: EpisodeMetadata, sourceTasks: Record<number, string>): string[] {
  const labels = Array.isArray(episode.tasks)
    ? episode.tasks
        .map(String)
        .map((task) => task.trim())
        .filter(Boolean)
    : [];
  if (labels.length > 0) return Array.from(new Set(labels));

  if (episode.task_index != null) {
    const label = sourceTasks[Number(episode.task_index)];
    if (label != null && String(label).trim() !== '') return [String(label).trim()];
  }
  const onlySourceTask = Object.values(sourceTasks)
    .map((task) => String(task).trim())
    .filter(Boolean);
  if (onlySourceTask.length === 1) return onlySourceTask;
  return [];
}

/** Build one canonical task mapping shared by frames, episodes and tasks metadata. */
export function buildExportTaskPlan(
  episodes: EpisodeMetadata[],
  sourceTasks: Record<number, string>,
): ExportTaskPlan {
  const labelToTargetIndex = new Map<string, number>();
  const tasks: Record<number, string> = {};
  const episodeTaskIndices = episodes.map((episode) =>
    normalizedLabels(episode, sourceTasks).map((label) => {
      let index = labelToTargetIndex.get(label);
      if (index === undefined) {
        index = labelToTargetIndex.size;
        labelToTargetIndex.set(label, index);
        tasks[index] = label;
      }
      return index;
    }),
  );

  const episodeSourceIndexToTargetIndex = episodes.map((_, position) => {
    const mapping = new Map<number, number>();
    const allowedTargets = new Set(episodeTaskIndices[position]);
    for (const [rawIndex, rawLabel] of Object.entries(sourceTasks)) {
      const sourceIndex = Number(rawIndex);
      const targetIndex = labelToTargetIndex.get(String(rawLabel).trim());
      if (
        Number.isSafeInteger(sourceIndex) &&
        targetIndex !== undefined &&
        allowedTargets.has(targetIndex)
      ) {
        mapping.set(sourceIndex, targetIndex);
      }
    }
    return mapping;
  });

  return { tasks, episodeTaskIndices, episodeSourceIndexToTargetIndex };
}
