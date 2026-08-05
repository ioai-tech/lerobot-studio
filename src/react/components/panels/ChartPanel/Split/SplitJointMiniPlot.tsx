import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import '../uplot-theme.css';

import { useLeRobotData, useLeRobotPlayback } from '../../../../contexts/LeRobotContext';
import { useTheme } from '../../../../contexts/ThemeContext';
import { getAxisColors, getCssVarHsl, getLerobotRoot } from '../../../../lib/chartTheme';
import { computeTooltipPlacement, type TooltipPlacementState } from '@/core';
import { ACTION_DASH, findClosestIndexInSortedArray, type ChartDataCore } from '../chartPanelModel';
import { SPLIT_CHART_SYNC_KEY } from '@/core';

/** 与 ChartPanel 一致：双击时把 Y 轴恢复为自动范围；X 由 uPlot 内置 dblclick 恢复 */
const AUTO_SCALE_Y = { min: null, max: null } as unknown as { min: number; max: number };

export type SplitJointMiniPlotProps = {
  jointName: string;
  core: ChartDataCore;
  chartHeight: number;
  selectedSeriesIds: Set<string>;
  showAction: boolean;
  showState: boolean;
  hasAction: boolean;
  hasState: boolean;
  actionLabel: string;
  stateLabel: string;
};

type YSeriesInfo = {
  kind: 'action' | 'state';
  featureKey: string;
};

export const SplitJointMiniPlot = React.memo(function SplitJointMiniPlot({
  jointName,
  core,
  chartHeight,
  selectedSeriesIds,
  showAction,
  showState,
  hasAction,
  hasState,
  actionLabel,
  stateLabel,
}: SplitJointMiniPlotProps) {
  const { t } = useTranslation();
  const { subscribeFrameIndex } = useLeRobotData();
  const { setFrameIndex } = useLeRobotPlayback();
  const { resolvedTheme } = useTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const hoverTooltipRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const currentFrameIndexRef = useRef(0);
  const originalTsRef = useRef<number[]>([]);
  const destructiveStrokeRef = useRef('#ef4444');
  const splitTooltipPlacementRef = useRef<TooltipPlacementState | null>(null);
  const splitTooltipCursorTraceRef = useRef<{ x: number; y: number } | null>(null);
  const splitTooltipRafRef = useRef<number | null>(null);
  const pointerOverThisPlotRef = useRef(false);

  const visibleSeriesForJoint = core.dimensions.filter(
    (dim) =>
      dim.jointName === jointName &&
      selectedSeriesIds.has(dim.id) &&
      core.seriesData[dim.id] != null,
  );

  const hasAnySeries = visibleSeriesForJoint.some(
    (dim) =>
      (dim.kind === 'action' && hasAction && showAction) ||
      (dim.kind === 'state' && hasState && showState),
  );

  useEffect(() => {
    return subscribeFrameIndex((frameIndex) => {
      currentFrameIndexRef.current = frameIndex;
      plotRef.current?.redraw(false, false);
    });
  }, [subscribeFrameIndex]);

  useEffect(() => {
    originalTsRef.current = core.originalTimestamps;
  }, [core.originalTimestamps]);

  useEffect(() => {
    const chartEl = chartRef.current;
    if (!chartEl) return;

    const data: uPlot.AlignedData = [core.simplifiedTimestamps];
    const series: uPlot.Series[] = [{}];
    const ySeriesInfo: YSeriesInfo[] = [];
    const baseColor = core.jointColorMap[jointName] ?? '#94a3b8';

    for (const dim of visibleSeriesForJoint) {
      if (dim.kind === 'action' && !(hasAction && showAction)) continue;
      if (dim.kind === 'state' && !(hasState && showState)) continue;
      const arr = core.seriesData[dim.id];
      if (!arr) continue;

      const isState = dim.kind === 'state';
      data.push(arr);
      ySeriesInfo.push({ kind: dim.kind, featureKey: dim.featureKey });
      series.push({
        label: `${isState ? stateLabel : actionLabel}: ${dim.featureKey}`,
        stroke: baseColor,
        width: isState ? 1.25 : 1.5,
        dash: isState ? [] : ACTION_DASH,
        points: { show: false },
        spanGaps: true,
      });
    }

    const formatHoverY = (v: number | undefined) => {
      if (v === undefined || !Number.isFinite(v)) return '—';
      if (Math.abs(v) >= 1000) return v.toFixed(0);
      if (Math.abs(v) >= 10) return v.toFixed(2);
      return v.toFixed(3);
    };

    const actionAbbr = t('chart.legend.actionAbbr');
    const stateAbbr = t('chart.legend.stateAbbr');

    const destroyPlot = () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };

    if (series.length <= 1) {
      destroyPlot();
      return;
    }

    destroyPlot();

    const themeRoot = getLerobotRoot();
    const { axisStroke, gridStroke, tickStroke } = getAxisColors(themeRoot);
    destructiveStrokeRef.current = getCssVarHsl(themeRoot, '--destructive', '#ef4444');

    const applySplitTooltipContent = (u: uPlot) => {
      const el = hoverTooltipRef.current;
      if (!el) return;
      const idx = u.cursor.idx;
      if (idx == null || idx < 0) {
        el.textContent = '';
        return;
      }
      const lines: string[] = [];
      for (let si = 1; si < u.series.length; si++) {
        const info = ySeriesInfo[si - 1];
        const yArr = u.data[si] as ArrayLike<number> | undefined;
        const raw = yArr?.[idx];
        const yv = raw !== undefined && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
        const abbr = info.kind === 'action' ? actionAbbr : stateAbbr;
        lines.push(`${abbr} ${info.featureKey}: ${formatHoverY(yv)}`);
      }
      el.textContent = lines.join('\n');
    };

    const scheduleSplitHoverTooltip = () => {
      if (splitTooltipRafRef.current != null) return;
      splitTooltipRafRef.current = window.requestAnimationFrame(() => {
        splitTooltipRafRef.current = null;
        const u = plotRef.current;
        const tip = hoverTooltipRef.current;
        const wrap = wrapRef.current;
        if (!u || !tip || !wrap) return;
        if (!pointerOverThisPlotRef.current) {
          tip.classList.add('opacity-0');
          return;
        }
        const idx = u.cursor.idx;
        if (idx == null || idx < 0) {
          tip.classList.add('opacity-0');
          return;
        }
        const over = u.over as HTMLElement;
        const cursorX = (over.offsetLeft || 0) + (u.cursor.left ?? 0);
        const cursorY = (over.offsetTop || 0) + (u.cursor.top ?? 0);
        tip.classList.remove('opacity-0');
        const tw = tip.offsetWidth || 80;
        const th = tip.offsetHeight || 22;
        const cw = wrap.clientWidth;
        const ch = wrap.clientHeight;
        const prev = splitTooltipCursorTraceRef.current;
        const cursorDx = prev ? cursorX - prev.x : 0;
        const cursorDy = prev ? cursorY - prev.y : 0;
        const keepPreviousOnStable = Math.abs(cursorDx) + Math.abs(cursorDy) < 3;
        const placement = computeTooltipPlacement({
          cursorX,
          cursorY,
          tooltipW: tw,
          tooltipH: th,
          containerW: cw,
          containerH: ch,
          edgePadding: 4,
          cursorGapX: 10,
          cursorGapY: 12,
          cursorDx,
          cursorDy,
          previousPlacement: splitTooltipPlacementRef.current?.placement ?? null,
          switchTolerancePx: 10,
          keepPreviousOnStable,
        });
        splitTooltipPlacementRef.current = placement;
        splitTooltipCursorTraceRef.current = { x: cursorX, y: cursorY };
        tip.style.left = `${placement.left}px`;
        tip.style.top = `${placement.top}px`;
      });
    };

    const options: uPlot.Options = {
      width: chartEl.offsetWidth || 600,
      height: chartHeight,
      cursor: {
        sync: { key: SPLIT_CHART_SYNC_KEY },
        drag: { setScale: true },
        points: { show: false },
      },
      series,
      axes: [
        {
          label: '',
          labelSize: 0,
          size: 24,
          space: 36,
          stroke: axisStroke,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: tickStroke, width: 1 },
          font: '10px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial, sans-serif',
          values: (_u, vals) => vals.map((v) => `${v.toFixed(1)}${t('units.second.short')}`),
        },
        {
          stroke: axisStroke,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: tickStroke, width: 1 },
          font: '10px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial, sans-serif',
          values: (_u, vals) => vals.map((v) => (Number.isFinite(v) ? String(Math.round(v)) : '')),
        },
      ],
      scales: {
        y: {
          range: (_u, min, max) => {
            if (
              typeof min !== 'number' ||
              typeof max !== 'number' ||
              !Number.isFinite(min) ||
              !Number.isFinite(max)
            ) {
              return [null, null] as unknown as [number, number];
            }
            const span = max - min;
            const pad = span > 1e-12 ? span * 0.08 : 1;
            return [Math.floor(min - pad), Math.ceil(max + pad)];
          },
        },
      },
      legend: { show: false },
      padding: [4, 8, 4, 8],
      hooks: {
        setCursor: [
          () => {
            if (!pointerOverThisPlotRef.current) return;
            scheduleSplitHoverTooltip();
          },
        ],
        setLegend: [
          (u) => {
            if (!pointerOverThisPlotRef.current) return;
            applySplitTooltipContent(u);
            scheduleSplitHoverTooltip();
          },
        ],
        draw: [
          (u) => {
            const { ctx, bbox } = u;
            const frameIdx = currentFrameIndexRef.current;
            const originalTs = originalTsRef.current;
            if (!originalTs.length) return;
            const safeIdx = Math.max(0, Math.min(frameIdx, originalTs.length - 1));
            const t0 = originalTs[safeIdx];
            if (t0 === undefined) return;
            const x = u.valToPos(t0, 'x', true);
            if (x >= bbox.left && x <= bbox.left + bbox.width) {
              ctx.save();
              ctx.setLineDash([5, 5]);
              ctx.beginPath();
              ctx.strokeStyle = destructiveStrokeRef.current;
              ctx.lineWidth = 2;
              ctx.moveTo(x, bbox.top);
              ctx.lineTo(x, bbox.top + bbox.height);
              ctx.stroke();
              ctx.restore();
            }
          },
        ],
      },
      plugins: [
        (() => {
          let onDblClick: (() => void) | undefined;
          let onPointerEnter: (() => void) | undefined;
          let onPointerLeave: (() => void) | undefined;
          return {
            hooks: {
              init: (u) => {
                onDblClick = () => {
                  u.setScale('y', AUTO_SCALE_Y);
                };
                onPointerEnter = () => {
                  pointerOverThisPlotRef.current = true;
                  applySplitTooltipContent(u);
                  scheduleSplitHoverTooltip();
                };
                onPointerLeave = () => {
                  pointerOverThisPlotRef.current = false;
                  if (splitTooltipRafRef.current != null) {
                    window.cancelAnimationFrame(splitTooltipRafRef.current);
                    splitTooltipRafRef.current = null;
                  }
                  splitTooltipPlacementRef.current = null;
                  splitTooltipCursorTraceRef.current = null;
                  hoverTooltipRef.current?.classList.add('opacity-0');
                };
                u.over.addEventListener('dblclick', onDblClick);
                u.over.addEventListener('mouseenter', onPointerEnter);
                u.over.addEventListener('mouseleave', onPointerLeave);
                u.over.addEventListener('mousedown', (e) => {
                  if (e.button !== 0) return;
                  const left = u.cursor.left;
                  if (left == null) return;
                  const val = u.posToVal(left, 'x');
                  const originalTs = originalTsRef.current;
                  const closestIdx =
                    originalTs.length > 0 ? findClosestIndexInSortedArray(originalTs, val) : 0;
                  setFrameIndex(closestIdx);
                });
              },
              destroy: (u) => {
                if (onDblClick) u.over.removeEventListener('dblclick', onDblClick);
                if (onPointerEnter) u.over.removeEventListener('mouseenter', onPointerEnter);
                if (onPointerLeave) u.over.removeEventListener('mouseleave', onPointerLeave);
              },
            },
          };
        })(),
      ],
    };

    plotRef.current = new uPlot(options, data, chartEl);

    const ro = new ResizeObserver(() => {
      if (plotRef.current && chartEl) {
        plotRef.current.setSize({ width: chartEl.offsetWidth, height: chartHeight });
      }
    });
    ro.observe(chartEl);

    return () => {
      pointerOverThisPlotRef.current = false;
      if (splitTooltipRafRef.current != null) {
        window.cancelAnimationFrame(splitTooltipRafRef.current);
        splitTooltipRafRef.current = null;
      }
      splitTooltipPlacementRef.current = null;
      splitTooltipCursorTraceRef.current = null;
      ro.disconnect();
      destroyPlot();
    };
  }, [
    jointName,
    core,
    chartHeight,
    selectedSeriesIds,
    visibleSeriesForJoint,
    showAction,
    showState,
    hasAction,
    hasState,
    actionLabel,
    stateLabel,
    setFrameIndex,
    t,
    resolvedTheme,
  ]);

  if (!hasAnySeries) {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed border-border/60 bg-muted/20 text-[10px] text-muted-foreground"
        style={{ height: chartHeight }}
      >
        {t('chart.split.noSeriesForJoint')}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height: chartHeight }}>
      <div ref={chartRef} className="chart-uplot h-full w-full" style={{ height: chartHeight }} />
      <div
        ref={hoverTooltipRef}
        className="pointer-events-none absolute z-[5] max-w-[min(100%,280px)] whitespace-pre-line rounded border border-border/50 bg-background/95 px-1.5 py-1 font-mono text-[10px] leading-snug text-foreground shadow-sm opacity-0 transition-opacity duration-75"
        style={{ left: 0, top: 0 }}
        aria-hidden
      />
    </div>
  );
});
