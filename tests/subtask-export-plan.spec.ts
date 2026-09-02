import { describe, expect, it } from 'vitest';
import { SubtaskCoverageError, type EpisodeMetadata, type LeRobotInfo } from '@/core';
import {
  applySubtaskFeaturesForExport,
  buildExportSubtaskPlan,
} from '../src/platform/export/SubtaskExportPlan';
import type { LeRobotDataLoader } from '@/platform';

const info = {
  codebase_version: 'v3.0',
  features: {},
} as unknown as LeRobotInfo;

const episodes: EpisodeMetadata[] = [{ episode_index: 3, length: 3, tasks: ['pick'] }];

describe('buildExportSubtaskPlan', () => {
  it('returns null when the dataset has no subtasks', async () => {
    const plan = await buildExportSubtaskPlan({
      dataLoader: { loadEpisodeSubtaskIndices: async () => [] } as unknown as LeRobotDataLoader,
      info,
      episodes,
      overlay: new Map(),
      sourceTable: {},
      targetVersion: 'v3.0',
    });
    expect(plan).toBeNull();
  });

  it('blocks incomplete coverage', async () => {
    await expect(
      buildExportSubtaskPlan({
        dataLoader: { loadEpisodeSubtaskIndices: async () => [] } as unknown as LeRobotDataLoader,
        info,
        episodes,
        overlay: new Map([[3, [{ startFrame: 0, endFrame: 1, label: 'Approach the apple' }]]]),
        sourceTable: {},
        targetVersion: 'v3.0',
      }),
    ).rejects.toBeInstanceOf(SubtaskCoverageError);
  });

  it('assigns alphabetical indices and complete frames', async () => {
    const plan = await buildExportSubtaskPlan({
      dataLoader: { loadEpisodeSubtaskIndices: async () => [] } as unknown as LeRobotDataLoader,
      info,
      episodes,
      overlay: new Map([
        [
          3,
          [
            { startFrame: 0, endFrame: 0, label: 'Grasp the apple' },
            { startFrame: 1, endFrame: 2, label: 'Approach the apple' },
          ],
        ],
      ]),
      sourceTable: {},
      targetVersion: 'v3.0',
    });
    expect(plan?.table).toEqual({
      0: 'Approach the apple',
      1: 'Grasp the apple',
    });
    expect(plan?.framesBySourceEpisode.get(3)).toEqual([1, 0, 0]);
  });

  it('strips subtask features when exporting v2.1', () => {
    const withFeature = {
      ...info,
      features: {
        subtask_index: { dtype: 'int64', shape: [1], names: null },
      },
    } as LeRobotInfo;
    const result = applySubtaskFeaturesForExport(withFeature, 'v2.1', {
      table: { 0: 'Approach' },
      framesBySourceEpisode: new Map(),
    });
    expect(result.dropSubtaskColumn).toBe(true);
    expect(result.info.features.subtask_index).toBeUndefined();
  });
});
