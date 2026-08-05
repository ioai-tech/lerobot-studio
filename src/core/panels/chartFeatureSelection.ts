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
