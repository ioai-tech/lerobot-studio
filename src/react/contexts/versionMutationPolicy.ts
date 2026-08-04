import type { EpisodeMetadata, LeRobotVersionCapability } from '@/core';

export function assertEpisodeMutationAllowed(
  capability: LeRobotVersionCapability | null,
): asserts capability is LeRobotVersionCapability & { status: 'supported' } {
  if (capability?.status !== 'supported') {
    const version = capability?.normalizedVersion ?? 'unknown';
    const status = capability?.status ?? 'unavailable';
    throw new Error(
      `Episode mutations are disabled for LeRobot ${version} (${status}); the dataset is immutable`,
    );
  }
}

export function createEpisodeTaskEdit(newTask: string): Partial<EpisodeMetadata> {
  return { tasks: [newTask], task_index: undefined };
}
