import { describe, expect, it } from 'vitest';
import { SubtaskCoverageError, type EpisodeMetadata, type LeRobotInfo } from '@/core';
import zh from '../src/react/locales/zh.json';
import en from '../src/react/locales/en.json';
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

  it('rejects an unlabeled exported episode with zero labeled frames', async () => {
    const error = await buildExportSubtaskPlan({
      dataLoader: {
        loadEpisodeSubtaskIndices: async () => Array.from({ length: 57 }, () => null),
      } as unknown as LeRobotDataLoader,
      info,
      episodes: [
        { episode_index: 0, length: 3, tasks: ['pick'] },
        { episode_index: 1, length: 3, tasks: ['pick'] },
        { episode_index: 2, length: 57, tasks: ['pick'] },
      ],
      overlay: new Map([
        [0, [{ startFrame: 0, endFrame: 2, label: 'Approach the apple' }]],
        [1, [{ startFrame: 0, endFrame: 2, label: 'Grasp the apple' }]],
      ]),
      sourceTable: {},
      targetVersion: 'v3.0',
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(SubtaskCoverageError);
    expect(error).toMatchObject({
      episodeIndex: 2,
      coverage: expect.objectContaining({ labeledFrames: 0, totalFrames: 57 }),
    });
  });

  it('uses Episode #N copy for an unlabeled episode', () => {
    expect(zh.export.subtaskCoverageMissing.replace('{{index}}', '2')).toBe(
      'Episode #2 还没有标注子任务。',
    );
    expect(en.export.subtaskCoverageMissing.replace('{{index}}', '2')).toBe(
      'Episode #2 has no subtask labels.',
    );
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
