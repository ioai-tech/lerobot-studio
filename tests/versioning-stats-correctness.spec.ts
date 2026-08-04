import * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import {
  computeDatasetStats,
  classifyLeRobotVersion,
  getAdapterForVersion,
  getValidatorForVersion,
  isV2Info,
  isSupportedLeRobotVersion,
  V3FormatValidator,
  type DataSource,
  type LeRobotInfo,
} from '@/core';

const info = {
  codebase_version: 'v3.0',
  robot_type: null,
  total_episodes: 1,
  total_frames: 4,
  total_tasks: 0,
  fps: 30,
  chunks_size: 1000,
  data_path: 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet',
  video_path: null,
  tools: null,
  splits: { train: '0:1' },
  features: {
    action: { dtype: 'float32', shape: [1], names: null, future_field: 'kept' },
    instruction: { dtype: 'language', shape: [1], names: null },
    'observation.depth': { dtype: 'depth', shape: [1, 2, 2], names: null },
  },
  future_info_field: { enabled: true },
} as unknown as LeRobotInfo;

describe('exact LeRobot version support', () => {
  it('accepts only explicitly supported versions', () => {
    expect(isSupportedLeRobotVersion(' V2.1 ')).toBe(true);
    expect(isSupportedLeRobotVersion('v3.0')).toBe(true);
    expect(isSupportedLeRobotVersion('v2.0')).toBe(false);
    expect(isSupportedLeRobotVersion('v3.1')).toBe(false);
    expect(classifyLeRobotVersion('v3.1')).toEqual({
      status: 'read-only',
      normalizedVersion: 'v3.1',
      adapterVersion: 'v3.0',
    });
    expect(classifyLeRobotVersion('v2.0').status).toBe('unsupported');
    expect(classifyLeRobotVersion('v3-preview').status).toBe('unsupported');
    expect(classifyLeRobotVersion('v3.01').status).toBe('unsupported');
    expect(classifyLeRobotVersion('').status).toBe('unsupported');
    expect(getAdapterForVersion('v3.1').version).toBe('v3.0');
    expect(() => getAdapterForVersion('v2.0')).toThrow(/Unsupported/);
    expect(() => getValidatorForVersion('v2.0')).toThrow(/Unsupported/);
    expect(() => getAdapterForVersion('v3-preview')).toThrow(/Unsupported/);
    expect(getValidatorForVersion('v2.9')).toBeDefined();
    expect(isV2Info({ codebase_version: 'v2.0' } as LeRobotInfo)).toBe(false);
  });
});

describe('forward-compatible metadata validation', () => {
  it('accepts language/depth and nullable optional metadata', async () => {
    const episodeTable = arrow.tableFromArrays({
      episode_index: [0],
      length: [4],
      dataset_from_index: [0],
      dataset_to_index: [4],
    });
    const dataSource: DataSource = {
      exists: async () => true,
      readText: async () => {
        throw new Error('not needed');
      },
      readBytes: async () => new Uint8Array(),
      getObjectUrl: async () => '',
      clear: () => undefined,
    };
    const report = await new V3FormatValidator().validate(dataSource, info, {
      readParquetToIPC: async () => arrow.tableToIPC(episodeTable, 'stream'),
    });

    expect(report.hasError).toBe(false);
    expect(report.items.filter((item) => item.code === 'DTYPE_INVALID')).toEqual([]);
    expect(report.items.filter((item) => item.code === 'ROBOT_TYPE_MISSING')).toEqual([]);

    const readOnlyReport = await new V3FormatValidator().validate(
      dataSource,
      { ...info, codebase_version: 'v3.1' } as unknown as LeRobotInfo,
      { readParquetToIPC: async () => arrow.tableToIPC(episodeTable, 'stream') },
    );
    expect(readOnlyReport.hasError).toBe(false);
    expect(readOnlyReport.items.some((item) => item.code === 'VERSION_READ_ONLY')).toBe(true);
  });
});

describe('training-ready dataset stats', () => {
  it('writes official histogram quantiles and array-shaped sample count', async () => {
    const table = arrow.tableFromArrays({ action: [0, 10, 20, 30] });
    const numericInfo = {
      ...info,
      features: { action: info.features.action },
    } as LeRobotInfo;
    const stats = await computeDatasetStats(
      { getEpisodeTableForExport: async () => ({ table }) },
      numericInfo,
      [{ episode_index: 0, length: 4, tasks: [] }],
    );

    expect(stats.action.count).toEqual([4]);
    expect(stats.action.q01[0]).toBeCloseTo(0);
    expect(stats.action.q10[0]).toBeCloseTo(0);
    expect(stats.action.q50[0]).toBeCloseTo(10.002, 3);
    expect(stats.action.q90[0]).toBeCloseTo(29.9976, 3);
    expect(stats.action.q99[0]).toBeCloseTo(29.99976, 3);
  });

  it('fails explicitly when declared numeric data is unavailable', async () => {
    const table = arrow.tableFromArrays({ other: [1] });
    const numericInfo = {
      ...info,
      features: { action: info.features.action },
    } as LeRobotInfo;
    await expect(
      computeDatasetStats({ getEpisodeTableForExport: async () => ({ table }) }, numericInfo, [
        { episode_index: 0, length: 1, tasks: [] },
      ]),
    ).rejects.toThrow(/missing feature "action"/);
  });
});
