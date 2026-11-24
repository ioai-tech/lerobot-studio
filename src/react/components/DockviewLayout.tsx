import React, {
  useRef,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { DockviewReact } from 'dockview-react';
import type { DockviewReadyEvent, IDockviewPanelProps, DockviewApi } from 'dockview-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { useLeRobotData } from '../contexts/LeRobotContext';
import type { LeRobotFeature } from '@/core';
import 'dockview-react/dist/styles/dockview.css';
import { VideoPanel, ImagePanel, ChartPanel, RawPanel, PanelErrorBoundary } from './panels';
import { PanelTitle } from './PanelTitle';
import {
  cameraAreaHeight,
  cameraDisplayName,
  chooseCamerasPerRow,
  getAutoLayoutVisualRows,
  isStackedPanelsWidth,
  visualAspectRatio,
} from '@/core';
import { safeAddPanel } from '../utils/dockviewPanelId';

/** Narrowest camera tile worth showing in a row. */
const MIN_CAMERA_TILE_PX = 160;

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
        <VideoPanel params={props.params} />
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
  const { info: currentInfo } = useLeRobotData();
  // The panels follow the dataset's features only: another source of the
  // same recording (a swap) keeps every panel, and its cameras, mounted.
  const layoutInfoRef = useRef(currentInfo);
  const featuresSignature = (value: typeof currentInfo) =>
    value ? JSON.stringify(value.features) : null;
  if (featuresSignature(layoutInfoRef.current) !== featuresSignature(currentInfo)) {
    layoutInfoRef.current = currentInfo;
  }
  const info = layoutInfoRef.current;
  const dockviewRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  // Narrow containers (embedded viewers on phones) get a single stacked column.
  const stacked = isStackedPanelsWidth(box.width);
  const measured = box.width > 0;
  const [panelCount, setPanelCount] = useState(0);

  useLayoutEffect(() => {
    const el = dockviewRef.current;
    if (!el) return;
    // A hidden container (width 0) keeps the last visible size: hiding and
    // showing the viewer does not rebuild its panels.
    const update = (width: number, height: number) =>
      width > 0 &&
      setBox((prev) =>
        prev.width === Math.round(width) && prev.height === Math.round(height)
          ? prev
          : { width: Math.round(width), height: Math.round(height) },
      );
    update(el.clientWidth, el.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      update(rect?.width ?? el.clientWidth, rect?.height ?? el.clientHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Camera features and their frame shape (the first camera's). */
  const visualKeys = useMemo(
    () =>
      info
        ? Object.entries(info.features)
            .filter(([, feature]) => feature?.dtype === 'video' || feature?.dtype === 'image')
            .map(([key]) => key)
        : [],
    [info],
  );
  const aspect = useMemo(
    () => visualAspectRatio(visualKeys[0] ? info?.features[visualKeys[0]] : undefined),
    [info, visualKeys],
  );
  // Cameras per row: the arrangement that shows the biggest frames.
  const maxPerRow = useMemo(() => {
    if (box.width <= 0) return 4;
    const cap = Math.max(1, Math.min(4, Math.floor(box.width / MIN_CAMERA_TILE_PX)));
    return chooseCamerasPerRow({
      count: Math.min(visualKeys.length, 6),
      width: box.width,
      height: box.height,
      aspect,
      maxPerRow: cap,
    });
  }, [aspect, box.height, box.width, visualKeys.length]);
  const layoutInputRef = useRef({ box, aspect });
  layoutInputRef.current = { box, aspect };

  /** Camera panel ids per row of the current split layout (empty when stacked). */
  const cameraRowsRef = useRef<string[][]>([]);

  /**
   * Sizes the split layout in place (never through `fromJSON`, which would
   * re-mount every panel): the camera rows take `cameraAreaHeight` of the
   * grid height, split evenly, and the charts and raw panel the rest; the
   * panels of a row, and the charts and raw panel, share the width evenly.
   */
  const applyLayoutSizes = (api: DockviewApi) => {
    const rows = cameraRowsRef.current.filter((row) => row.length > 0);
    const { width, height } = api;
    if (rows.length === 0 || width <= 0 || height <= 0) return;
    const cameraArea = cameraAreaHeight({
      height,
      width,
      rows: rows.length,
      perRow: Math.max(...rows.map((row) => row.length)),
      aspect: layoutInputRef.current.aspect,
    });
    const rowHeight = Math.max(1, Math.floor(cameraArea / rows.length));
    const groupOf = (id: string) => api.getPanel(id)?.group;
    try {
      for (const row of rows) {
        const columnWidth = Math.max(1, Math.floor(width / row.length));
        for (const id of row) groupOf(id)?.api.setSize({ width: columnWidth, height: rowHeight });
      }
      const bottomHeight = Math.max(1, height - rowHeight * rows.length);
      const halfWidth = Math.max(1, Math.floor(width / 2));
      groupOf('chart-panel')?.api.setSize({ width: halfWidth, height: bottomHeight });
      groupOf('raw-panel')?.api.setSize({ width: halfWidth, height: bottomHeight });
    } catch {
      // Keep dockview's own sizes when a group is mid-update.
    }
  };

  // Size changes (window, sidebar, host notices) resize the rows in place.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || stacked) return;
    const frame = window.requestAnimationFrame(() => applyLayoutSizes(api));
    return () => window.cancelAnimationFrame(frame);
  }, [box.width, box.height, aspect, stacked]);

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

  // Handle dynamic panel creation when info changes
  useEffect(() => {
    if (!apiRef.current || !info) return;
    // Build once the container is measured: a first build at the unmeasured
    // default would mount every camera twice on open.
    if (!measured && (dockviewRef.current?.clientWidth ?? 0) > 0) return;

    const api = apiRef.current;
    api.panels.forEach((p) => p.api.close());

    const visualFeaturesByKey = new Map<
      string,
      { id: string; component: 'video' | 'image'; title: string; params: { featureKey: string } }
    >(
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
              // The shown name is PanelTitle's (host `cameraLabels` at render time).
              title: cameraDisplayName(key),
              params: { featureKey: key },
            },
          ] as const;
        }),
    );

    const { row1: row1Keys, row2: row2Keys } = getAutoLayoutVisualRows(
      Array.from(visualFeaturesByKey.keys()),
      6,
      maxPerRow,
    );
    const row1Visual = row1Keys
      .map((key) => visualFeaturesByKey.get(key))
      .filter((v): v is NonNullable<typeof v> => Boolean(v));
    const row2Visual = row2Keys
      .map((key) => visualFeaturesByKey.get(key))
      .filter((v): v is NonNullable<typeof v> => Boolean(v));
    const visibleVisual = [...row1Visual, ...row2Visual];

    setPanelCount(0);
    cameraRowsRef.current = stacked
      ? []
      : [row1Visual.map((v) => v.id), row2Visual.map((v) => v.id)];

    // 如果没有视觉源，降级为 chart + raw 横向均分（避免空白）
    if (visibleVisual.length === 0) {
      safeAddPanel(api, {
        id: 'chart-panel',
        component: 'chart',
        title: t('common.chart'),
        params: {},
        tabComponent: 'default',
      });
      safeAddPanel(api, {
        id: 'raw-panel',
        component: 'raw',
        title: t('panels.raw.title'),
        params: {},
        tabComponent: 'default',
        position: { referencePanel: 'chart-panel', direction: stacked ? 'below' : 'right' },
      });
      return;
    }

    if (stacked) {
      let previousId: string | null = null;
      const stackedPanels = [
        ...visibleVisual.map((v) => ({
          id: v.id,
          component: v.component,
          title: v.title,
          params: v.params as { featureKey?: string },
        })),
        { id: 'chart-panel', component: 'chart' as const, title: t('common.chart'), params: {} },
        { id: 'raw-panel', component: 'raw' as const, title: t('panels.raw.title'), params: {} },
      ];
      for (const p of stackedPanels) {
        safeAddPanel(api, {
          ...p,
          tabComponent: 'default',
          ...(previousId ? { position: { referencePanel: previousId, direction: 'below' } } : {}),
        });
        previousId = p.id;
      }
      setPanelCount(stackedPanels.length);
      return;
    }

    const firstVisualId = row1Visual[0].id;

    // 先创建首个视觉面板
    safeAddPanel(api, {
      id: firstVisualId,
      component: visibleVisual[0].component,
      title: visibleVisual[0].title,
      params: visibleVisual[0].params,
      tabComponent: 'default',
    });

    // 第一行视觉区：其余面板均匀分布在右侧（同一行）
    let row1TailId = firstVisualId;
    for (const v of row1Visual.slice(1)) {
      safeAddPanel(api, {
        id: v.id,
        component: v.component,
        title: v.title,
        params: v.params,
        tabComponent: 'default',
        // 始终追加到当前行尾，避免固定锚点导致中间插入而出现顺序反转
        position: { referencePanel: row1TailId, direction: 'right' },
      });
      row1TailId = v.id;
    }

    // 第二行视觉区：depth 等关键词优先落在此行
    if (row2Visual.length > 0) {
      const secondRowFirst = row2Visual[0];
      safeAddPanel(api, {
        id: secondRowFirst.id,
        component: secondRowFirst.component,
        title: secondRowFirst.title,
        params: secondRowFirst.params,
        tabComponent: 'default',
        // 关键：使用绝对 below，先切“整行”再在行内加列，避免三角嵌套
        position: { direction: 'below' },
      });

      let row2TailId = secondRowFirst.id;
      for (const v of row2Visual.slice(1)) {
        safeAddPanel(api, {
          id: v.id,
          component: v.component,
          title: v.title,
          params: v.params,
          tabComponent: 'default',
          position: { referencePanel: row2TailId, direction: 'right' },
        });
        row2TailId = v.id;
      }
    }

    // 第三行：Chart + Raw
    safeAddPanel(api, {
      id: 'chart-panel',
      component: 'chart',
      title: t('common.chart'),
      params: {},
      tabComponent: 'default',
      // 再次使用绝对 below：确保 chart/raw 落在完整视觉区下方
      position: { direction: 'below' },
    });

    safeAddPanel(api, {
      id: 'raw-panel',
      component: 'raw',
      title: t('panels.raw.title'),
      params: {},
      tabComponent: 'default',
      position: { referencePanel: 'chart-panel', direction: 'right' },
    });

    applyLayoutSizes(api);
  }, [info, t, maxPerRow, stacked, measured]);

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
