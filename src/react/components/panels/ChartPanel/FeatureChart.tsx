import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import './uplot-theme.css';
import { computeTooltipPlacement, type TooltipPlacementState } from '@/core';
import { getAxisColors, getCssVarHsl, getLerobotRoot } from '../../../lib/chartTheme';
import {
  decimateMinMax,
  nearestSampleIndex,
  visibleSampleRange,
  type ChartGroup,
  type ChartGroupSeries,
} from './chartGroupsModel';
import { ChartPlotPlaceholder } from './ChartGroupsPlaceholder';
import type { ChartSeriesStyle } from './chartPanelModel';

/** One chart group with its samples (x in seconds from the episode start, ascending). */
export interface ChartGroupData {
  group: ChartGroup;
  x: Float64Array;
  /** Values of one series, aligned with `x`. */
  values: (seriesId: string) => Float64Array | undefined;
  /** Optional warning about the group (for example a missing column). */
  warning?: string | null;
  /** The group's columns are still being read: its series are drawn when they arrive. */
  pending?: boolean;
}

export interface FeatureChartProps {
  groups: ChartGroupData[];
  selectedIds: ReadonlySet<string>;
  /** Series to emphasise (hovered in the filter menu); the others fade. `null`: none. */
  highlightedIds: ReadonlySet<string> | null;
  styleOf: (group: ChartGroup, series: ChartGroupSeries) => ChartSeriesStyle;
  /** Shared x domain, seconds. */
  xRange: [number, number];
  /** Frame index shown at a time, for the tooltip header. */
  frameAt: (time: number) => number;
  /** Current playhead time (seconds) and its subscription. */
  getPlayheadTime: () => number;
  subscribePlayheadTime: (listener: (time: number) => void) => () => void;
  onSeekTime: (time: number) => void;
  resolvedTheme: 'light' | 'dark';
}

/** Smallest plot (axes included). */
const PLOT_MIN_HEIGHT_PX = 64;
/** Rows in the hover tooltip: the series nearest the pointer; the rest are counted. */
const TOOLTIP_MAX_ROWS = 12;
/** Opacity of the series that are not hovered in the filter menu. */
const FADED_ALPHA = 0.15;
/** Tooltip width: at most this, at least the smaller value, preferably at least 180 px. */
const TOOLTIP_MAX_WIDTH_PX = 320;
const TOOLTIP_MIN_WIDTH_PX = 140;
const TOOLTIP_PREFERRED_MIN_WIDTH_PX = 180;

function formatValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

interface DrawnSeries {
  group: ChartGroup;
  series: ChartGroupSeries;
  x: Float64Array;
  values: Float64Array;
  style: ChartSeriesStyle;
}

/** Plain array for uPlot: a gap (NaN, ±Infinity) becomes `null`, which uPlot draws as a gap. */
function withGaps(values: Float64Array): (number | null)[] {
  return Array.from(values, (v) => (Number.isFinite(v) ? v : null));
}

/**
 * Aligned uPlot data for series that may have different sample times (feature
 * columns on the frame times, auxiliary series on their own clocks). Each
 * sample-time table is cut to the visible window and min/max-decimated to the
 * plot width (the drawn envelope equals drawing every sample), then the tables
 * are joined on x. Join-introduced holes are `undefined`, which uPlot connects
 * across; real gaps stay `null`.
 */
function buildPlotData(
  drawn: DrawnSeries[],
  xRange: [number, number],
  width: number,
): uPlot.AlignedData {
  const tables = new Map<Float64Array, number[]>();
  drawn.forEach((item, index) => {
    const list = tables.get(item.x) ?? [];
    list.push(index);
    tables.set(item.x, list);
  });
  const columns = new Array<(number | null | undefined)[]>(drawn.length);
  const built: { x: Float64Array; ys: (number | null)[][]; order: number[] }[] = [];
  for (const [x, order] of tables) {
    const [from, to] = visibleSampleRange(x, xRange[0], xRange[1]);
    const decimated = decimateMinMax(
      x.subarray(from, to),
      order.map((index) => drawn[index]!.values.subarray(from, to)),
      Math.max(1, width),
    );
    built.push({ x: decimated.x, ys: decimated.ys.map(withGaps), order });
  }
  if (built.length === 0) return [[]];
  if (built.length === 1) {
    const [only] = built;
    only!.order.forEach((index, i) => (columns[index] = only!.ys[i]!));
    return [Array.from(only!.x), ...columns] as uPlot.AlignedData;
  }
  const joined = uPlot.join(
    built.map((table) => [Array.from(table.x), ...table.ys] as uPlot.AlignedData),
    built.map((table) => [0, ...table.ys.map(() => 1 as const)]),
  );
  let next = 1;
  for (const table of built) {
    for (const index of table.order) columns[index] = joined[next++] as (number | null)[];
  }
  return [joined[0], ...columns] as uPlot.AlignedData;
}

/**
 * The episode's numeric series in one chart, on the episode's time axis: every
 * feature dimension and auxiliary series selected in the panel's filter menu.
 * No legend; hovering shows the values under the pointer, a click seeks, and
 * the playhead is an overlay moved per frame without repainting the chart.
 */
export function FeatureChart({
  groups,
  selectedIds,
  highlightedIds,
  styleOf,
  xRange,
  frameAt,
  getPlayheadTime,
  subscribePlayheadTime,
  onSeekTime,
  resolvedTheme,
}: FeatureChartProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const plotHostRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef(onSeekTime);
  seekRef.current = onSeekTime;
  const getPlayheadRef = useRef(getPlayheadTime);
  getPlayheadRef.current = getPlayheadTime;
  const frameAtRef = useRef(frameAt);
  frameAtRef.current = frameAt;
  const highlightRef = useRef(highlightedIds);
  highlightRef.current = highlightedIds;
  /** Re-applies `highlightRef` to the current plot; set while a plot exists. */
  const redrawHighlightRef = useRef<(() => void) | null>(null);

  const pending = groups.some((data) => data.pending);
  const anyDrawable = groups.some((data) => !data.pending);

  const drawn = useMemo<DrawnSeries[]>(() => {
    const out: DrawnSeries[] = [];
    for (const data of groups) {
      if (data.pending) continue;
      for (const series of data.group.series) {
        if (!selectedIds.has(series.id)) continue;
        const values = data.values(series.id) ?? new Float64Array(data.x.length).fill(NaN);
        out.push({
          group: data.group,
          series,
          x: data.x,
          values,
          style: styleOf(data.group, series),
        });
      }
    }
    return out;
  }, [groups, selectedIds, styleOf]);

  const warnings = useMemo(
    () =>
      groups
        .filter((data) => data.warning)
        .map((data) => `${data.group.title}: ${data.warning}`)
        .join(' · '),
    [groups],
  );

  useEffect(() => {
    const host = plotHostRef.current;
    if (!host || drawn.length === 0) return;
    const root = getLerobotRoot();
    const { axisStroke, gridStroke, tickStroke } = getAxisColors(root);
    const playheadColor = getCssVarHsl(root, '--destructive', '#ef4444');
    const secondShort = t('units.second.short');

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
      if (!Number.isFinite(x) || x < 0 || x > u.over.clientWidth) {
        line.style.visibility = 'hidden';
      } else {
        line.style.visibility = 'visible';
        line.style.transform = `translateX(${x - 1}px)`;
      }
    };

    // Emphasis: series hovered in the filter menu (the others fade) and the
    // line nearest the pointer (drawn thicker). Hovering only entries that are
    // not drawn fades nothing.
    let focusedIndex = -1;
    const applyHighlight = (u: uPlot) => {
      const hovered = highlightRef.current;
      const highlighted =
        hovered && drawn.some((item) => hovered.has(item.series.id)) ? hovered : null;
      drawn.forEach((item, i) => {
        const series = u.series[i + 1];
        if (!series) return;
        const on = !highlighted || highlighted.has(item.series.id);
        series.alpha = on ? 1 : FADED_ALPHA;
        series.width = (highlighted && on) || i === focusedIndex ? 2 : 1.25;
      });
    };
    const setFocused = (u: uPlot, index: number) => {
      if (index === focusedIndex) return;
      focusedIndex = index;
      applyHighlight(u);
      u.redraw(false);
    };

    // Hover tooltip: the time, the frame, and the values of the series nearest
    // the pointer, read from the full-resolution samples (not the decimated ones).
    // It stays inside the chart: as wide as the wider side of the pointer
    // allows, and with as many rows as the chart's height allows.
    let placement: TooltipPlacementState | null = null;
    let lastCursor: { x: number; y: number } | null = null;
    const hideTooltip = () => {
      const tip = tooltipRef.current;
      if (tip) tip.hidden = true;
      lastCursor = null;
    };
    const showTooltip = (u: uPlot) => {
      const tip = tooltipRef.current;
      const container = hostRef.current;
      const left = u.cursor.left ?? -1;
      const top = u.cursor.top ?? -1;
      if (!tip || !container || left < 0 || top < 0) {
        setFocused(u, -1);
        return hideTooltip();
      }
      const overRect = u.over.getBoundingClientRect();
      const hostRect = container.getBoundingClientRect();
      const cursorX = overRect.left - hostRect.left + left;
      const cursorY = overRect.top - hostRect.top + top;

      const time = u.posToVal(left, 'x');
      const rows = drawn.map((item, index) => {
        const sample = nearestSampleIndex(item.x, time);
        const value = sample >= 0 ? item.values[sample]! : NaN;
        const y = Number.isFinite(value) ? u.valToPos(value, 'y') : Infinity;
        return { item, index, value, distance: Math.abs(y - top) };
      });
      const byDistance = rows
        .slice()
        .sort((a, b) => a.distance - b.distance)
        .slice(0, TOOLTIP_MAX_ROWS);
      const focused = byDistance[0]?.distance !== Infinity ? byDistance[0] : undefined;
      setFocused(u, focused?.index ?? -1);

      const gap = 12;
      const maxWidth = Math.min(
        TOOLTIP_MAX_WIDTH_PX,
        Math.max(TOOLTIP_MIN_WIDTH_PX, Math.max(cursorX, hostRect.width - cursorX) - gap - 4),
      );
      tip.style.maxWidth = `${maxWidth}px`;
      tip.style.minWidth = `${Math.min(TOOLTIP_PREFERRED_MIN_WIDTH_PX, maxWidth)}px`;

      const render = (count: number) => {
        const shown = byDistance.slice(0, count);
        // Top to bottom as drawn: highest value first, gaps last.
        const sortValue = (v: number) => (Number.isFinite(v) ? v : -Infinity);
        shown.sort((a, b) => {
          const av = sortValue(a.value);
          const bv = sortValue(b.value);
          return av === bv ? 0 : av < bv ? 1 : -1;
        });
        tip.replaceChildren();
        const header = document.createElement('div');
        header.className = 'flex items-center justify-between gap-3 px-2 pt-1 pb-0.5 font-mono';
        const timeEl = document.createElement('span');
        timeEl.textContent = `${formatValue(time)} ${secondShort}`;
        const frameEl = document.createElement('span');
        frameEl.className = 'text-muted-foreground';
        frameEl.textContent = `${t('units.frame')} ${frameAtRef.current(time)}`;
        header.append(timeEl, frameEl);
        const list = document.createElement('div');
        list.className = 'flex flex-col px-1 pb-1';
        for (const row of shown) {
          const line = document.createElement('div');
          line.className =
            'flex items-center justify-between gap-3 rounded-sm px-1 leading-[18px]' +
            (row === focused ? ' bg-muted font-semibold' : '');
          line.dataset.series = row.item.series.id;
          const name = document.createElement('span');
          name.className = 'flex min-w-0 items-center gap-1.5';
          const swatch = document.createElement('span');
          swatch.setAttribute('aria-hidden', 'true');
          swatch.style.cssText = `display:inline-block;width:12px;height:0;flex:none;border-top:2px ${row.item.style.dash ? 'dashed' : 'solid'} ${row.item.style.color};`;
          const label = document.createElement('span');
          label.className = 'truncate';
          label.textContent = row.item.series.label;
          const feature = document.createElement('span');
          feature.className = 'min-w-0 shrink truncate font-normal text-muted-foreground';
          feature.textContent = row.item.group.title;
          name.append(swatch, label, feature);
          const value = document.createElement('span');
          value.className = 'shrink-0 font-mono tabular-nums';
          value.textContent = formatValue(row.value);
          line.append(name, value);
          list.append(line);
        }
        tip.append(header, list);
        if (rows.length > shown.length) {
          const more = document.createElement('div');
          more.className = 'px-2 pb-1 text-[10px] leading-3 text-muted-foreground';
          more.textContent = t('chart.tooltip.moreSeries', { count: rows.length - shown.length });
          tip.append(more);
        }
        return list;
      };
      tip.hidden = false;
      const list = render(byDistance.length);
      // Fewer rows when the chart is short: measured, then rendered once more.
      const available = hostRect.height - 8;
      if (tip.offsetHeight > available && byDistance.length > 1) {
        const rowHeight = Math.max(1, list.firstElementChild?.getBoundingClientRect().height ?? 18);
        const others = tip.offsetHeight - byDistance.length * rowHeight;
        // Rendering fewer rows adds the "+ N more" line: leave room for it.
        const moreLine = rows.length > byDistance.length ? 0 : 14;
        const fit = Math.floor((available - others - moreLine) / rowHeight);
        render(Math.max(1, Math.min(byDistance.length - 1, fit)));
      }

      placement = computeTooltipPlacement({
        cursorX,
        cursorY,
        tooltipW: tip.offsetWidth,
        tooltipH: tip.offsetHeight,
        containerW: hostRect.width,
        containerH: hostRect.height,
        edgePadding: 4,
        cursorGapX: gap,
        cursorGapY: gap,
        cursorDx: lastCursor ? cursorX - lastCursor.x : 0,
        cursorDy: lastCursor ? cursorY - lastCursor.y : 0,
        previousPlacement: placement?.placement ?? null,
        switchTolerancePx: 10,
        keepPreviousOnStable: true,
      });
      lastCursor = { x: cursorX, y: cursorY };
      tip.style.transform = `translate(${placement.left}px, ${placement.top}px)`;
    };

    const width = Math.max(50, host.clientWidth);
    const height = Math.max(PLOT_MIN_HEIGHT_PX, host.clientHeight);
    const plot = new uPlot(
      {
        width,
        height,
        legend: { show: false },
        // Fixed x range: no drag-zoom; a click seeks.
        cursor: { y: false, points: { show: false }, drag: { x: false, y: false } },
        padding: [8, 12, 2, 4],
        scales: { x: { time: false, range: () => [xRange[0], xRange[1]] } },
        axes: [
          {
            stroke: axisStroke,
            grid: { stroke: gridStroke, width: 1 },
            ticks: { stroke: tickStroke, width: 1 },
            size: 22,
            values: (_u, ticks) => ticks.map((tick) => `${tick}${secondShort}`),
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
          ...drawn.map((item) => ({
            label: `${item.group.title} ${item.series.label}`,
            stroke: item.style.color,
            dash: item.style.dash,
            width: 1.25,
            points: { show: false },
            spanGaps: false,
          })),
        ],
        hooks: {
          draw: [(u) => placePlayhead(u)],
          setCursor: [(u) => showTooltip(u)],
        },
      },
      buildPlotData(drawn, xRange, width),
      host,
    );
    applyHighlight(plot);
    plot.redraw(false);
    redrawHighlightRef.current = () => {
      applyHighlight(plot);
      plot.redraw(false);
    };

    // Position from the event itself (works for touch and without a prior hover).
    const onClick = (event: MouseEvent) => {
      const left = event.clientX - plot.over.getBoundingClientRect().left;
      if (!Number.isFinite(left) || left < 0 || left > plot.over.clientWidth) return;
      seekRef.current(plot.posToVal(left, 'x'));
    };
    plot.over.addEventListener('click', onClick);
    plot.over.addEventListener('mouseleave', hideTooltip);

    const observer = new ResizeObserver(() => {
      const nextWidth = Math.max(50, host.clientWidth);
      const nextHeight = Math.max(PLOT_MIN_HEIGHT_PX, host.clientHeight);
      if (nextWidth !== plot.width || nextHeight !== plot.height) {
        plot.setSize({ width: nextWidth, height: nextHeight });
        plot.setData(buildPlotData(drawn, xRange, nextWidth), true);
      }
    });
    observer.observe(host);
    const unsubscribe = subscribePlayheadTime(() => placePlayhead(plot));

    return () => {
      unsubscribe();
      observer.disconnect();
      plot.over.removeEventListener('click', onClick);
      plot.over.removeEventListener('mouseleave', hideTooltip);
      hideTooltip();
      redrawHighlightRef.current = null;
      plot.destroy();
    };
  }, [drawn, xRange, resolvedTheme, subscribePlayheadTime, t]);

  // Hovering the filter menu fades the other series without rebuilding the plot.
  useEffect(() => {
    redrawHighlightRef.current?.();
  }, [highlightedIds]);

  return (
    <div
      ref={hostRef}
      className="chart-uplot relative h-full w-full overflow-hidden"
      data-testid="feature-chart"
      // The drawn series, for tests and automation (the plot itself is a canvas).
      data-series={drawn.map((item) => item.series.id).join(' ')}
      aria-busy={pending}
    >
      {!anyDrawable ? (
        <div className="absolute inset-0 flex flex-col">
          <ChartPlotPlaceholder />
        </div>
      ) : drawn.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
          {t('chart.split.emptySelection')}
        </div>
      ) : (
        <div ref={plotHostRef} className="absolute inset-0" />
      )}
      {warnings ? (
        <div
          role="status"
          className="pointer-events-none absolute top-1 right-3 z-10 max-w-[60%] truncate text-[11px] text-amber-600 dark:text-amber-400"
          title={warnings}
        >
          {warnings}
        </div>
      ) : null}
      <div
        ref={tooltipRef}
        role="tooltip"
        hidden
        className="pointer-events-none absolute top-0 left-0 z-20 overflow-hidden rounded-md border bg-background/95 text-[11px] text-foreground shadow-lg backdrop-blur"
      />
    </div>
  );
}
