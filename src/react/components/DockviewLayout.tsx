import React, { useRef, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DockviewReact } from 'dockview-react';
import type { DockviewReadyEvent, IDockviewPanelProps, DockviewApi } from 'dockview-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { useLeRobotData } from '../contexts/LeRobotContext';
import type { LeRobotFeature } from '@/core';
import 'dockview-react/dist/styles/dockview.css';
import { VideoPanel, ImagePanel, ChartPanel, RawPanel, PanelErrorBoundary } from './panels';
import { PanelTitle } from './PanelTitle';
import { getAutoLayoutVisualRows, getVisualMaxPerRow, isStackedPanelsWidth } from '@/core';
import { autoLayoutSignature, buildAutoLayout, type AutoPanel } from './dockviewAutoLayout';

/** Minimum height of each panel in the stacked (narrow) column; the column scrolls. */
const STACKED_PANEL_MIN_HEIGHT_PX = 220;

// Per-instance API context (multi-embed safe; no module singleton)
const DockviewApiContext = createContext<DockviewApi | null>(null);

export const useDockviewApi = () => {
  const api = useContext(DockviewApiContext);
  if (!api) {
    throw new Error('useDockviewApi must be used within DockviewLayout');
  }
  return api;
};

const components = {
  video: (props: IDockviewPanelProps<{ featureKey: string }>) => {
    return (
      <PanelErrorBoundary panelName="Video">
        <VideoPanel params={props.params} panelApi={props.api} containerApi={props.containerApi} />
      </PanelErrorBoundary>
    );
  },
  image: (props: IDockviewPanelProps<{ featureKey: string }>) => {
    return (
      <PanelErrorBoundary panelName="Image">
        <ImagePanel params={props.params} />
      </PanelErrorBoundary>
    );
  },
  chart: (props: IDockviewPanelProps<{ data?: number[][] }>) => {
    return (
      <PanelErrorBoundary panelName="Chart">
        <ChartPanel params={props.params} />
      </PanelErrorBoundary>
    );
  },
  raw: (props: IDockviewPanelProps<{ featureKey?: string }>) => {
    return (
      <PanelErrorBoundary panelName="Raw">
        <RawPanel params={props.params} />
      </PanelErrorBoundary>
    );
  },
};

// 自定义标签栏组件
const tabComponents = {
  default: PanelTitle,
};

export const DockviewLayout: React.FC = () => {
  const apiRef = useRef<DockviewApi | null>(null);
  const [dockviewApi, setDockviewApi] = useState<DockviewApi | null>(null);
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const { info } = useLeRobotData();
  const dockviewRef = useRef<HTMLDivElement>(null);
  const [maxPerRow, setMaxPerRow] = useState(4);
  // Narrow containers (embedded viewers on phones) get a single stacked column.
  const [stacked, setStacked] = useState(false);
  const [panelCount, setPanelCount] = useState(0);

  useEffect(() => {
    const el = dockviewRef.current;
    if (!el) return;
    const update = (width: number) => {
      setMaxPerRow(getVisualMaxPerRow(width));
      setStacked(isStackedPanelsWidth(width));
    };
    update(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      update(entries[0]?.contentRect.width ?? el.clientWidth);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (dockviewRef.current) {
      const container = dockviewRef.current.querySelector('.dockview-react');
      if (container) {
        container.classList.remove('dockview-theme-light', 'dockview-theme-dark');
        container.classList.add(
          resolvedTheme === 'dark' ? 'dockview-theme-dark' : 'dockview-theme-light',
        );
      }
    }
  }, [resolvedTheme]);

  // The automatic layout for this dataset and width. Panel ids name their feature, so a panel whose
  // feature is unchanged keeps its id across arrangements.
  const arrangement = useMemo(() => {
    if (!info) return null;
    const visualByKey = new Map<string, AutoPanel>(
      Object.entries(info.features)
        .filter((entry): entry is [string, LeRobotFeature] => {
          const feature = entry[1];
          return feature?.dtype === 'video' || feature?.dtype === 'image';
        })
        .map(([key, feature]) => {
          const isVideo = feature.dtype === 'video';
          return [
            key,
            {
              id: `${isVideo ? 'video' : 'image'}-${key}`,
              component: isVideo ? ('video' as const) : ('image' as const),
              title: key.split('.').pop() || key,
              params: { featureKey: key },
            },
          ] as const;
        }),
    );
    const { row1, row2 } = getAutoLayoutVisualRows(Array.from(visualByKey.keys()), 6, maxPerRow);
    const toPanels = (keys: string[]) =>
      keys.map((key) => visualByKey.get(key)).filter((v): v is AutoPanel => Boolean(v));
    const visualRows = [toPanels(row1), toPanels(row2)].filter((panels) => panels.length > 0);
    const bottom: AutoPanel[] = [
      { id: 'chart-panel', component: 'chart', title: 'chart', params: {} },
      { id: 'raw-panel', component: 'raw', title: 'raw', params: {} },
    ];
    return { visualRows, bottom, stacked };
  }, [info, maxPerRow, stacked]);

  const tRef = useRef(t);
  tRef.current = t;
  const builtRef = useRef<{ info: unknown; signature: string } | null>(null);

  // Build only when the dataset or the arrangement changes: a width change inside a breakpoint or
  // a locale switch never recreates panels (and video elements outlive panels in the video stage).
  useEffect(() => {
    const api = dockviewApi;
    if (!api || !arrangement || !info) return;
    const signature = autoLayoutSignature(arrangement);
    const built = builtRef.current;
    if (built && built.info === info && built.signature === signature) return;
    const translate = (panel: AutoPanel): AutoPanel =>
      panel.component === 'chart'
        ? { ...panel, title: tRef.current('common.chart') }
        : panel.component === 'raw'
          ? { ...panel, title: tRef.current('panels.raw.title') }
          : panel;
    const element = dockviewRef.current;
    const layout = buildAutoLayout({
      visualRows: arrangement.visualRows.map((panels) => panels.map(translate)),
      bottom: arrangement.bottom.map(translate),
      stacked: arrangement.stacked,
      width: element?.clientWidth || 1200,
      height: arrangement.stacked
        ? Math.max(
            element?.clientHeight || 800,
            (arrangement.visualRows.flat().length + arrangement.bottom.length) *
              STACKED_PANEL_MIN_HEIGHT_PX,
          )
        : element?.clientHeight || 800,
    });
    try {
      api.fromJSON(layout);
      builtRef.current = { info, signature };
    } catch (error) {
      console.warn('[dockview] could not apply the automatic layout', error);
    }
    setPanelCount(
      arrangement.stacked ? arrangement.visualRows.flat().length + arrangement.bottom.length : 0,
    );
  }, [dockviewApi, arrangement, info]);

  // A locale switch renames the panels in place.
  useEffect(() => {
    if (!dockviewApi) return;
    dockviewApi.getPanel('chart-panel')?.api.setTitle(t('common.chart'));
    dockviewApi.getPanel('raw-panel')?.api.setTitle(t('panels.raw.title'));
  }, [dockviewApi, t]);

  const onReady = (event: DockviewReadyEvent) => {
    const { api } = event;
    apiRef.current = api;
    setDockviewApi(api);

    // 强制"一分组一面板"：只允许 edge 类型的 drop（拆分为新分组）
    // 阻止 tab / header_space / content 类型的 drop（会合并进同一分组）
    api.onWillShowOverlay((e) => {
      if (e.kind !== 'edge') {
        e.preventDefault();
      }
    });
  };

  return (
    <DockviewApiContext.Provider value={dockviewApi}>
      <div
        ref={dockviewRef}
        className="w-full h-full"
        data-layout={stacked ? 'stacked' : 'split'}
        style={stacked ? { overflowY: 'auto', overflowX: 'hidden' } : undefined}
      >
        <div
          className="w-full"
          style={{
            height: stacked
              ? `max(100%, ${Math.max(panelCount, 1) * STACKED_PANEL_MIN_HEIGHT_PX}px)`
              : '100%',
          }}
        >
          <DockviewReact
            components={components}
            tabComponents={tabComponents}
            defaultTabComponent={PanelTitle}
            singleTabMode="fullwidth"
            /** 关闭标签栏溢出下拉（长标题时否则会遮挡 PanelTitle 右侧操作区） */
            disableTabsOverflowList
            onReady={onReady}
            className={resolvedTheme === 'dark' ? 'dockview-theme-dark' : 'dockview-theme-light'}
          />
        </div>
      </div>
    </DockviewApiContext.Provider>
  );
};
