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
  chooseCamerasPerRow,
  getAutoLayoutVisualRows,
  isStackedPanelsWidth,
  visualAspectRatio,
} from '@/core';
import { safeAddPanel } from '../utils/dockviewPanelId';

type DockviewSerializedGrid = {
  grid?: {
    root?: GridNode;
    width?: number;
    height?: number;
    orientation?: 'HORIZONTAL' | 'VERTICAL';
  };
};

/** Narrowest camera tile worth showing in a row. */
const MIN_CAMERA_TILE_PX = 160;

type GridNode =
  | { type: 'leaf'; data: { id: string; activeView?: string; views: string[] }; size: number }
  | { type: 'branch'; data: GridNode[]; size: number };

/** Panel ids of a serialized leaf (`views` in dockview's grid JSON). */
const leafPanels = (node: Extract<GridNode, { type: 'leaf' }>): string[] =>
  Array.isArray(node.data.views) ? node.data.views : [];

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
  const { info } = useLeRobotData();
  const dockviewRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  // Narrow containers (embedded viewers on phones) get a single stacked column.
  const stacked = isStackedPanelsWidth(box.width);
  const [panelCount, setPanelCount] = useState(0);

  useLayoutEffect(() => {
    const el = dockviewRef.current;
    if (!el) return;
    const update = (width: number, height: number) =>
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

  /**
   * 将当前布局 split size 重新均分，保证三层布局稳定：
   * - 顶部视觉区 + 底部 chart/raw 约 2:1 高度
   * - 视觉区若有两行，行高均分
   * - 每一行视觉面板宽度均分
   * - 底部 chart/raw 宽度均分
   */
  const rebalanceLayout = (
    api: DockviewApi,
    row1PanelIds: string[],
    row2PanelIds: string[],
    perRow: number,
  ) => {
    const visualPanelIds = [...row1PanelIds, ...row2PanelIds];
    if (visualPanelIds.length === 0) return;

    const containsAnyPanel = (node: GridNode, panelIds: Set<string>): boolean => {
      if (node.type === 'leaf') return leafPanels(node).some((p) => panelIds.has(p));
      return node.data.some((c) => containsAnyPanel(c, panelIds));
    };

    const countVisualLeaves = (node: GridNode, panelIds: Set<string>): number => {
      if (node.type === 'leaf') return leafPanels(node).some((p) => panelIds.has(p)) ? 1 : 0;
      return node.data.reduce((acc, c) => acc + countVisualLeaves(c, panelIds), 0);
    };

    const distributeSizes = (
      branch: Extract<GridNode, { type: 'branch' }>,
      weights: number[],
    ): void => {
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) return;
      let remaining = branch.size;
      const n = branch.data.length;
      for (let i = 0; i < n; i++) {
        const w =
          i === n - 1 ? remaining : Math.max(1, Math.round((branch.size * weights[i]) / total));
        branch.data[i].size = w;
        remaining -= w;
      }
    };

    const findDeepestBranchContainingAny = (
      node: GridNode,
      panelIds: Set<string>,
    ): Extract<GridNode, { type: 'branch' }> | null => {
      if (node.type !== 'branch') return null;
      if (!containsAnyPanel(node, panelIds)) return null;
      for (const child of node.data) {
        const inner = findDeepestBranchContainingAny(child, panelIds);
        if (inner) return inner;
      }
      return node;
    };

    const equalizeBottom = (node: GridNode): void => {
      // 找到包含 chart/raw 的分支并将两个叶子均分
      const hasChartOrRaw = (n: GridNode): boolean =>
        containsAnyPanel(n, new Set(['chart-panel', 'raw-panel']));

      const dfs = (n: GridNode): Extract<GridNode, { type: 'branch' }> | null => {
        if (n.type === 'branch') {
          if (hasChartOrRaw(n)) {
            // 优先选择“更靠近叶子”的分支
            for (const c of n.data) {
              const inner = dfs(c);
              if (inner) return inner;
            }
            return n;
          }
        }
        return null;
      };

      const bottomBranch = dfs(node);
      if (!bottomBranch) return;
      if (bottomBranch.data.length >= 2) {
        distributeSizes(
          bottomBranch,
          bottomBranch.data.map((_) => 1),
        );
      }
    };

    const equalizeRow = (node: GridNode, rowSet: Set<string>): void => {
      const rowBranch = findDeepestBranchContainingAny(node, rowSet);
      if (!rowBranch) return;
      const weights = rowBranch.data.map((c) => Math.max(0, countVisualLeaves(c, rowSet)));
      const sum = weights.reduce((a, b) => a + b, 0);
      if (sum > 0) distributeSizes(rowBranch, weights);
    };

    try {
      const state = api.toJSON() as DockviewSerializedGrid;
      const root = state.grid?.root;
      if (!root || root.type !== 'branch' || !Array.isArray(root.data)) return;

      const visualSet = new Set(visualPanelIds);
      const row1Set = new Set(row1PanelIds);
      const row2Set = new Set(row2PanelIds);
      const bottomSet = new Set(['chart-panel', 'raw-panel']);

      const children: GridNode[] = root.data;
      // The root of this layout stacks rows top to bottom; its own `size` is
      // the width, so the heights come from the grid height.
      const gridHeight = state.grid?.height ?? 0;
      const gridWidth = state.grid?.width ?? root.size;
      if (children.length >= 2 && state.grid?.orientation === 'VERTICAL' && gridHeight > 0) {
        const bottomIdx = children.findIndex((c) => containsAnyPanel(c, bottomSet));
        const topIdx = children.findIndex((c) => containsAnyPanel(c, visualSet));
        if (bottomIdx !== -1 && topIdx !== -1 && bottomIdx !== topIdx) {
          const topSize = Math.max(
            1,
            cameraAreaHeight({
              height: gridHeight,
              width: gridWidth,
              rows: row2PanelIds.length > 0 ? 2 : 1,
              perRow: Math.max(1, perRow),
              aspect: layoutInputRef.current.aspect,
            }),
          );
          children[topIdx].size = topSize;
          children[bottomIdx].size = Math.max(1, gridHeight - topSize);
        }
      }

      const topBranch = findDeepestBranchContainingAny(root, visualSet);
      if (topBranch && row2PanelIds.length > 0 && topBranch.data.length >= 2) {
        const rowWeights = topBranch.data.map((c): number =>
          containsAnyPanel(c, row1Set) || containsAnyPanel(c, row2Set) ? 1 : 0,
        );
        if (rowWeights.reduce((a, b) => a + b, 0) > 1) {
          distributeSizes(topBranch, rowWeights);
        }
      }

      equalizeRow(root, row1Set);
      if (row2PanelIds.length > 0) {
        equalizeRow(root, row2Set);
      }
      equalizeBottom(root);

      api.fromJSON(state as Parameters<DockviewApi['fromJSON']>[0]);
    } catch {
      // fromJSON/toJSON 失败时保持原布局（Dockview 会自恢复）
    }
  };

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
              title: key.split('.').pop() || key,
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

    rebalanceLayout(
      api,
      row1Visual.map((v) => v.id),
      row2Visual.map((v) => v.id),
      Math.max(row1Visual.length, row2Visual.length),
    );
  }, [info, t, maxPerRow, stacked]);

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
