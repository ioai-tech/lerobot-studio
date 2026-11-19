import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { I18nProvider } from '@/i18n/core';
import {
  FeatureChartGroups,
  type ChartGroupData,
} from '@/components/panels/ChartPanel/FeatureChartGroups';
import type { ChartGroup } from '@/components/panels/ChartPanel/chartGroupsModel';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const x = Float64Array.from([0, 0.1, 0.2, 0.3]);
const group = (id: string): ChartGroup => ({
  id,
  title: id,
  unit: null,
  kind: 'feature',
  series: [{ id: `${id}:0`, label: 'joint', dimIndex: 0 }],
});
const loaded = (id: string): ChartGroupData => ({
  group: group(id),
  x,
  values: () => Float64Array.from([0, 1, 0, 1]),
});

function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) resolve();
      else if (performance.now() - startedAt > timeoutMs) reject(new Error('waitFor timeout'));
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

it('draws a chart group as soon as its columns arrive; groups still loading keep their place', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'width:800px;height:400px';
  document.body.append(host);
  const root = createRoot(host);
  const render = (groups: ChartGroupData[]) =>
    act(async () =>
      root.render(
        <I18nProvider forcedLanguage="en">
          <FeatureChartGroups
            groups={groups}
            selectedIds={new Set(['observation.state:0', 'action:0'])}
            onToggleSeries={() => undefined}
            xRange={[0, 0.3]}
            getPlayheadTime={() => 0}
            subscribePlayheadTime={() => () => undefined}
            onSeekTime={() => undefined}
            resolvedTheme="light"
          />
        </I18nProvider>,
      ),
    );
  try {
    await render([
      loaded('observation.state'),
      { group: group('action'), x, values: () => undefined, pending: true },
    ]);
    const container = () => host.querySelector('[data-testid="chart-groups"]')!;
    const section = (id: string) => host.querySelector(`[data-chart-group="${id}"]`)!;
    await waitFor(() => section('observation.state').querySelector('canvas') !== null);
    expect(container().getAttribute('aria-busy')).toBe('true');
    // The pending group shows its header in place, without a chart yet.
    expect(section('action').getAttribute('aria-busy')).toBe('true');
    expect(section('action').querySelector('h3')?.textContent).toBe('action');
    expect(section('action').querySelector('canvas')).toBeNull();
    const order = () =>
      Array.from(host.querySelectorAll('[data-chart-group]')).map((el) =>
        el.getAttribute('data-chart-group'),
      );
    expect(order()).toEqual(['observation.state', 'action']);

    await render([loaded('observation.state'), loaded('action')]);
    await waitFor(() => section('action').querySelector('canvas') !== null);
    expect(container().getAttribute('aria-busy')).toBe('false');
    expect(section('action').hasAttribute('aria-busy')).toBe(false);
    expect(order()).toEqual(['observation.state', 'action']);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('a short chart panel never puts legend chips on a plot or its axis; the groups scroll (s10 F-25)', async () => {
  const host = document.createElement('div');
  // A 1024 × 768 layout leaves the chart panel about this small.
  host.style.cssText = 'width:330px;height:190px';
  document.body.append(host);
  const root = createRoot(host);
  const wide = (id: string): ChartGroupData => ({
    group: {
      id,
      title: id,
      unit: null,
      kind: 'feature',
      series: Array.from({ length: 14 }, (_, dimIndex) => ({
        id: `${id}:${dimIndex}`,
        label: `proximal_pitch_${dimIndex}_Joint`,
        dimIndex,
      })),
    },
    x,
    values: () => Float64Array.from([0, 1, 0, 1]),
  });
  const ids = ['action', 'observation.state'];
  const selected = new Set(ids.flatMap((id) => Array.from({ length: 14 }, (_, i) => `${id}:${i}`)));
  try {
    await act(async () =>
      root.render(
        <I18nProvider forcedLanguage="en">
          <FeatureChartGroups
            groups={ids.map(wide)}
            selectedIds={selected}
            onToggleSeries={() => undefined}
            xRange={[0, 0.3]}
            getPlayheadTime={() => 0}
            subscribePlayheadTime={() => () => undefined}
            onSeekTime={() => undefined}
            resolvedTheme="light"
          />
        </I18nProvider>,
      ),
    );
    const section = (id: string) => host.querySelector<HTMLElement>(`[data-chart-group="${id}"]`)!;
    await waitFor(() => ids.every((id) => section(id).querySelector('canvas') !== null));
    for (const [index, id] of ids.entries()) {
      const box = section(id).getBoundingClientRect();
      const plot = section(id).querySelector('.uplot')!.getBoundingClientRect();
      const chips = section(id).querySelector('[role="group"]')!.getBoundingClientRect();
      // The plot (axes included) stays inside its own group, below its chips.
      expect(plot.bottom, id).toBeLessThanOrEqual(box.bottom + 0.5);
      expect(plot.top, id).toBeGreaterThanOrEqual(chips.bottom - 0.5);
      const next = ids[index + 1];
      if (next) {
        // The next group's chips start below this plot's x-axis.
        const nextChips = section(next).querySelector('[role="group"]')!.getBoundingClientRect();
        expect(nextChips.top, next).toBeGreaterThanOrEqual(plot.bottom - 0.5);
      }
    }
    const list = host.querySelector<HTMLElement>('[data-testid="chart-groups"]')!;
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
