import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import 'uplot/dist/uPlot.min.css';
import './uplot-theme.css';
import {
  useLeRobotPlayback,
  useLeRobotData,
  useLeRobotSelection,
} from '../../../contexts/LeRobotContext';
import { useTheme } from '../../../contexts/ThemeContext';
import { Button } from '@/ui';
import { PanelRight } from 'lucide-react';
import { PanelEmptyState } from '../Common/PanelState';
import { ChartJointFilterDropdown } from './ChartJointFilterDropdown';
import { buildFeatureFilterTree, getVisibleJointNamesFromSelected } from '@/core';
import { applyGroupSelection, episodeTimeDomain } from '@/core';
import { getChartSeriesKind, getDefaultChartFeatureKeys } from '@/core';
import {
  buildJointColorMap,
  collectChartDimensions,
  collectUniqueJointNames,
  computeChartDataCore,
} from './chartPanelModel';
import { SplitChartsSheet } from './Split/SplitChartsSheet';
import { FeatureChartGroups, type ChartGroupData } from './FeatureChartGroups';
import { ChartGroupsPlaceholder } from './ChartGroupsPlaceholder';
import {
  buildFeatureChartGroups,
  columnDimension,
  defaultVisibleSeriesIds,
  nearestSampleIndex,
} from './chartGroupsModel';
import { useAuxiliarySeries } from '../../../contexts/AuxiliarySeriesContext';

interface ChartPanelProps {
  params?: {
    data?: number[][];
    featureKey?: string;
  };
}

const ChartPanelContent: React.FC<ChartPanelProps> = ({ params }) => {
  const { t } = useTranslation();
  const { chartData, pendingChartColumns, currentFrames, setFrameIndex, setPlaying } =
    useLeRobotPlayback();
  const { subscribeFrameIndex, getFrameIndex, info, isLoading, error } = useLeRobotData();
  const { selectedEpisodeIndex } = useLeRobotSelection();
  const { resolvedTheme } = useTheme();
  const { auxiliaryGroups } = useAuxiliarySeries();
  const hoveredSeriesIdsRef = useRef<Set<string> | null>(null);

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

  const allSeriesIds = useMemo(
    () => [
      ...chartDimensions.map((d) => d.id),
      ...auxiliaryGroups.flatMap((data) => data.group.series.map((series) => series.id)),
    ],
    [chartDimensions, auxiliaryGroups],
  );
  const defaultVisibleIds = useMemo(
    () =>
      defaultVisibleSeriesIds(buildFeatureChartGroups(targetFeatures, info?.features, chartData)),
    [targetFeatures, info?.features, chartData],
  );
  const auxiliaryDefaultIds = useMemo(
    () => defaultVisibleSeriesIds(auxiliaryGroups.map((data) => data.group)),
    [auxiliaryGroups],
  );

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

  // Defaults (the first dimensions of every group) are offered once per
  // series id, so a group that appears later (an auxiliary series loaded
  // after the dataset) starts visible too, unless the user cleared the
  // selection. A new dataset starts over.
  const userClearedJointsRef = useRef(false);
  const offeredDefaultsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    offeredDefaultsRef.current = new Set();
    userClearedJointsRef.current = false;
    setSelectedSeriesIds(new Set());
  }, [info]);
  useEffect(() => {
    const offered = offeredDefaultsRef.current;
    const fresh = [...defaultVisibleIds, ...auxiliaryDefaultIds].filter((id) => !offered.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) offered.add(id);
    if (userClearedJointsRef.current) return;
    setSelectedSeriesIds((prev) => new Set([...prev, ...fresh]));
  }, [defaultVisibleIds, auxiliaryDefaultIds]);

  /** Frame → time, from the same timestamps the player uses. */
  const frameTimes = useMemo(() => {
    const fromFrames = currentFrames.map((frame) => Number(frame.timestamp ?? 0));
    if (fromFrames.length > 0) return Float64Array.from(fromFrames);
    const column = chartData.timestamp;
    return column ? Float64Array.from(column.values.subarray(0, column.rows)) : new Float64Array();
  }, [currentFrames, chartData.timestamp]);
  const frameTimesRef = useRef(frameTimes);
  frameTimesRef.current = frameTimes;

  const featureGroups = useMemo<ChartGroupData[]>(() => {
    if (frameTimes.length === 0) return [];
    const pending = new Set(pendingChartColumns);
    return buildFeatureChartGroups(targetFeatures, info?.features, chartData)
      .filter((group) => chartData[group.id] || pending.has(group.id))
      .map((group) => {
        const column = chartData[group.id];
        // Still being read: keep the group's place, draw when its columns arrive.
        if (!column) return { group, x: frameTimes, values: () => undefined, pending: true };
        const cache = new Map<string, Float64Array>();
        const x =
          column.rows === frameTimes.length ? frameTimes : frameTimes.subarray(0, column.rows);
        return {
          group,
          x,
          values: (seriesId: string) => {
            let values = cache.get(seriesId);
            if (!values) {
              const series = group.series.find((item) => item.id === seriesId);
              if (!series) return undefined;
              values = columnDimension(column, series.dimIndex).subarray(0, x.length);
              cache.set(seriesId, values);
            }
            return values;
          },
        };
      });
  }, [targetFeatures, info?.features, chartData, pendingChartColumns, frameTimes]);

  /** The groups the charts will have, from the dataset's features alone (for the loading state). */
  const placeholderGroups = useMemo(
    () => buildFeatureChartGroups(targetFeatures, info?.features, {}),
    [targetFeatures, info?.features],
  );

  const groups = useMemo(
    () => [...featureGroups, ...(frameTimes.length > 0 ? auxiliaryGroups : [])],
    [featureGroups, auxiliaryGroups, frameTimes.length],
  );

  // The episode's one time axis: the same fractions as the slider and tracks.
  const xRange = useMemo<[number, number]>(() => {
    if (frameTimes.length === 0) return [0, 1];
    return episodeTimeDomain(frameTimes[0]!, frameTimes.length, info?.fps || 30);
  }, [frameTimes, info?.fps]);

  const getPlayheadTime = useCallback(() => {
    const times = frameTimesRef.current;
    if (times.length === 0) return 0;
    return times[Math.max(0, Math.min(getFrameIndex(), times.length - 1))]!;
  }, [getFrameIndex]);

  const subscribePlayheadTime = useCallback(
    (listener: (time: number) => void) =>
      subscribeFrameIndex((frameIndex) => {
        const times = frameTimesRef.current;
        if (times.length === 0) return;
        listener(times[Math.max(0, Math.min(frameIndex, times.length - 1))]!);
      }),
    [subscribeFrameIndex],
  );

  const onSeekTime = useCallback(
    (time: number) => {
      const index = nearestSampleIndex(frameTimesRef.current, time);
      if (index >= 0) setFrameIndex(index);
    },
    [setFrameIndex],
  );

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
    <div className="w-full h-full flex flex-col bg-background text-foreground overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-y-1 px-3 py-1.5 border-b bg-muted/20">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 mr-2">
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
      </div>

      <div className="flex-1 min-h-0 relative">
        {groups.length > 0 ? (
          <FeatureChartGroups
            groups={groups}
            selectedIds={selectedSeriesIds}
            onToggleSeries={toggleSeries}
            xRange={xRange}
            getPlayheadTime={getPlayheadTime}
            subscribePlayheadTime={subscribePlayheadTime}
            onSeekTime={onSeekTime}
            resolvedTheme={resolvedTheme}
          />
        ) : (
          <div className="absolute inset-0">
            {/* A failed load is named once, by the viewer's failure line above the
                panels (with Retry); the chart does not repeat it. */}
            {error && !isLoading ? null : selectedEpisodeIndex === null && !isLoading ? (
              <PanelEmptyState message={t('playback.noData')} />
            ) : (
              <ChartGroupsPlaceholder groups={placeholderGroups} />
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
          onShowActionChange={setShowAction}
          onShowStateChange={setShowState}
        />
      ) : null}
    </div>
  );
};

// Memoize ChartPanel to prevent unnecessary re-renders
export const ChartPanel: React.FC<ChartPanelProps> = ChartPanelContent;
