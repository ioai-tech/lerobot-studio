export type ChartSeriesKind = 'action' | 'state';

export type ChartDimensionMeta = {
  id: string;
  featureKey: string;
  dimIndex: number;
  jointName: string;
  kind: ChartSeriesKind;
};
