import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import './uplot-theme.css';
import {
  useLeRobotPlayback,
  useLeRobotData,
  useLeRobotSelection,
} from '../../../contexts/LeRobotContext';
import { useTheme } from '../../../contexts/ThemeContext';
import { getAxisColors, getCssVarHsl, getLerobotRoot } from '../../../lib/chartTheme';
import { clamp, computeTooltipPlacement, type TooltipPlacementState } from '@/core';
import { Button } from '@/ui';
import { PanelRight } from 'lucide-react';
import { PanelEmptyState, PanelLoadingState } from '../Common/PanelState';
import { ChartJointFilterDropdown } from './ChartJointFilterDropdown';
import { buildFeatureFilterTree, getVisibleJointNamesFromSelected } from '@/core';
import { applyGroupSelection } from '@/core';
import { getChartSeriesKind, getDefaultChartFeatureKeys } from '@/core';
import {
  buildAggregatePreparedData,
  buildJointColorMap,
  collectChartDimensions,
  collectUniqueJointNames,
  computeChartDataCore,
  findClosestIndexInSortedArray,
  type ChartSeriesKind,
} from './chartPanelModel';
import { SplitChartsSheet } from './Split/SplitChartsSheet';

interface ChartPanelProps {
  params?: {
    data?: number[][];
    featureKey?: string;
  };
}

const withAlpha = (color: string, alpha: number): string => {
  const a = Math.max(0, Math.min(1, alpha));
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
  }
  if (color.startsWith('rgb(')) {
    return color.replace(/^rgb\((.+)\)$/, `rgba($1, ${a})`);
  }
  if (color.startsWith('rgba(')) return color;
  if (color.startsWith('hsl(')) {
    const m = color.match(/^hsl\(\s*([0-9.]+)\s*,\s*([0-9.]+%)\s*,\s*([0-9.]+%)\s*\)$/);
    if (m) {
      return `hsla(${m[1]}, ${m[2]}, ${m[3]}, ${a})`;
    }
  }
  if (color.startsWith('hsla(')) return color;
  return color;
};

type FocusedSeriesPoint = {
  seriesIdx: number;
  seriesId: string;
  jointName: string;
  kind: ChartSeriesKind;
  color: string;
  xVal: number;
  yVal: number;
  distance: number;
};

type TooltipSeriesStructure = {
  id: string;
  label: string;
  color: string;
  order: number;
  kind: ChartSeriesKind;
};

type TooltipSeriesRowRefs = {
  rowEl: HTMLDivElement;
  valueEl: HTMLSpanElement;
};

type TooltipDomRefs = {
  headerContainerEl: HTMLDivElement;
  headerTimeValueEl: HTMLSpanElement;
  headerFrameValueEl: HTMLSpanElement;
  listContainerEl: HTMLDivElement;
  footerEl?: HTMLDivElement;
  jointRows: Map<string, TooltipSeriesRowRefs>;
  visibleSeriesOrder: string[];
  renderedSeriesCount: number;
};

/** uPlot 类型声明为 number，运行时可用 null 恢复 auto scale */
const AUTO_SCALE_LIMITS = { min: null, max: null } as unknown as { min: number; max: number };

/** 将 wheel delta 归一到约像素级，避免 DOM_DELTA_LINE 下过慢/过快 */
const normalizeWheelDeltaY = (e: WheelEvent): number => {
  let d = e.deltaY;
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) d *= 16;
  else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) d *= 400;
  return d;
};

function zoomYAxisFromWheel(u: uPlot, deltaY: number, pointerCssY: number): boolean {
  const sc = u.scales.y;
  const min0 = sc.min;
  const max0 = sc.max;
  if (
    typeof min0 !== 'number' ||
    typeof max0 !== 'number' ||
    !Number.isFinite(min0) ||
    !Number.isFinite(max0)
  ) {
    return false;
  }
  const span0 = max0 - min0;
  if (!Number.isFinite(span0) || span0 <= 0) return false;

  const factor = Math.exp(-deltaY * 0.0011);
  const minRelSpan = Math.max(1e-12, span0 * 1e-7);
  const maxRelSpan = Math.abs(span0) * 1e6 + 1;
  const span1 = clamp(span0 * factor, minRelSpan, maxRelSpan);

  const anchor = u.posToVal(pointerCssY, 'y');
  if (!Number.isFinite(anchor)) return false;
  const t = span0 > 0 ? (anchor - min0) / span0 : 0.5;
  const tt = clamp(t, 0, 1);
  let nextMin = anchor - tt * span1;
  let nextMax = anchor + (1 - tt) * span1;
  if (nextMin > nextMax) {
    const s = nextMin;
    nextMin = nextMax;
    nextMax = s;
  }
  u.setScale('y', { min: nextMin, max: nextMax });
  return true;
}

const ChartPanelContent: React.FC<ChartPanelProps> = ({ params }) => {
  const { t, i18n } = useTranslation();
  // 使用分离的 context，避免订阅图像/帧状态触发不必要的重渲染
  const { chartData, currentFrames, setFrameIndex, setPlaying } = useLeRobotPlayback();
  const { subscribeFrameIndex, info, isLoading } = useLeRobotData();
  const { selectedEpisodeIndex } = useLeRobotSelection();
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const isTooltipHoverRef = useRef(false);
  const tooltipHideDelayRef = useRef<number | null>(null);
  const tooltipRafIdRef = useRef<number | null>(null);
  const tooltipPendingRef = useRef<{
    u: uPlot;
    idx: number;
    xVal: number;
    frameIdx: number;
    cursorX: number;
    cursorY: number;
    containerW: number;
    containerH: number;
  } | null>(null);
  const tooltipLastIdxRef = useRef<number | null>(null);
  const tooltipLastFocusKeyRef = useRef<string | null>(null);
  const tooltipLastSizeRef = useRef<{ w: number; h: number } | null>(null);
  const tooltipPlacementRef = useRef<TooltipPlacementState | null>(null);
  const tooltipCursorTraceRef = useRef<{ x: number; y: number } | null>(null);
  const tooltipDomRefsRef = useRef<TooltipDomRefs | null>(null);
  const tooltipPinnedRef = useRef(false);
  const tooltipPinnedPendingRef = useRef<{
    u: uPlot;
    idx: number;
    xVal: number;
    frameIdx: number;
    cursorX: number;
    cursorY: number;
    containerW: number;
    containerH: number;
  } | null>(null);
  const tooltipManualScrollLockRef = useRef(false);
  const tooltipAutoScrollingRef = useRef(false);
  const hoveredSeriesIdsRef = useRef<Set<string> | null>(null);
  const focusedSeriesRef = useRef<FocusedSeriesPoint | null>(null);
  const focusedSeriesCacheRef = useRef<{
    idx: number;
    cursorY: number;
    focused: FocusedSeriesPoint | null;
  } | null>(null);

  // Track theme to force uPlot recreation on change
  const lastThemeRef = useRef(resolvedTheme);
  const destructiveStrokeRef = useRef('#ef4444');

  // 使用ref存储当前帧索引（用于draw hook，避免React渲染）
  const currentFrameIndexRef = useRef(0);
  // 存储“帧索引 -> 时间戳”的权威数组：优先用 currentFrames（与播放器同源），避免 chartData 流式长度不一致造成错位
  const originalTimestampsRef = useRef<number[]>([]);

  /** 换 Episode 后下一次 setData 使用 resetScales，避免沿用上一段的 Y 缩放 */
  const lastChartEpisodeRef = useRef<number | null | undefined>(undefined);
  const chartScaleResetPendingRef = useRef(false);

  const [selectedSeriesIds, setSelectedSeriesIds] = useState<Set<string>>(new Set());
  const [jointSearch, setJointSearch] = useState('');
  const [showAction, setShowAction] = useState(true);
  const [showState, setShowState] = useState(true);
  const [splitSheetOpen, setSplitSheetOpen] = useState(false);

  // 默认显示所有数值特征，兼容 observation.xxx / action.xxx 的分散字段格式。
  const targetFeatures = useMemo(() => {
    return getDefaultChartFeatureKeys(info, params?.featureKey);
  }, [info, params?.featureKey]);

  // Detect available data sources
  const hasAction = useMemo(() => {
    return targetFeatures.some(
      (featureKey) => getChartSeriesKind(featureKey) === 'action' && chartData[featureKey] != null,
    );
  }, [targetFeatures, chartData]);

  const hasState = useMemo(() => {
    return targetFeatures.some(
      (featureKey) => getChartSeriesKind(featureKey) === 'state' && chartData[featureKey] != null,
    );
  }, [targetFeatures, chartData]);

  const chartDimensions = useMemo(
    () => collectChartDimensions(targetFeatures, info?.features, chartData),
    [targetFeatures, info?.features, chartData],
  );

  const allJointNames = useMemo(() => collectUniqueJointNames(chartDimensions), [chartDimensions]);

  const allSeriesIds = useMemo(() => chartDimensions.map((d) => d.id), [chartDimensions]);

  const chartCore = useMemo(
    () =>
      computeChartDataCore({
        chartData,
        currentFrames,
        targetFeatures,
        features: info?.features,
        resolvedTheme,
      }),
    [chartData, currentFrames, targetFeatures, info?.features, resolvedTheme],
  );

  const fallbackJointColorMap = useMemo(
    () => buildJointColorMap(allJointNames, resolvedTheme),
    [allJointNames, resolvedTheme],
  );
  const jointColorMap = chartCore?.jointColorMap ?? fallbackJointColorMap;

  // 仅在没有“用户主动清空”时做默认全选；用户点击清空后不再自动填回
  const userClearedJointsRef = useRef(false);
  useEffect(() => {
    userClearedJointsRef.current = false;
  }, [allSeriesIds]);
  useEffect(() => {
    if (selectedSeriesIds.size === 0 && allSeriesIds.length > 0 && !userClearedJointsRef.current) {
      setSelectedSeriesIds(new Set(allSeriesIds));
    }
  }, [allSeriesIds, selectedSeriesIds.size]);

  const getSeriesStrokeColor = useCallback((seriesId: string, baseColor: string) => {
    const hovered = hoveredSeriesIdsRef.current;
    if (!hovered || hovered.size === 0) return baseColor;
    return hovered.has(seriesId) ? baseColor : withAlpha(baseColor, 0.22);
  }, []);

  const preparedData = useMemo(() => {
    if (!chartCore) return null;

    return buildAggregatePreparedData(chartCore, {
      selectedSeriesIds,
      showAction,
      showState,
      getStrokeColor: getSeriesStrokeColor,
      stateLabel: t('chart.series.state'),
      actionLabel: t('chart.series.action'),
    });
  }, [chartCore, selectedSeriesIds, showAction, showState, getSeriesStrokeColor, t]);

  useEffect(() => {
    if (!chartCore && splitSheetOpen) setSplitSheetOpen(false);
  }, [chartCore, splitSheetOpen]);

  // 高性能帧同步：使用订阅API更新图表光标位置（无React渲染！）
  useEffect(() => {
    const unsubscribe = subscribeFrameIndex((frameIndex) => {
      currentFrameIndexRef.current = frameIndex;
      // 只重绘 "now" 线：跳过路径重建（rebuildPaths=false）减少 CPU 开销
      if (plotRef.current) {
        plotRef.current.redraw(false, false);
      }
    });

    return unsubscribe;
  }, [subscribeFrameIndex]);

  // Tooltip formatter (keep it lightweight; no React re-render during mouse move)
  const formatNumber = (v: number) => {
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(2);
    return v.toFixed(4);
  };

  useEffect(() => {
    originalTimestampsRef.current = preparedData?.originalTimestamps ?? [];
  }, [preparedData]);

  useEffect(() => {
    const prev = lastChartEpisodeRef.current;
    if (prev !== selectedEpisodeIndex) {
      if (prev !== undefined) {
        chartScaleResetPendingRef.current = true;
      }
      lastChartEpisodeRef.current = selectedEpisodeIndex;
    }
  }, [selectedEpisodeIndex]);

  useEffect(() => {
    if (!chartRef.current || !preparedData) {
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
      }
      if (tooltipRef.current) {
        tooltipRef.current.classList.add('hidden');
      }
      tooltipDomRefsRef.current = null;
      tooltipPinnedRef.current = false;
      tooltipPinnedPendingRef.current = null;
      tooltipManualScrollLockRef.current = false;
      return;
    }

    // Tooltip hover/freeze handlers (attach per effect run; element is stable)
    const tipEl = tooltipRef.current;

    // 清除隐藏延迟的辅助函数
    const clearHideDelay = () => {
      if (tooltipHideDelayRef.current != null) {
        window.clearTimeout(tooltipHideDelayRef.current);
        tooltipHideDelayRef.current = null;
      }
    };

    const onTipEnter = () => {
      clearHideDelay();
      isTooltipHoverRef.current = true;
    };
    const onTipLeave = (e: MouseEvent) => {
      isTooltipHoverRef.current = false;
      if (tooltipPinnedRef.current) return;
      // If we didn't go back into the plot overlay, schedule hide
      const next = e.relatedTarget as Node | null;
      if (next && plotRef.current?.over && plotRef.current.over.contains(next)) {
        // 鼠标从 tooltip 移回图表，立即允许更新
        return;
      }
      // 延迟隐藏，避免鼠标快速移动导致闪烁
      clearHideDelay();
      tooltipHideDelayRef.current = window.setTimeout(() => {
        if (!tooltipPinnedRef.current && !isTooltipHoverRef.current && tipEl) {
          tipEl.classList.add('hidden');
        }
        tooltipHideDelayRef.current = null;
      }, 300);
    };
    tipEl?.addEventListener('mouseenter', onTipEnter);
    tipEl?.addEventListener('mouseleave', onTipLeave);

    const themeRoot = getLerobotRoot();
    const hslVar = (name: string, fallback: string) => getCssVarHsl(themeRoot, name, fallback);
    const { axisStroke, gridStroke, tickStroke } = getAxisColors(themeRoot);
    destructiveStrokeRef.current = hslVar('--destructive', '#ef4444');

    // Check if we need to recreate uPlot (theme changed)
    if (plotRef.current && lastThemeRef.current !== resolvedTheme) {
      plotRef.current.destroy();
      plotRef.current = null;
      lastThemeRef.current = resolvedTheme;
    }

    const secondShort = t('units.second.short');
    const frameLabel = t('units.frame');
    const timeLabel = t('chart.tooltip.time');
    const nearestPixelThreshold = 12;
    const switchPixelHysteresis = 2;

    const pickNearestSeries = (
      pu: uPlot,
      pointIdx: number,
      cursorY: number,
    ): FocusedSeriesPoint | null => {
      const cached = focusedSeriesCacheRef.current;
      if (cached && cached.idx === pointIdx && Math.abs(cached.cursorY - cursorY) < 1.5) {
        return cached.focused;
      }

      let best: FocusedSeriesPoint | null = null;
      for (let si = 1; si < pu.series.length; si++) {
        const meta = preparedData.seriesMeta[si];
        if (!meta) continue;
        const yData = pu.data[si] as number[] | Float64Array | undefined;
        const yVal = Number(yData?.[pointIdx]);
        if (!Number.isFinite(yVal)) continue;
        const yPx = pu.valToPos(yVal, 'y');
        if (!Number.isFinite(yPx)) continue;
        const distance = Math.abs(yPx - cursorY);

        if (!best || distance < best.distance) {
          best = {
            seriesIdx: si,
            seriesId: meta.id,
            jointName: meta.jointName,
            kind: meta.kind,
            color: meta.color,
            xVal: Number((pu.data[0] as number[] | Float64Array)?.[pointIdx] ?? 0),
            yVal,
            distance,
          };
        }
      }

      if (best && best.distance > nearestPixelThreshold) {
        best = null;
      }

      const previous = focusedSeriesRef.current;
      if (previous && best && previous.seriesIdx !== best.seriesIdx) {
        const prevData = pu.data[previous.seriesIdx] as number[] | Float64Array | undefined;
        const prevYVal = Number(prevData?.[pointIdx]);
        if (Number.isFinite(prevYVal)) {
          const prevYPx = pu.valToPos(prevYVal, 'y');
          if (Number.isFinite(prevYPx)) {
            const prevDistance = Math.abs(prevYPx - cursorY);
            if (
              prevDistance <= nearestPixelThreshold &&
              prevDistance <= best.distance + switchPixelHysteresis
            ) {
              best = {
                ...previous,
                xVal: Number((pu.data[0] as number[] | Float64Array)?.[pointIdx] ?? previous.xVal),
                yVal: prevYVal,
                distance: prevDistance,
              };
            }
          }
        }
      }

      focusedSeriesCacheRef.current = {
        idx: pointIdx,
        cursorY,
        focused: best,
      };

      return best;
    };

    const clearTooltipRuntime = () => {
      tooltipPendingRef.current = null;
      tooltipPinnedPendingRef.current = null;
      tooltipLastIdxRef.current = null;
      tooltipLastFocusKeyRef.current = null;
      focusedSeriesRef.current = null;
      focusedSeriesCacheRef.current = null;
      tooltipPlacementRef.current = null;
      tooltipCursorTraceRef.current = null;
      tooltipManualScrollLockRef.current = false;
    };

    const applySeriesHighlight = (seriesId: string | null) => {
      const dom = tooltipDomRefsRef.current;
      if (!dom) return;
      const previous = tooltipLastFocusKeyRef.current;
      if (previous) {
        const prevRow = dom.jointRows.get(previous);
        if (prevRow) {
          prevRow.rowEl.classList.remove(
            'rounded',
            'bg-primary/10',
            'ring-1',
            'ring-primary/20',
            'px-1',
          );
        }
      }
      if (seriesId) {
        const nextRow = dom.jointRows.get(seriesId);
        if (nextRow) {
          nextRow.rowEl.classList.add(
            'rounded',
            'bg-primary/10',
            'ring-1',
            'ring-primary/20',
            'px-1',
          );
        }
      }
      tooltipLastFocusKeyRef.current = seriesId;
    };

    const collectSeriesStructures = (): TooltipSeriesStructure[] => {
      const structures: TooltipSeriesStructure[] = [];
      for (let si = 1; si < preparedData.seriesMeta.length; si++) {
        const meta = preparedData.seriesMeta[si];
        if (!meta) continue;
        structures.push({
          id: meta.id,
          label: `${meta.featureKey} / ${meta.jointName}`,
          color: meta.color,
          order: si,
          kind: meta.kind,
        });
      }
      return structures;
    };

    const buildTooltipDomSkeleton = () => {
      if (!tipEl) return;
      const structures = collectSeriesStructures();
      const maxVisibleSeries = 80;
      const visible = structures.slice(0, maxVisibleSeries);

      const root = document.createElement('div');
      root.className = 'flex h-full flex-col gap-1';

      const headerContainer = document.createElement('div');
      headerContainer.className =
        'shrink-0 flex flex-col justify-center gap-1 px-2 border-b border-border/40';
      headerContainer.style.height = '48px';
      headerContainer.style.minHeight = '48px';

      const timeRow = document.createElement('div');
      timeRow.className = 'flex items-center justify-between gap-2 leading-tight';
      const timeLabelEl = document.createElement('div');
      timeLabelEl.className = 'font-semibold text-foreground';
      timeLabelEl.textContent = timeLabel;
      const timeValueEl = document.createElement('span');
      timeValueEl.className = 'font-mono text-muted-foreground';
      timeValueEl.textContent = '—';
      timeRow.append(timeLabelEl, timeValueEl);

      const frameRow = document.createElement('div');
      frameRow.className = 'flex items-center justify-between gap-2 leading-tight';
      const frameLabelEl = document.createElement('div');
      frameLabelEl.className = 'font-semibold text-foreground';
      frameLabelEl.textContent = frameLabel;
      const frameValueEl = document.createElement('span');
      frameValueEl.className = 'font-mono text-muted-foreground';
      frameValueEl.textContent = '—';
      frameRow.append(frameLabelEl, frameValueEl);
      headerContainer.append(timeRow, frameRow);

      const listContainer = document.createElement('div');
      listContainer.className = 'mt-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-2';
      const onListScroll = () => {
        if (!tooltipPinnedRef.current) return;
        if (tooltipAutoScrollingRef.current) return;
        tooltipManualScrollLockRef.current = true;
      };
      listContainer.addEventListener('scroll', onListScroll);

      const jointRows = new Map<string, TooltipSeriesRowRefs>();
      let renderedSeriesCount = 0;
      for (const item of visible) {
        const row = document.createElement('div');
        row.className =
          'flex items-center justify-between gap-2 py-1 border-t border-dashed border-border/40 first:border-0 first:pt-0';
        row.dataset.series = item.id;
        const left = document.createElement('div');
        left.className = 'flex items-center gap-2 min-w-0';
        const kindAbbr = document.createElement('span');
        kindAbbr.className = 'shrink-0 text-[10px] text-muted-foreground';
        kindAbbr.textContent =
          item.kind === 'action' ? t('chart.legend.actionAbbr') : t('chart.legend.stateAbbr');
        const nameEl = document.createElement('span');
        nameEl.className = 'truncate font-semibold text-[11px]';
        nameEl.textContent = item.label;
        nameEl.style.color = item.color;
        left.append(kindAbbr, nameEl);
        const valueEl = document.createElement('span');
        valueEl.className = 'font-mono font-semibold shrink-0';
        valueEl.style.color = item.color;
        valueEl.textContent = '—';
        row.append(left, valueEl);
        listContainer.append(row);
        jointRows.set(item.id, { rowEl: row, valueEl });
        renderedSeriesCount += 1;
      }

      root.append(headerContainer, listContainer);

      const totalSeries = preparedData.seriesMeta.length - 1;
      let footerEl: HTMLDivElement | undefined;
      if (totalSeries > renderedSeriesCount) {
        footerEl = document.createElement('div');
        footerEl.className = 'py-1 px-2 shrink-0 text-[10px] text-muted-foreground';
        footerEl.textContent = t('chart.tooltip.moreSeries', {
          count: totalSeries - renderedSeriesCount,
        });
        root.append(footerEl);
      }

      tipEl.innerHTML = '';
      tipEl.append(root);

      tooltipDomRefsRef.current = {
        headerContainerEl: headerContainer,
        headerTimeValueEl: timeValueEl,
        headerFrameValueEl: frameValueEl,
        listContainerEl: listContainer,
        footerEl,
        jointRows,
        visibleSeriesOrder: visible.map((item) => item.id),
        renderedSeriesCount,
      };

      listContainer.dataset.scrollBound = 'true';
      tooltipLastIdxRef.current = null;
      tooltipLastFocusKeyRef.current = null;
    };

    const updateTooltipContent = (
      pu: uPlot,
      pointIdx: number,
      xVal: number,
      frameIdx: number,
      focused: FocusedSeriesPoint | null,
    ) => {
      const dom = tooltipDomRefsRef.current;
      if (!dom) return;

      dom.headerTimeValueEl.textContent = `${formatNumber(xVal)} ${secondShort}`;
      dom.headerFrameValueEl.textContent = String(frameIdx);

      for (const row of dom.jointRows.values()) {
        row.valueEl.textContent = '—';
      }

      for (let si = 1; si < pu.series.length; si++) {
        const meta = preparedData.seriesMeta[si];
        if (!meta) continue;
        const row = dom.jointRows.get(meta.id);
        if (!row) continue;
        const yArr = pu.data[si] as number[] | Float64Array | undefined;
        const yVal = Number(yArr?.[pointIdx]);
        row.valueEl.textContent = formatNumber(yVal);
      }

      const focusedSeriesId =
        focused?.seriesId && dom.jointRows.has(focused.seriesId) ? focused.seriesId : null;
      const previousFocused = tooltipLastFocusKeyRef.current;
      if (focusedSeriesId !== previousFocused) {
        applySeriesHighlight(focusedSeriesId);
        if (focusedSeriesId && (!tooltipPinnedRef.current || !tooltipManualScrollLockRef.current)) {
          const row = dom.jointRows.get(focusedSeriesId);
          if (row) {
            tooltipAutoScrollingRef.current = true;
            const listEl = dom.listContainerEl;
            const alignOffset = 3;
            const rowTopInList =
              row.rowEl.getBoundingClientRect().top -
              listEl.getBoundingClientRect().top +
              listEl.scrollTop;
            const targetTop = rowTopInList - alignOffset;
            const maxScrollTop = Math.max(0, listEl.scrollHeight - listEl.clientHeight);
            listEl.scrollTop = clamp(targetTop, 0, maxScrollTop);
            window.requestAnimationFrame(() => {
              tooltipAutoScrollingRef.current = false;
            });
          }
        }
      }
    };

    const scheduleTooltipRender = () => {
      if (tooltipRafIdRef.current != null) return;
      tooltipRafIdRef.current = window.requestAnimationFrame(() => {
        tooltipRafIdRef.current = null;
        const pending = tooltipPendingRef.current;
        const tipNode = tooltipRef.current;
        if (!pending || !tipNode) return;
        if (isTooltipHoverRef.current && !tooltipPinnedRef.current) return;

        const {
          u: pu,
          idx: pIdx,
          xVal: pXVal,
          frameIdx: pFrameIdx,
          cursorX: pCursorX,
          cursorY: pCursorY,
          containerW: pW,
          containerH: pH,
        } = pending;

        const focused = pickNearestSeries(pu, pIdx, pCursorY);
        const previousFocus = focusedSeriesRef.current;
        const focusChanged =
          (previousFocus?.seriesIdx ?? null) !== (focused?.seriesIdx ?? null) ||
          (previousFocus?.seriesId ?? '') !== (focused?.seriesId ?? '');
        focusedSeriesRef.current = focused;
        if (focusChanged) plotRef.current?.redraw(false, false);

        if (!tooltipDomRefsRef.current) {
          buildTooltipDomSkeleton();
        }
        if (!tooltipDomRefsRef.current) return;

        const needContentUpdate =
          tooltipLastIdxRef.current !== pIdx ||
          tooltipLastFocusKeyRef.current !== (focused?.seriesId ?? null);
        if (needContentUpdate) {
          updateTooltipContent(pu, pIdx, pXVal, pFrameIdx, focused);
          tooltipLastIdxRef.current = pIdx;
        }

        const maxHeight = Math.min(Math.floor(pH * 0.8), 320);
        tipNode.style.maxHeight = `${maxHeight}px`;
        tipNode.style.overflow = 'hidden';
        const dom = tooltipDomRefsRef.current;
        if (dom) {
          const headerHeight = 60;
          const footerHeight = dom.footerEl?.offsetHeight ?? 0;
          const listGapCompensation = 4;
          const listMaxHeight = Math.max(
            64,
            maxHeight - headerHeight - footerHeight - listGapCompensation,
          );
          dom.listContainerEl.style.maxHeight = `${listMaxHeight}px`;
          dom.listContainerEl.style.overflowY = 'auto';
        }
        tipNode.classList.remove('hidden');

        const size = {
          w: tipNode.offsetWidth || 220,
          h: Math.min(maxHeight, tipNode.offsetHeight || 140),
        };
        tooltipLastSizeRef.current = size;

        if (!tooltipPinnedRef.current || !tooltipPlacementRef.current) {
          const prevCursor = tooltipCursorTraceRef.current;
          const cursorDx = prevCursor ? pCursorX - prevCursor.x : 0;
          const cursorDy = prevCursor ? pCursorY - prevCursor.y : 0;
          const keepPreviousOnStable = Math.abs(cursorDx) + Math.abs(cursorDy) < 3;
          const placement = computeTooltipPlacement({
            cursorX: pCursorX,
            cursorY: pCursorY,
            tooltipW: size.w,
            tooltipH: size.h,
            containerW: pW,
            containerH: pH,
            edgePadding: 6,
            cursorGapX: 14,
            cursorGapY: 16,
            cursorDx,
            cursorDy,
            previousPlacement: tooltipPlacementRef.current?.placement ?? null,
            switchTolerancePx: 12,
            keepPreviousOnStable,
          });
          tooltipPlacementRef.current = placement;
          tooltipCursorTraceRef.current = { x: pCursorX, y: pCursorY };
          tipNode.style.left = `${placement.left}px`;
          tipNode.style.top = `${placement.top}px`;
        }
      });
    };

    tooltipDomRefsRef.current = null;
    buildTooltipDomSkeleton();

    let wheelRafId: number | null = null;
    let wheelPendingDy = 0;
    let wheelAnchorY = 0;

    const flushWheelYZoom = () => {
      wheelRafId = null;
      const dy = wheelPendingDy;
      wheelPendingDy = 0;
      if (dy === 0) return;
      const p = plotRef.current;
      if (!p) return;
      zoomYAxisFromWheel(p, dy, wheelAnchorY);
    };

    const onPlotWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      if (!plotRef.current) return;
      wheelPendingDy += normalizeWheelDeltaY(e);
      wheelAnchorY = e.offsetY;
      e.preventDefault();
      if (wheelRafId != null) return;
      wheelRafId = window.requestAnimationFrame(flushWheelYZoom);
    };

    /** uPlot 内置 dblclick 已 autoScaleX；此处只恢复 Y，与「双击还原视图」一致 */
    const onPlotDblClick = () => {
      const p = plotRef.current;
      if (!p) return;
      p.setScale('y', AUTO_SCALE_LIMITS);
    };

    const options: uPlot.Options = {
      width: chartRef.current.offsetWidth || 800,
      height: chartRef.current.offsetHeight || 400,
      cursor: {
        sync: { key: 'lerobot' },
        drag: { setScale: true },
        points: { show: false },
      },
      series: preparedData.configs,
      axes: [
        {
          // 去掉 “Time(s)” 标签，并压缩 X 轴高度，让图表更紧凑
          label: '',
          labelSize: 0,
          size: 28,
          space: 42,
          stroke: axisStroke,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: tickStroke, width: 1 },
          font: '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial, sans-serif',
          values: (_u, vals) => vals.map((v) => v.toFixed(1) + 's'),
        },
        {
          stroke: axisStroke,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: tickStroke, width: 1 },
          font: '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial, sans-serif',
        },
      ],
      legend: {
        show: false,
      },
      padding: [8, 10, 8, 10],
      hooks: {
        setCursor: [
          (u) => {
            const tip = tooltipRef.current;
            if (!tip) return;

            // Hover-freeze: allow selecting text in tooltip without it jumping.
            if (isTooltipHoverRef.current) return;

            // 清除任何待定的隐藏延迟（因为有新的光标数据）
            if (tooltipHideDelayRef.current != null) {
              window.clearTimeout(tooltipHideDelayRef.current);
              tooltipHideDelayRef.current = null;
            }

            const idx = u.cursor.idx;
            if (idx == null || idx < 0) {
              if (tooltipPinnedRef.current) return;
              // 鼠标移出图表，延迟隐藏给用户时间移到 tooltip 上
              tooltipHideDelayRef.current = window.setTimeout(() => {
                if (!tooltipPinnedRef.current && !isTooltipHoverRef.current && tip) {
                  tip.classList.add('hidden');
                  clearTooltipRuntime();
                  plotRef.current?.redraw(false, false);
                }
                tooltipHideDelayRef.current = null;
              }, 300);
              return;
            }

            const xArr = u.data[0] as number[];
            const xVal = xArr?.[idx];
            if (xVal == null) {
              if (tooltipPinnedRef.current) return;
              // 无效数据，延迟隐藏
              tooltipHideDelayRef.current = window.setTimeout(() => {
                if (!tooltipPinnedRef.current && !isTooltipHoverRef.current && tip) {
                  tip.classList.add('hidden');
                  clearTooltipRuntime();
                  plotRef.current?.redraw(false, false);
                }
                tooltipHideDelayRef.current = null;
              }, 300);
              return;
            }

            if (tooltipPinnedRef.current) return;

            // map to original frame index (important when data is simplified)
            const originalTs = originalTimestampsRef.current;
            const frameIdx =
              originalTs.length > 0 ? findClosestIndexInSortedArray(originalTs, xVal) : idx;

            // NOTE: u.cursor.left/top are relative to u.over (the plot overlay, usually excluding axes).
            // Tooltip is positioned relative to chart container, so we must add u.over offsets.
            const over = u.over as HTMLElement;
            const overOffL = over.offsetLeft || 0;
            const overOffT = over.offsetTop || 0;

            const cursorLeft = u.cursor.left ?? 0;
            const cursorTop = u.cursor.top ?? 0;
            const cursorX = overOffL + cursorLeft;
            const cursorY = overOffT + cursorTop;

            // Clamp within chart container (not u.over), since tooltip is a sibling of chartRef.
            const containerW = chartRef.current?.clientWidth ?? over.clientWidth;
            const containerH = chartRef.current?.clientHeight ?? over.clientHeight;

            // Performance: batch updates to once per animation frame.
            tooltipPendingRef.current = {
              u,
              idx,
              xVal,
              frameIdx,
              cursorX,
              cursorY,
              containerW,
              containerH,
            };
            scheduleTooltipRender();
          },
        ],
        draw: [
          (u) => {
            // Draw "now" line using ref (避免闭包问题)
            const { ctx, bbox } = u;
            const frameIdx = currentFrameIndexRef.current;

            // 从根本修复：定位线直接使用“权威时间戳（与播放器同源）”，再用 u.valToPos 映射到当前图表 X 轴
            const originalTs = originalTimestampsRef.current;
            if (!originalTs || originalTs.length === 0) return;
            const safeIdx = Math.max(0, Math.min(frameIdx, originalTs.length - 1));
            const t = originalTs[safeIdx];
            if (t === undefined) return;

            // u.bbox / canvas 绘制坐标使用的是 device pixels（已乘 pxRatio）
            // 必须用 can=true 获取 device-pixel 坐标，否则会按 1/pxRatio 缩放导致“80% 画到 20%”
            const x = u.valToPos(t, 'x', true);

            // 检查位置是否在可见区域内
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

            const focused = focusedSeriesRef.current;
            if (!focused) return;
            const focusX = u.valToPos(focused.xVal, 'x', true);
            const focusY = u.valToPos(focused.yVal, 'y', true);
            if (!Number.isFinite(focusX) || !Number.isFinite(focusY)) return;
            if (focusX < bbox.left || focusX > bbox.left + bbox.width) return;
            if (focusY < bbox.top || focusY > bbox.top + bbox.height) return;

            // Draw a lightweight halo marker for the focused series.
            ctx.save();
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(focusX, focusY, 8, 0, Math.PI * 2);
            ctx.fillStyle = withAlpha(focused.color, 0.2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(focusX, focusY, 4.2, 0, Math.PI * 2);
            ctx.fillStyle = focused.color;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
      plugins: [
        // Click to seek plugin
        {
          hooks: {
            init: (u) => {
              u.over.addEventListener('wheel', onPlotWheel, { passive: false });
              u.over.addEventListener('dblclick', onPlotDblClick);
              u.over.addEventListener('mousedown', (e) => {
                if (e.button === 0) {
                  // Left click
                  const val = u.posToVal(u.cursor.left!, 'x');
                  // Find closest index in *original* timestamps (important when simplified)
                  const originalTs = originalTimestampsRef.current;
                  const closestIdx =
                    originalTs.length > 0 ? findClosestIndexInSortedArray(originalTs, val) : 0;
                  setFrameIndex(closestIdx);

                  const over = u.over as HTMLElement;
                  const overOffL = over.offsetLeft || 0;
                  const overOffT = over.offsetTop || 0;
                  const cursorLeft = u.cursor.left ?? 0;
                  const cursorTop = u.cursor.top ?? 0;
                  const cursorX = overOffL + cursorLeft;
                  const cursorY = overOffT + cursorTop;
                  const xData = u.data[0] as number[] | Float64Array;
                  const idxInChart =
                    xData.length > 0 ? findClosestIndexInSortedArray(Array.from(xData), val) : 0;
                  const xVal = Number(xData[idxInChart] ?? val);
                  const frameIdx =
                    originalTs.length > 0
                      ? findClosestIndexInSortedArray(originalTs, xVal)
                      : idxInChart;
                  const pendingPinned = {
                    u,
                    idx: idxInChart,
                    xVal,
                    frameIdx,
                    cursorX,
                    cursorY,
                    containerW: chartRef.current?.clientWidth ?? over.clientWidth,
                    containerH: chartRef.current?.clientHeight ?? over.clientHeight,
                  };

                  if (!tooltipPinnedRef.current) {
                    tooltipPinnedRef.current = true;
                    tooltipPinnedPendingRef.current = pendingPinned;
                    tooltipPendingRef.current = pendingPinned;
                    tooltipManualScrollLockRef.current = false;
                    tooltipLastIdxRef.current = null;
                    tooltipLastFocusKeyRef.current = null;
                    scheduleTooltipRender();
                  } else {
                    tooltipPinnedRef.current = false;
                    tooltipPinnedPendingRef.current = null;
                    tooltipManualScrollLockRef.current = false;
                  }
                }
              });
              u.over.addEventListener('mouseenter', () => {
                // 鼠标进入图表区域，如果之前在 tooltip 上，需要清除 hover 状态
                // 这样 setCursor 钩子才能正常更新 tooltip
                if (isTooltipHoverRef.current) {
                  isTooltipHoverRef.current = false;
                }
              });
              u.over.addEventListener('mouseleave', (e) => {
                const tip = tooltipRef.current;
                if (!tip) return;
                if (tooltipPinnedRef.current) return;
                // Moving from plot overlay into tooltip should not hide it.
                const next = (e as MouseEvent).relatedTarget as Node | null;
                if (next && tip.contains(next)) return;
                if (isTooltipHoverRef.current) return;
                // 延迟隐藏，给用户时间移动到 tooltip 上
                if (tooltipHideDelayRef.current != null) {
                  window.clearTimeout(tooltipHideDelayRef.current);
                }
                tooltipHideDelayRef.current = window.setTimeout(() => {
                  if (!tooltipPinnedRef.current && !isTooltipHoverRef.current && tip) {
                    tip.classList.add('hidden');
                    clearTooltipRuntime();
                    plotRef.current?.redraw(false, false);
                  }
                  tooltipHideDelayRef.current = null;
                }, 300);
              });
            },
            destroy: (u) => {
              u.over.removeEventListener('wheel', onPlotWheel);
              u.over.removeEventListener('dblclick', onPlotDblClick);
              if (wheelRafId != null) {
                window.cancelAnimationFrame(wheelRafId);
                wheelRafId = null;
              }
              wheelPendingDy = 0;
            },
          },
        },
      ],
    };

    if (!plotRef.current) {
      plotRef.current = new uPlot(
        options,
        preparedData.data as uPlot.AlignedData,
        chartRef.current,
      );
      chartScaleResetPendingRef.current = false;
    } else {
      plotRef.current.batch(() => {
        if (plotRef.current!.series.length !== preparedData.configs.length) {
          plotRef.current!.destroy();
          plotRef.current = new uPlot(
            options,
            preparedData.data as uPlot.AlignedData,
            chartRef.current!,
          );
          chartScaleResetPendingRef.current = false;
        } else {
          const resetScales = chartScaleResetPendingRef.current;
          plotRef.current!.setData(preparedData.data as uPlot.AlignedData, resetScales);
          if (resetScales) {
            chartScaleResetPendingRef.current = false;
          }
        }
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      if (plotRef.current && chartRef.current) {
        plotRef.current.setSize({
          width: chartRef.current.offsetWidth,
          height: chartRef.current.offsetHeight,
        });
      }
    });

    resizeObserver.observe(chartRef.current);
    return () => {
      if (wheelRafId != null) {
        window.cancelAnimationFrame(wheelRafId);
        wheelRafId = null;
      }
      resizeObserver.disconnect();
      tipEl?.removeEventListener('mouseenter', onTipEnter);
      tipEl?.removeEventListener('mouseleave', onTipLeave);
      tooltipDomRefsRef.current = null;
      tooltipPinnedRef.current = false;
      tooltipPinnedPendingRef.current = null;
      tooltipManualScrollLockRef.current = false;
      if (tooltipRafIdRef.current != null) {
        window.cancelAnimationFrame(tooltipRafIdRef.current);
        tooltipRafIdRef.current = null;
      }
      if (tooltipHideDelayRef.current != null) {
        window.clearTimeout(tooltipHideDelayRef.current);
        tooltipHideDelayRef.current = null;
      }
    };
  }, [preparedData, resolvedTheme, setFrameIndex, t, i18n.language]);

  useEffect(() => {
    return () => {
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
      }
    };
  }, []);

  const featureFilterNodes = useMemo(
    () => buildFeatureFilterTree(chartCore?.dimensions ?? chartDimensions),
    [chartCore?.dimensions, chartDimensions],
  );

  const toggleSeries = useCallback((seriesId: string) => {
    setSelectedSeriesIds((prev) => {
      const next = new Set(prev);
      if (next.has(seriesId)) {
        if (next.size > 0) next.delete(seriesId);
      } else {
        next.add(seriesId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    userClearedJointsRef.current = false;
    setSelectedSeriesIds(new Set(allSeriesIds));
  }, [allSeriesIds]);

  const clearAll = useCallback(() => {
    userClearedJointsRef.current = true;
    setSelectedSeriesIds(new Set());
  }, []);

  const setSeriesItemsChecked = useCallback((itemIds: string[], checked: boolean) => {
    setSelectedSeriesIds((prev) => applyGroupSelection(prev, itemIds, checked));
  }, []);

  const handleFilterHoverChange = useCallback(
    (payload: { type: 'feature' | 'group' | 'item'; id: string; itemIds: string[] } | null) => {
      const next = payload ? new Set(payload.itemIds) : null;
      const prev = hoveredSeriesIdsRef.current;

      const same =
        (!prev && !next) ||
        (!!prev &&
          !!next &&
          prev.size === next.size &&
          Array.from(prev).every((key) => next.has(key)));
      if (same) return;

      hoveredSeriesIdsRef.current = next;
      plotRef.current?.redraw(true, false);
    },
    [],
  );

  const dimensionById = useMemo(() => {
    const map = new Map<string, { jointName: string }>();
    (chartCore?.dimensions ?? chartDimensions).forEach((dim) => {
      map.set(dim.id, { jointName: dim.jointName });
    });
    return map;
  }, [chartCore?.dimensions, chartDimensions]);

  const getSeriesItemColor = useCallback(
    (seriesId: string) => {
      const dim = dimensionById.get(seriesId);
      return dim ? jointColorMap[dim.jointName] : undefined;
    },
    [dimensionById, jointColorMap],
  );

  const onJointFilterMenuOpenChange = useCallback((open: boolean) => {
    if (open) return;
    hoveredSeriesIdsRef.current = null;
    plotRef.current?.redraw(true, false);
  }, []);

  const summarySelectedCountLabel = useCallback(
    (count: number) => t('chart.joints.selectedCount', { count }),
    [t],
  );

  const jointFilterDropdownProps = useMemo(
    () => ({
      featureFilterNodes,
      selectedIds: selectedSeriesIds,
      jointSearch,
      onSearchChange: setJointSearch,
      onSetItemsChecked: setSeriesItemsChecked,
      onToggleItem: toggleSeries,
      onSelectAll: selectAll,
      onClearAll: clearAll,
      searchPlaceholder: t('chart.joints.searchPlaceholder'),
      emptyLabel: t('chart.joints.noResults'),
      selectAllLabel: t('chart.joints.selectAll'),
      summaryAllLabel: t('chart.joints.all'),
      summaryNoneLabel: t('chart.joints.none'),
      summarySelectedCountLabel,
      totalSeriesCount: allSeriesIds.length,
      onHoverChange: handleFilterHoverChange,
      getItemColor: getSeriesItemColor,
      onMenuOpenChange: onJointFilterMenuOpenChange,
    }),
    [
      featureFilterNodes,
      selectedSeriesIds,
      jointSearch,
      setSeriesItemsChecked,
      toggleSeries,
      selectAll,
      clearAll,
      t,
      allSeriesIds.length,
      summarySelectedCountLabel,
      handleFilterHoverChange,
      getSeriesItemColor,
      onJointFilterMenuOpenChange,
    ],
  );

  const visibleJointNamesForSplit = useMemo(
    () =>
      getVisibleJointNamesFromSelected(chartCore?.dimensions ?? chartDimensions, selectedSeriesIds),
    [chartCore?.dimensions, chartDimensions, selectedSeriesIds],
  );

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/20">
        <div className="flex items-center gap-2 overflow-hidden mr-2">
          <ChartJointFilterDropdown {...jointFilterDropdownProps} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs gap-1 hover:bg-muted/50 outline-none shrink-0"
            disabled={!chartCore}
            title={t('chart.split.openTitle')}
            onClick={() => {
              setPlaying(false);
              setSplitSheetOpen(true);
            }}
          >
            <PanelRight className="h-3 w-3 shrink-0" />
            <span className="max-w-[100px] truncate">{t('chart.split.open')}</span>
          </Button>
        </div>

        <div className="flex gap-2 shrink-0 items-center">
          {(hasAction || hasState) && (
            <>
              {hasAction && (
                <div
                  className="group relative flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground tracking-tight px-1.5 py-0.5 rounded hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAction(!showAction);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showAction}
                    onChange={(e) => {
                      e.stopPropagation();
                      setShowAction(e.target.checked);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-3 h-3 cursor-pointer accent-primary shrink-0"
                    title={t('chart.legend.toggleAction')}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <svg
                    width="18"
                    height="6"
                    viewBox="0 0 18 6"
                    className="overflow-visible shrink-0"
                  >
                    <line
                      x1="0"
                      y1="3"
                      x2="18"
                      y2="3"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray="3 3"
                      className={showAction ? 'text-foreground/60' : 'text-muted-foreground/30'}
                    />
                  </svg>
                  <span className={showAction ? '' : 'opacity-30'}>
                    {t('chart.legend.actionAbbr')}
                  </span>
                </div>
              )}
              {hasState && (
                <div
                  className="group relative flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground tracking-tight px-1.5 py-0.5 rounded hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowState(!showState);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showState}
                    onChange={(e) => {
                      e.stopPropagation();
                      setShowState(e.target.checked);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-3 h-3 cursor-pointer accent-primary shrink-0"
                    title={t('chart.legend.toggleState')}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <svg
                    width="18"
                    height="6"
                    viewBox="0 0 18 6"
                    className="overflow-visible shrink-0"
                  >
                    <line
                      x1="0"
                      y1="3"
                      x2="18"
                      y2="3"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={showState ? 'text-foreground/40' : 'text-muted-foreground/30'}
                    />
                  </svg>
                  <span className={showState ? '' : 'opacity-30'}>
                    {t('chart.legend.stateAbbr')}
                  </span>
                </div>
              )}
            </>
          )}
          {preparedData?.meta?.simplified && (
            <div className="flex items-center ml-2">
              <span className="text-[9px] font-mono text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded border border-border/50">
                {t('chart.sampling.enabled', {
                  originalPoints: preparedData.meta.originalPoints,
                  displayedPoints: preparedData.meta.displayedPoints,
                  stride: preparedData.meta.stride,
                })}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {/* chart-uplot 始终渲染，防止 episode 切换时从 0x0 扩展导致 CLS */}
        <div className="absolute inset-0">
          <div ref={chartRef} className="chart-uplot w-full h-full" />
          <div
            ref={tooltipRef}
            className="chart-tooltip pointer-events-auto select-text cursor-text absolute left-3 top-3 z-20 hidden max-w-[420px] rounded-md border bg-background/95 backdrop-blur text-[11px] shadow-lg transition-opacity duration-150"
            style={{ opacity: 1 }}
          />
        </div>
        {!preparedData && (
          <div className="absolute inset-0">
            {selectedEpisodeIndex === null && !isLoading ? (
              <PanelEmptyState message={t('playback.noData')} />
            ) : (
              <PanelLoadingState message={t('common.loading')} />
            )}
          </div>
        )}
      </div>
      {chartCore ? (
        <SplitChartsSheet
          open={splitSheetOpen}
          onOpenChange={(open) => {
            setSplitSheetOpen(open);
            if (open) setPlaying(false);
          }}
          chartCore={chartCore}
          allJointNames={visibleJointNamesForSplit}
          selectedSeriesIds={selectedSeriesIds}
          jointFilterDropdownProps={jointFilterDropdownProps}
          showAction={showAction}
          showState={showState}
          hasAction={hasAction}
          hasState={hasState}
        />
      ) : null}
    </div>
  );
};

// Memoize ChartPanel to prevent unnecessary re-renders
export const ChartPanel: React.FC<ChartPanelProps> = ChartPanelContent;
