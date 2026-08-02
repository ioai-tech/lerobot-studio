import { describe, expect, it } from 'vitest';
import { getChartSeriesKind, getDefaultChartFeatureKeys } from '@ioai/lerobot-studio-core';
import type { LeRobotInfo } from '@ioai/lerobot-studio-core';

const info = {
  features: {
    'observation.left_arm': { dtype: 'float32', shape: [7], names: null },
    'observation.right_arm': { dtype: 'int64', shape: [7], names: null },
    'action.left_arm': { dtype: 'float32', shape: [7], names: null },
    'misc.scalar': { dtype: 'float64', shape: [1], names: null },
    'observation.image': { dtype: 'image', shape: [1], names: null },
    task: { dtype: 'string', shape: [1], names: null },
    timestamp: { dtype: 'float32', shape: [1], names: null },
  },
} as LeRobotInfo;

describe('chart feature selection', () => {
  it('defaults to numeric observation/action feature keys only', () => {
    expect(getDefaultChartFeatureKeys(info)).toEqual([
      'observation.left_arm',
      'observation.right_arm',
      'action.left_arm',
    ]);
  });

  it('prefers an explicit feature key when provided', () => {
    expect(getDefaultChartFeatureKeys(info, 'action.left_arm')).toEqual(['action.left_arm']);
  });

  it('classifies feature keys by prefix for state/action rendering', () => {
    expect(getChartSeriesKind('action.left_arm')).toBe('action');
    expect(getChartSeriesKind('action')).toBe('action');
    expect(getChartSeriesKind('observation.left_arm')).toBe('state');
    expect(getChartSeriesKind('misc.scalar')).toBe('state');
  });
});
