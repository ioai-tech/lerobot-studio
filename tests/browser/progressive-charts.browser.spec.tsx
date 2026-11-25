import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { I18nProvider } from '@/i18n/core';
import {
  FeatureChart,
  type ChartGroupData,
  type FeatureChartProps,
} from '@/components/panels/ChartPanel/FeatureChart';
import type { ChartGroup } from '@/components/panels/ChartPanel/chartGroupsModel';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const x = Float64Array.from([0, 0.1, 0.2, 0.3]);
const group = (id: string, kind: ChartGroup['kind'] = 'feature'): ChartGroup => ({
  id,
  title: id,
  unit: null,
  kind,
  series: [{ id: `${id}:0`, label: 'joint', dimIndex: 0 }],
});
const loaded = (id: string, values = [0, 1, 0, 1]): ChartGroupData => ({
  group: group(id),
  x,
  values: () => Float64Array.from(values),
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

const styleOf: FeatureChartProps['styleOf'] = () => ({ color: '#2563eb' });

async function mount(width: number, height: number) {
  const host = document.createElement('div');
  host.style.cssText = `width:${width}px;height:${height}px`;
  document.body.append(host);
  const root = createRoot(host);
  const render = (groups: ChartGroupData[], selectedIds: ReadonlySet<string>) =>
    act(async () =>
      root.render(
        <I18nProvider forcedLanguage="en">
          <FeatureChart
            groups={groups}
            selectedIds={selectedIds}
            highlightedIds={null}
            styleOf={styleOf}
            xRange={[0, 0.4]}
            frameAt={(time) => Math.round(time * 10)}
            getPlayheadTime={() => 0}
            subscribePlayheadTime={() => () => undefined}
            onSeekTime={() => undefined}
            resolvedTheme="light"
          />
        </I18nProvider>,
      ),
    );
  const unmount = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return { host, render, unmount };
}

/** Hovers the plot at a fraction of its width and returns the tooltip rows' series ids. */
function hover(host: HTMLElement, fraction: number): HTMLElement {
  const over = host.querySelector<HTMLElement>('.u-over')!;
  const rect = over.getBoundingClientRect();
  const init = {
    bubbles: true,
    clientX: rect.left + rect.width * fraction,
    clientY: rect.top + rect.height / 2,
  };
  over.dispatchEvent(new MouseEvent('mouseenter', init));
  over.dispatchEvent(new MouseEvent('mousemove', init));
  return host.querySelector<HTMLElement>('[role="tooltip"]')!;
}

it('draws every feature in one chart; a feature still loading joins it when its columns arrive', async () => {
  const { host, render, unmount } = await mount(800, 400);
  const selected = new Set(['observation.state:0', 'action:0']);
  const chart = () => host.querySelector('[data-testid="feature-chart"]')!;
  try {
    await render(
      [
        loaded('observation.state'),
        { group: group('action'), x, values: () => undefined, pending: true },
      ],
      selected,
    );
    await waitFor(() => host.querySelector('canvas') !== null);
    expect(chart().getAttribute('aria-busy')).toBe('true');
    expect(host.querySelectorAll('.uplot')).toHaveLength(1);
    let tip = hover(host, 0.5);
    expect(tip.hidden).toBe(false);
    expect([...tip.querySelectorAll('[data-series]')].map((el) => el.dataset.series)).toEqual([
      'observation.state:0',
    ]);

    await render([loaded('observation.state'), loaded('action', [5, 6, 7, 8])], selected);
    await waitFor(() => chart().getAttribute('aria-busy') === 'false');
    // Still one chart, now with both series; no per-feature sections or legend.
    expect(host.querySelectorAll('.uplot')).toHaveLength(1);
    expect(host.querySelectorAll('[data-chart-group], button, [role="group"]')).toHaveLength(0);
    tip = hover(host, 0.5);
    // Highest value first, as drawn.
    expect([...tip.querySelectorAll('[data-series]')].map((el) => el.dataset.series)).toEqual([
      'action:0',
      'observation.state:0',
    ]);
  } finally {
    await unmount();
  }
});

it('a short chart panel shows one plot that fits it, with no scrollbar and no legend (s10 F-25)', async () => {
  // A 1024 × 768 layout leaves the chart panel about this small.
  const { host, render, unmount } = await mount(330, 190);
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
  const ids = ['action', 'observation.state', 'observation.velocity'];
  const selected = new Set(ids.flatMap((id) => Array.from({ length: 14 }, (_, i) => `${id}:${i}`)));
  try {
    await render(ids.map(wide), selected);
    await waitFor(() => host.querySelector('canvas') !== null);
    const chart = host.querySelector<HTMLElement>('[data-testid="feature-chart"]')!;
    const plot = chart.querySelector('.uplot')!.getBoundingClientRect();
    const box = chart.getBoundingClientRect();
    expect(host.querySelectorAll('.uplot')).toHaveLength(1);
    expect(plot.top).toBeGreaterThanOrEqual(box.top - 0.5);
    expect(plot.bottom).toBeLessThanOrEqual(box.bottom + 0.5);
    expect(chart.scrollHeight).toBeLessThanOrEqual(chart.clientHeight);
    expect(chart.querySelectorAll('button, [role="group"]')).toHaveLength(0);
    // 42 series in a short chart: the tooltip lists the nearest that fit and
    // counts the rest, and stays inside the chart wherever the pointer is.
    for (const fraction of [0.05, 0.5, 0.95]) {
      const tip = hover(host, fraction);
      const shown = tip.querySelectorAll('[data-series]').length;
      expect(shown).toBeGreaterThanOrEqual(1);
      expect(shown).toBeLessThan(12);
      expect(tip.textContent).toContain(`+ ${42 - shown} more`);
      const rect = tip.getBoundingClientRect();
      expect(rect.top, `top at ${fraction}`).toBeGreaterThanOrEqual(box.top - 0.5);
      expect(rect.bottom, `bottom at ${fraction}`).toBeLessThanOrEqual(box.bottom + 0.5);
      expect(rect.left, `left at ${fraction}`).toBeGreaterThanOrEqual(box.left - 0.5);
      expect(rect.right, `right at ${fraction}`).toBeLessThanOrEqual(box.right + 0.5);
    }
  } finally {
    await unmount();
  }
});

it('joins series on their own clocks and reads tooltip values from their own samples', async () => {
  const { host, render, unmount } = await mount(800, 400);
  const aux: ChartGroupData = {
    group: group('aux:imu', 'auxiliary'),
    x: Float64Array.from([0.05, 0.15, 0.25, 0.35]),
    values: () => Float64Array.from([10, 20, 30, 40]),
  };
  try {
    await render([loaded('action', [1, 2, 3, 4]), aux], new Set(['action:0', 'aux:imu:0']));
    await waitFor(() => host.querySelector('canvas') !== null);
    // At 0.3 s of a 0.4 s axis: action's sample 0.3 (4) and the IMU's nearest, 0.35 (40) or 0.25 (30).
    const tip = hover(host, 0.75);
    const value = (id: string) =>
      tip.querySelector<HTMLElement>(`[data-series="${id}"]`)!.lastElementChild!.textContent;
    expect(value('action:0')).toBe('4.000');
    expect(['30.00', '40.00']).toContain(value('aux:imu:0'));
    expect(tip.textContent).toContain('frame 3');
  } finally {
    await unmount();
  }
});

it('with nothing selected, says to pick series instead of drawing an empty plot', async () => {
  const { host, render, unmount } = await mount(800, 400);
  try {
    await render([loaded('action')], new Set());
    await waitFor(() => host.textContent?.includes('Please select') ?? false);
    expect(host.querySelector('canvas')).toBeNull();
  } finally {
    await unmount();
  }
});
