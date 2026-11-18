import { describe, expect, it } from 'vitest';
import {
  buildFeatureChartGroups,
  decimateMinMax,
  defaultVisibleSeriesIds,
  DEFAULT_VISIBLE_DIMENSIONS,
  featureUnit,
  nearestSampleIndex,
} from '../src/react/components/panels/ChartPanel/chartGroupsModel';

const names18 = Array.from({ length: 18 }, (_, i) => `joint_${i}`);

describe('chart groups', () => {
  it('builds one group per feature, titled by key, with declared names and units', () => {
    const groups = buildFeatureChartGroups(
      ['action', 'observation.state'],
      {
        action: { dtype: 'float32', shape: [18], names: names18, unit: 'rad' },
        'observation.state': { dtype: 'float32', shape: [2], names: null },
      } as never,
      {
        action: { values: new Float64Array(18), rows: 1, width: 18 },
        'observation.state': { values: new Float64Array(2), rows: 1, width: 2 },
      },
    );
    expect(groups.map((group) => [group.title, group.unit, group.series.length])).toEqual([
      ['action', 'rad', 18],
      ['observation.state', null, 2],
    ]);
    expect(groups[0]!.series[3]!.label).toBe('joint_3');
    expect(groups[1]!.series[1]!.label).toBe('state[1]');
    const visible = defaultVisibleSeriesIds(groups);
    expect(visible.filter((id) => id.startsWith('action::'))).toHaveLength(
      DEFAULT_VISIBLE_DIMENSIONS,
    );
    expect(visible.filter((id) => id.startsWith('observation.state::'))).toHaveLength(2);
  });

  it('reads units from unit / units / info, and refuses to merge mixed units', () => {
    expect(featureUnit({ units: ['m', 'm', 'm'] })).toBe('m');
    expect(featureUnit({ info: { unit: 'N' } })).toBe('N');
    expect(featureUnit({ units: ['m', 'rad'] })).toBeNull();
    expect(featureUnit({})).toBeNull();
  });

  it('min/max decimation keeps every extreme of every pixel column', () => {
    const n = 100_000;
    const x = Float64Array.from({ length: n }, (_, i) => i / 200);
    const y = Float64Array.from({ length: n }, (_, i) => Math.sin(i / 50) + (i === 77_777 ? 9 : 0));
    const out = decimateMinMax(x, [y], 400);
    expect(out.x.length).toBeLessThanOrEqual(400 * 4);
    expect(Math.max(...out.ys[0]!)).toBe(Math.max(...y));
    expect(Math.min(...out.ys[0]!)).toBe(Math.min(...y));
    for (let i = 1; i < out.x.length; i++) expect(out.x[i]!).toBeGreaterThanOrEqual(out.x[i - 1]!);
    // Short series are drawn as-is.
    expect(decimateMinMax(x.subarray(0, 100), [y.subarray(0, 100)], 400).x).toHaveLength(100);
  });

  it('finds the nearest sample', () => {
    const t = [0, 0.005, 0.01, 0.015];
    expect(nearestSampleIndex(t, 0.0074)).toBe(1);
    expect(nearestSampleIndex(t, 0.0076)).toBe(2);
    expect(nearestSampleIndex(t, -1)).toBe(0);
    expect(nearestSampleIndex(t, 9)).toBe(3);
  });
});
