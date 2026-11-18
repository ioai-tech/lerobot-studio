import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import uPlot from 'uplot';
import { cn } from '@/ui';
import {
  getAxisColors,
  getChartPalette,
  getCssVarHsl,
  getLerobotRoot,
} from '../../../lib/chartTheme';
import { decimateMinMax, type ChartGroup } from './chartGroupsModel';

/** One chart group with its samples (x in seconds from the episode start, ascending). */
export interface ChartGroupData {
  group: ChartGroup;
  x: Float64Array;
  /** Values of one series, aligned with `x`. */
  values: (seriesId: string) => Float64Array | undefined;
  /** Optional warning shown in the group header (for example a missing column). */
  warning?: string | null;
}

export interface FeatureChartGroupsProps {
  groups: ChartGroupData[];
  selectedIds: ReadonlySet<string>;
  onToggleSeries: (seriesId: string) => void;
  /** Shared x domain of every group, seconds. */
  xRange: [number, number];
  /** Current playhead time (seconds) and its subscription. */
  getPlayheadTime: () => number;
  subscribePlayheadTime: (listener: (time: number) => void) => () => void;
  onSeekTime: (time: number) => void;
  resolvedTheme: 'light' | 'dark';
}

function formatValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

/**
 * Stacked charts, one per feature group, on one shared time axis. Every
 * group draws all its samples through min/max-per-pixel decimation (the drawn
 * envelope equals drawing every sample), and the playhead is an overlay
 * element moved per frame without repainting the charts.
 */
export function FeatureChartGroups({
  groups,
  selectedIds,
  onToggleSeries,
  xRange,
  getPlayheadTime,
  subscribePlayheadTime,
  onSeekTime,
  resolvedTheme,
}: FeatureChartGroupsProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto" data-testid="chart-groups">
      {groups.map((data) => (
        <FeatureChart
          key={data.group.id}
          data={data}
          selectedIds={selectedIds}
          onToggleSeries={onToggleSeries}
          xRange={xRange}
          getPlayheadTime={getPlayheadTime}
          subscribePlayheadTime={subscribePlayheadTime}
          onSeekTime={onSeekTime}
          resolvedTheme={resolvedTheme}
        />
      ))}
    </div>
  );
}

function FeatureChart({
  data,
  selectedIds,
  onToggleSeries,
  xRange,
  getPlayheadTime,
  subscribePlayheadTime,
  onSeekTime,
  resolvedTheme,
}: Omit<FeatureChartGroupsProps, 'groups'> & { data: ChartGroupData }) {
  const { t } = useTranslation();
  const { group } = data;
  const plotHostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const valueRefs = useRef(new Map<string, HTMLSpanElement>());
  const seekRef = useRef(onSeekTime);
  seekRef.current = onSeekTime;
  const getPlayheadRef = useRef(getPlayheadTime);
  getPlayheadRef.current = getPlayheadTime;

  const palette = useMemo(
    () => getChartPalette(getLerobotRoot()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- palette follows the theme
    [resolvedTheme],
  );
  const colorOf = (index: number) => palette[index % Math.max(1, palette.length)] ?? '#64748b';
  const visible = group.series.filter((series) => selectedIds.has(series.id));
  const visibleKey = visible.map((series) => series.id).join('|');

  useEffect(() => {
    const host = plotHostRef.current;
    if (!host) return;
    const root = getLerobotRoot();
    const { axisStroke, gridStroke, tickStroke } = getAxisColors(root);
    const playheadColor = getCssVarHsl(root, '--destructive', '#ef4444');
    const seriesIndex = new Map(group.series.map((series, index) => [series.id, index]));
    const shown = group.series.filter((series) => visibleKey.split('|').includes(series.id));
    const raw = shown.map((series) => data.values(series.id) ?? new Float64Array(data.x.length));

    const build = (width: number): uPlot.AlignedData => {
      const decimated = decimateMinMax(data.x, raw, Math.max(1, width));
      return [decimated.x, ...decimated.ys] as uPlot.AlignedData;
    };

    const placePlayhead = (u: uPlot) => {
      let line = u.over.querySelector<HTMLDivElement>('[data-chart-playhead]');
      if (!line) {
        line = document.createElement('div');
        line.dataset.chartPlayhead = '';
        line.setAttribute('aria-hidden', 'true');
        line.style.cssText =
          'position:absolute;top:0;bottom:0;left:0;width:0;pointer-events:none;will-change:transform;';
        line.style.borderLeft = `2px dashed ${playheadColor}`;
        u.over.appendChild(line);
      }
      const x = u.valToPos(getPlayheadRef.current(), 'x');
      const width = u.over.clientWidth;
      if (!Number.isFinite(x) || x < 0 || x > width) {
        line.style.visibility = 'hidden';
      } else {
        line.style.visibility = 'visible';
        line.style.transform = `translateX(${x - 1}px)`;
      }
    };

    const width = Math.max(50, host.clientWidth);
    const height = Math.max(60, host.clientHeight);
    const plot = new uPlot(
      {
        width,
        height,
        legend: { show: false },
        // Fixed x range: no drag-zoom; a click seeks.
        cursor: { y: false, points: { show: false }, drag: { x: false, y: false } },
        padding: [6, 8, 2, 4],
        scales: { x: { time: false, range: () => [xRange[0], xRange[1]] } },
        axes: [
          {
            stroke: axisStroke,
            grid: { stroke: gridStroke, width: 1 },
            ticks: { stroke: tickStroke, width: 1 },
            size: 22,
            values: (_u, ticks) => ticks.map((tick) => `${tick}${t('units.second.short')}`),
            font: '10px ui-sans-serif, system-ui, sans-serif',
          },
          {
            stroke: axisStroke,
            grid: { stroke: gridStroke, width: 1 },
            ticks: { stroke: tickStroke, width: 1 },
            size: 48,
            font: '10px ui-sans-serif, system-ui, sans-serif',
          },
        ],
        series: [
          {},
          ...shown.map((series) => ({
            label: series.label,
            stroke: colorOf(seriesIndex.get(series.id) ?? 0),
            width: 1.25,
            points: { show: false },
            spanGaps: false,
          })),
        ],
        hooks: {
          draw: [(u) => placePlayhead(u)],
          setCursor: [
            (u) => {
              const idx = u.cursor.idx;
              shown.forEach((series, i) => {
                const el = valueRefs.current.get(series.id);
                if (!el) return;
                el.textContent =
                  idx == null ? '' : formatValue(u.data[i + 1]?.[idx] as number | undefined);
              });
            },
          ],
        },
      },
      build(width),
      host,
    );
    plotRef.current = plot;

    // Position from the event itself (works for touch and without a prior hover).
    const onClick = (event: MouseEvent) => {
      const left = event.clientX - plot.over.getBoundingClientRect().left;
      if (!Number.isFinite(left) || left < 0 || left > plot.over.clientWidth) return;
      seekRef.current(plot.posToVal(left, 'x'));
    };
    plot.over.addEventListener('click', onClick);

    const observer = new ResizeObserver(() => {
      const nextWidth = Math.max(50, host.clientWidth);
      const nextHeight = Math.max(60, host.clientHeight);
      if (nextWidth !== plot.width || nextHeight !== plot.height) {
        plot.setSize({ width: nextWidth, height: nextHeight });
        plot.setData(build(nextWidth), true);
      }
    });
    observer.observe(host);
    const unsubscribe = subscribePlayheadTime(() => placePlayhead(plot));

    return () => {
      unsubscribe();
      observer.disconnect();
      plot.over.removeEventListener('click', onClick);
      plot.destroy();
      plotRef.current = null;
    };
    // colorOf derives from palette
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, visibleKey, xRange[0], xRange[1], palette, subscribePlayheadTime, t]);

  return (
    <section
      className="flex min-h-[96px] flex-1 flex-col border-b border-border/50 last:border-b-0"
      aria-label={group.title}
      data-chart-group={group.id}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 pt-1">
        <h3 className="text-[11px] font-semibold font-mono text-foreground">
          {group.title}
          {group.unit ? (
            <span className="ml-1 font-normal text-muted-foreground">({group.unit})</span>
          ) : null}
        </h3>
        {data.warning ? (
          <span role="status" className="text-[11px] text-amber-600 dark:text-amber-400">
            {data.warning}
          </span>
        ) : null}
        <div
          className="flex max-h-14 min-w-0 flex-1 flex-wrap gap-1 overflow-y-auto"
          role="group"
          aria-label={t('chart.groups.dimensions', { feature: group.title })}
        >
          {group.series.map((series, index) => {
            const on = selectedIds.has(series.id);
            return (
              <button
                key={series.id}
                type="button"
                aria-pressed={on}
                onClick={() => onToggleSeries(series.id)}
                className={cn(
                  'inline-flex items-center gap-1 rounded border px-1.5 text-[11px] leading-5',
                  on
                    ? 'border-border bg-muted/40 text-foreground'
                    : 'border-transparent text-muted-foreground opacity-60 hover:opacity-100',
                )}
              >
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    background: on ? colorOf(index) : 'transparent',
                    borderColor: colorOf(index),
                    borderWidth: 1,
                  }}
                />
                {series.label}
                <span
                  className="tabular-nums text-muted-foreground"
                  ref={(el) => {
                    if (el) valueRefs.current.set(series.id, el);
                    else valueRefs.current.delete(series.id);
                  }}
                />
              </button>
            );
          })}
        </div>
      </header>
      <div ref={plotHostRef} className="relative min-h-0 flex-1" />
    </section>
  );
}
