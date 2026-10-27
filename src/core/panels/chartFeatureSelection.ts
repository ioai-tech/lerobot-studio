import type { LeRobotFeature, LeRobotInfo } from '../types/lerobot';

import type { ChartSeriesKind } from './chartTypes';
export type { ChartSeriesKind };

function isChartFeatureKey(featureKey: string): boolean {
  return (
    featureKey === 'observation' ||
    featureKey.startsWith('observation.') ||
    featureKey === 'action' ||
    featureKey.startsWith('action.')
  );
}

function isNumericFeature(feature: LeRobotFeature | undefined): boolean {
  if (!feature?.dtype) return false;
  const dtype = feature.dtype.toLowerCase();
  return (
    dtype.includes('float') ||
    dtype.includes('int') ||
    dtype.includes('double') ||
    dtype.includes('decimal')
  );
}

export function getChartSeriesKind(featureKey: string): ChartSeriesKind {
  if (featureKey === 'action' || featureKey.startsWith('action.')) {
    return 'action';
  }

  // Default to state so non-standard numeric observation keys still render.
  return 'state';
}

export function getDefaultChartFeatureKeys(
  info: LeRobotInfo | null,
  featureKey?: string,
): string[] {
  if (featureKey) return [featureKey];
  if (!info?.features) return [];

  return Object.entries(info.features)
    .filter(([key, feature]) => isChartFeatureKey(key) && isNumericFeature(feature))
    .map(([key]) => key);
}

/**
 * Series a chart shows and loads before the user picks any: whole features in info order until
 * their dimensions reach the budget (the first feature always counts). A 1,000-dimension human
 * dataset then opens with a readable chart and a small read; the rest load when selected.
 */
export const DEFAULT_CHART_DIMENSION_BUDGET = 64;

export function getFeatureDimensionCount(feature: LeRobotFeature | undefined): number {
  const shape = Array.isArray(feature?.shape) ? feature.shape : [1];
  return Math.max(
    1,
    shape.reduce((product, size) => product * (Number.isFinite(size) && size > 0 ? size : 1), 1),
  );
}

export function getBudgetedChartFeatureKeys(
  info: LeRobotInfo | null,
  featureKeys: string[],
  budget = DEFAULT_CHART_DIMENSION_BUDGET,
): string[] {
  const selected: string[] = [];
  let used = 0;
  for (const key of featureKeys) {
    const width = getFeatureDimensionCount(info?.features?.[key]);
    if (selected.length > 0 && used + width > budget) continue;
    selected.push(key);
    used += width;
  }
  return selected;
}
