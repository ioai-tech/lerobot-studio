import { describe, expect, it } from 'vitest';
import {
  autoLayoutSignature,
  buildAutoLayout,
  type AutoPanel,
} from '../src/react/components/dockviewAutoLayout';

const visual = (key: string): AutoPanel => ({
  id: `video-${key}`,
  component: 'video',
  title: key,
  params: { featureKey: key },
});
const bottom: AutoPanel[] = [
  { id: 'chart-panel', component: 'chart', title: 'Chart', params: {} },
  { id: 'raw-panel', component: 'raw', title: 'Raw', params: {} },
];

type Node = { type: string; data: unknown; size?: number };

describe('automatic dockview layout', () => {
  it('builds rows of equal width over chart + raw in one serialized grid', () => {
    const layout = buildAutoLayout({
      visualRows: [[visual('a'), visual('b'), visual('c')], [visual('d')]],
      bottom,
      stacked: false,
      width: 1200,
      height: 900,
    });
    const rows = layout.grid.root.data as Node[];
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => Math.round(row.size ?? 0))).toEqual([300, 300, 300]);
    const first = rows[0].data as Node[];
    expect(first.map((leaf) => leaf.size)).toEqual([400, 400, 400]);
    expect(rows[1].type).toBe('leaf');
    expect(Object.keys(layout.panels)).toEqual([
      'video-a',
      'video-b',
      'video-c',
      'video-d',
      'chart-panel',
      'raw-panel',
    ]);
    expect(layout.panels['video-a'].contentComponent).toBe('video');
    expect(layout.panels['video-a'].params).toEqual({ featureKey: 'a' });
  });

  it('stacks every panel in one column on narrow containers', () => {
    const layout = buildAutoLayout({
      visualRows: [[visual('a'), visual('b')]],
      bottom,
      stacked: true,
      width: 400,
      height: 880,
    });
    const leaves = layout.grid.root.data as Node[];
    expect(leaves.map((leaf) => leaf.type)).toEqual(['leaf', 'leaf', 'leaf', 'leaf']);
    expect(leaves.every((leaf) => leaf.size === 220)).toBe(true);
  });

  it('changes the signature only when the arrangement changes', () => {
    const one = autoLayoutSignature({
      visualRows: [[visual('a'), visual('b')]],
      bottom,
      stacked: false,
    });
    const same = autoLayoutSignature({
      visualRows: [[{ ...visual('a'), title: 'renamed' }, visual('b')]],
      bottom: bottom.map((panel) => ({ ...panel, title: 'translated' })),
      stacked: false,
    });
    expect(same).toBe(one);
    expect(
      autoLayoutSignature({ visualRows: [[visual('a')], [visual('b')]], bottom, stacked: false }),
    ).not.toBe(one);
    expect(
      autoLayoutSignature({ visualRows: [[visual('a'), visual('b')]], bottom, stacked: true }),
    ).not.toBe(one);
  });
});
