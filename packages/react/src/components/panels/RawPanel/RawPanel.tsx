import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  memo,
  startTransition,
  useDeferredValue,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useLeRobotData, useLeRobotSelection } from '../../../contexts/LeRobotContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@ioai/lerobot-studio-ui';
import { Button } from '@ioai/lerobot-studio-ui';
import { ScrollArea } from '@ioai/lerobot-studio-ui';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ListFilter,
  Download,
  FileCode,
  Pause,
  Play,
  RefreshCw,
  Image as ImageIcon,
  Video as VideoIcon,
} from 'lucide-react';
import { cn, Tooltip, TooltipContent, TooltipTrigger } from '@ioai/lerobot-studio-ui';
import { HierarchicalFilterList } from '../Common/filters/HierarchicalFilterList';
import { groupFeatureKeys } from '@ioai/lerobot-studio-core';
import { applyGroupSelection } from '@ioai/lerobot-studio-core';
import { PanelEmptyState, PanelLoadingState } from '../Common/PanelState';
import {
  copyImageBytesAsPng,
  copyVideoFrameAsPng,
  type MediaCopyResult,
} from '@ioai/lerobot-studio-platform';
import { getFeatureDisplayType } from '@ioai/lerobot-studio-core';
import type { EpisodeMetadata, LeRobotInfo } from '@ioai/lerobot-studio-core';

// ============================================================================
// 常量配置
// ============================================================================

/** 自动刷新间隔（毫秒）- 降低到 200ms (5fps) 以减少 CPU 占用 */
const AUTO_REFRESH_INTERVAL = 200;

/** 大数组的截断阈值 - 超过此数量的数组会被折叠 */
const LARGE_ARRAY_THRESHOLD = 50;

/** 初始显示的数组项数量 */
const INITIAL_ARRAY_DISPLAY_COUNT = 20;

// ============================================================================
// 类型定义
// ============================================================================

interface JsonTreeViewProps {
  data: unknown;
  label?: string;
  depth?: number;
  isLast?: boolean;
  annotations?: Record<string, string[]>;
  path?: string;
  // 优化：将翻译函数通过 props 传递，避免每个递归层级都调用 useTranslation
  translations: {
    undefined: string;
    downloadBinary: string;
    copyImage: string;
    copyingImage: string;
    copiedImage: string;
    downloadedImage: string;
    imageDtype: string;
    videoDtype: string;
    itemsCount: (count: number) => string;
    keysCount: (count: number) => string;
    showMore: (count: number) => string;
    showLess: string;
  };
  mediaActions?: RawMediaActions;
}

interface RawPanelProps {
  params?: {
    featureKey?: string;
  };
}

type RawMediaKind = 'image' | 'video';

interface RawMediaValue {
  __rawMedia: true;
  kind: RawMediaKind;
  featureKey: string;
  frameIndex: number;
  episodeIndex: number;
  fps: number;
}

interface RawMediaActions {
  copyImage: (media: RawMediaValue) => Promise<MediaCopyResult>;
}

interface RawMediaCopyPayload {
  type: RawMediaKind;
  path: string | null;
  chunk_index: number | null;
  file_index: number | null;
  episode_index: number;
  frame_index: number;
}

function isRawMediaValue(value: unknown): value is RawMediaValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as RawMediaValue).__rawMedia === true &&
    ((value as RawMediaValue).kind === 'image' || (value as RawMediaValue).kind === 'video')
  );
}

function getRawMediaFilename(media: RawMediaValue): string {
  return `${media.featureKey}_episode-${media.episodeIndex}_frame-${media.frameIndex}`;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseNumberFromPath(path: string | null, pattern: RegExp): number | null {
  if (!path) return null;
  const match = path.match(pattern);
  return match ? toNumberOrNull(match[1]) : null;
}

function getChunksSize(info: LeRobotInfo | null): number {
  const value = toNumberOrNull((info as Record<string, unknown> | null)?.chunks_size);
  return value && value > 0 ? value : 1000;
}

function buildRawMediaCopyPayload(input: {
  kind: RawMediaKind;
  featureKey: string;
  info: LeRobotInfo | null;
  episode: EpisodeMetadata | null;
  episodeIndex: number;
  frameIndex: number;
  path: string | null;
}): RawMediaCopyPayload {
  const { kind, featureKey, info, episode, episodeIndex, frameIndex, path } = input;
  const record = (episode ?? {}) as Record<string, unknown>;
  const videoPrefix = `videos/${featureKey}`;
  const pathChunkIndex = parseNumberFromPath(path, /chunk-(\d+)/);
  const pathFileIndex = parseNumberFromPath(path, /file-(\d+)/);
  const fallbackChunkIndex = Math.floor(episodeIndex / getChunksSize(info));

  const chunkIndex =
    kind === 'video'
      ? (toNumberOrNull(record[`${videoPrefix}/chunk_index`]) ??
        toNumberOrNull(record['data/chunk_index']) ??
        toNumberOrNull(record.chunk_index) ??
        pathChunkIndex ??
        fallbackChunkIndex)
      : (toNumberOrNull(record['data/chunk_index']) ??
        toNumberOrNull(record.chunk_index) ??
        pathChunkIndex ??
        fallbackChunkIndex);

  const fileIndex =
    kind === 'video'
      ? (toNumberOrNull(record[`${videoPrefix}/file_index`]) ??
        toNumberOrNull(record['data/file_index']) ??
        toNumberOrNull(record.file_index) ??
        pathFileIndex)
      : (toNumberOrNull(record['data/file_index']) ??
        toNumberOrNull(record.file_index) ??
        pathFileIndex);

  return {
    type: kind,
    path,
    chunk_index: chunkIndex,
    file_index: fileIndex,
    episode_index: episodeIndex,
    frame_index: frameIndex,
  };
}

// ============================================================================
// 优化的 JsonTreeView 组件
// ============================================================================

interface RawMediaTreeNodeProps {
  data: RawMediaValue;
  labelNode: React.ReactNode;
  depth: number;
  isLast: boolean;
  translations: JsonTreeViewProps['translations'];
  mediaActions?: RawMediaActions;
}

const RawMediaTreeNode = memo((props: RawMediaTreeNodeProps) => {
  const { data, labelNode, depth, isLast, translations, mediaActions } = props;
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'downloaded'>('idle');

  const marginStyle = useMemo(() => ({ marginLeft: `${depth * 14}px` }), [depth]);

  const handleCopyImage = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      if (!mediaActions || copyState === 'copying') return;

      setCopyState('copying');
      void mediaActions
        .copyImage(data)
        .then((result) => {
          setCopyState(result === 'clipboard' ? 'copied' : 'downloaded');
          window.setTimeout(() => setCopyState('idle'), 2000);
        })
        .catch(() => {
          setCopyState('idle');
        });
    },
    [copyState, data, mediaActions],
  );

  const copyLabel =
    copyState === 'copying'
      ? translations.copyingImage
      : copyState === 'copied'
        ? translations.copiedImage
        : copyState === 'downloaded'
          ? translations.downloadedImage
          : translations.copyImage;
  const MediaIcon = data.kind === 'image' ? ImageIcon : VideoIcon;
  const dtypeLabel = data.kind === 'image' ? translations.imageDtype : translations.videoDtype;
  const inlineLabel = copyState === 'copied' ? translations.copiedImage : dtypeLabel;

  return (
    <div style={marginStyle} className="font-mono text-xs leading-5">
      <div className="flex items-center gap-1 hover:bg-muted/40 rounded-md px-1.5 -ml-1.5 group">
        {labelNode}
        <button
          type="button"
          className="inline-flex h-4 items-center justify-center rounded-md text-sky-700 hover:bg-muted/60 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100 transition-colors"
          onClick={handleCopyImage}
          disabled={!mediaActions || copyState === 'copying'}
          title={copyLabel}
          aria-label={copyLabel}
        >
          {copyState === 'copied' ? (
            <Check className="w-3 h-3 text-green-500" />
          ) : copyState === 'downloaded' ? (
            <Download className="w-3 h-3" />
          ) : (
            <MediaIcon className="w-3.5 h-3.5" />
          )}
          <span className="ml-0.5 text-[10px] font-semibold tracking-wide">{inlineLabel}</span>
        </button>
        {!isLast && <span>,</span>}
      </div>
    </div>
  );
});

RawMediaTreeNode.displayName = 'RawMediaTreeNode';

/**
 * 优化版本的 JSON 树形展示组件
 * 主要优化点：
 * 1. 翻译函数通过 props 传递，避免重复调用 useTranslation hook
 * 2. 大数组进行截断显示，支持"显示更多"功能
 * 3. 使用更精确的 memo 比较
 */
const JsonTreeView = memo(
  ({
    data,
    label,
    depth = 0,
    isLast = true,
    annotations,
    path = '',
    translations,
    mediaActions,
  }: JsonTreeViewProps) => {
    const [isOpen, setIsOpen] = useState(depth < 2); // 深层默认折叠
    const [arrayDisplayCount, setArrayDisplayCount] = useState(INITIAL_ARRAY_DISPLAY_COUNT);

    const handleDownload = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!(data instanceof Uint8Array)) return;

        const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = label ? `${label}.bin` : 'data.bin';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      [data, label],
    );

    const marginStyle = useMemo(() => ({ marginLeft: `${depth * 14}px` }), [depth]);
    const hasLabel = !!label;
    const labelNode = hasLabel ? (
      <span className="text-sky-600 dark:text-sky-400">{`"${label}": `}</span>
    ) : null;

    // 处理 undefined
    if (data === undefined) {
      return (
        <div style={marginStyle} className="font-mono text-xs leading-5">
          {labelNode}
          <span className="text-muted-foreground">{translations.undefined}</span>
          {!isLast && ','}
        </div>
      );
    }

    // 处理 null
    if (data === null) {
      return (
        <div style={marginStyle} className="font-mono text-xs leading-5">
          {labelNode}
          <span className="text-muted-foreground">null</span>
          {!isLast && ','}
        </div>
      );
    }

    // 处理二进制数据
    if (data instanceof Uint8Array) {
      return (
        <div
          style={marginStyle}
          className="font-mono text-xs leading-5 flex items-center gap-2 group"
        >
          {labelNode}
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-muted/30 text-sky-700 dark:text-sky-300 cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={handleDownload}
            title={translations.downloadBinary}
          >
            <FileCode className="w-3 h-3" />
            &lt;binary&gt; ({data.length} bytes)
            <Download className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </span>
          {!isLast && ','}
        </div>
      );
    }

    // 处理 Raw 面板中的媒体占位节点：不把完整图像/视频字节放进 React 树
    if (isRawMediaValue(data)) {
      return (
        <RawMediaTreeNode
          data={data}
          labelNode={labelNode}
          depth={depth}
          isLast={isLast}
          translations={translations}
          mediaActions={mediaActions}
        />
      );
    }

    // 处理对象和数组
    if (typeof data === 'object' && data !== null) {
      const isArray = Array.isArray(data);
      const keys = isArray ? data : Object.keys(data as Record<string, unknown>);
      const hasChildren = isArray ? data.length > 0 : keys.length > 0;
      const fullPath = path ? (label ? `${path}.${label}` : path) : label || '';

      // 空对象/数组
      if (!hasChildren) {
        return (
          <div style={marginStyle} className="font-mono text-xs leading-5">
            {labelNode}
            <span>{isArray ? '[]' : '{}'}</span>
            {!isLast && ','}
          </div>
        );
      }

      // 大数组处理
      const isLargeArray = isArray && data.length > LARGE_ARRAY_THRESHOLD;
      const displayItems = isArray
        ? isLargeArray
          ? data.slice(0, arrayDisplayCount)
          : data
        : Object.entries(data as Record<string, unknown>);
      const remainingCount = isArray ? data.length - arrayDisplayCount : 0;

      return (
        <div style={marginStyle} className="font-mono text-xs leading-5">
          <div
            className="flex items-center cursor-pointer hover:bg-muted/40 rounded-md px-1.5 -ml-1.5"
            onClick={() => setIsOpen(!isOpen)}
          >
            {labelNode}
            <span className="inline-flex w-4 shrink-0 items-center justify-center">
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </span>
            <span>{isArray ? '[' : '{'}</span>
            {!isOpen && (
              <span className="text-muted-foreground text-xs ml-1 tabular-nums">
                {isArray
                  ? translations.itemsCount(data.length)
                  : translations.keysCount(Object.keys(data as Record<string, unknown>).length)}
              </span>
            )}
            {!isOpen && <span>{isArray ? ']' : '}'}</span>}
            {!isOpen && !isLast && ','}
          </div>
          {isOpen && (
            <div>
              {isArray ? (
                <>
                  {(displayItems as unknown[]).map((item, i) => {
                    const names = annotations?.[fullPath];
                    const name = names?.[i];
                    const actualIndex = i;

                    return (
                      <div key={actualIndex} className="flex group">
                        <JsonTreeView
                          data={item}
                          depth={depth + 1}
                          isLast={
                            i === (displayItems as unknown[]).length - 1 && remainingCount <= 0
                          }
                          annotations={annotations}
                          path={fullPath}
                          translations={translations}
                          mediaActions={mediaActions}
                        />
                        {name && (
                          <span className="ml-2 text-muted-foreground/60 text-[10px] select-none py-0.5">
                            # {name}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {/* 大数组的展开/折叠控制 */}
                  {isLargeArray && remainingCount > 0 && (
                    <div
                      style={{ marginLeft: `${(depth + 1) * 14}px` }}
                      className="text-xs text-primary cursor-pointer hover:underline py-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        setArrayDisplayCount((prev) =>
                          Math.min(prev + INITIAL_ARRAY_DISPLAY_COUNT, data.length),
                        );
                      }}
                    >
                      {translations.showMore(remainingCount)}
                    </div>
                  )}
                  {isLargeArray && arrayDisplayCount > INITIAL_ARRAY_DISPLAY_COUNT && (
                    <div
                      style={{ marginLeft: `${(depth + 1) * 14}px` }}
                      className="text-xs text-muted-foreground cursor-pointer hover:underline py-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        setArrayDisplayCount(INITIAL_ARRAY_DISPLAY_COUNT);
                      }}
                    >
                      {translations.showLess}
                    </div>
                  )}
                </>
              ) : (
                (displayItems as [string, unknown][]).map(([key, value], i, arr) => {
                  const itemKey = isRawMediaValue(value)
                    ? `${key}:${value.kind}:${value.episodeIndex}`
                    : key;
                  return (
                    <JsonTreeView
                      key={itemKey}
                      label={key}
                      data={value}
                      depth={depth + 1}
                      isLast={i === arr.length - 1}
                      annotations={annotations}
                      path={fullPath}
                      translations={translations}
                      mediaActions={mediaActions}
                    />
                  );
                })
              )}
              <div className="font-mono text-xs leading-5" style={marginStyle}>
                <span>{isArray ? ']' : '}'}</span>
                {!isLast && ','}
              </div>
            </div>
          )}
        </div>
      );
    }

    // 处理原始类型
    let displayValue: string | number | boolean = data as string | number | boolean;
    let colorClass = 'text-foreground';

    if (typeof data === 'string') {
      displayValue = `"${data}"`;
      colorClass = 'text-emerald-600 dark:text-emerald-400';
      if (data.length > 100) {
        displayValue = `"${data.substring(0, 50)}... (${data.length} chars)"`;
      }
    } else if (typeof data === 'number') {
      colorClass = 'text-amber-600 dark:text-amber-400';
      const numStr =
        Number.isFinite(data) && !Number.isInteger(data) ? data.toFixed(4) : String(data);
      displayValue = (data >= 0 ? ' ' : '') + numStr;
    } else if (typeof data === 'boolean') {
      colorClass = 'text-violet-600 dark:text-violet-400';
    }

    return (
      <div style={marginStyle} className="font-mono text-xs leading-5 whitespace-break-spaces">
        {labelNode}
        <span
          className={cn(
            colorClass,
            typeof data === 'number' && Number.isFinite(data) ? 'tabular-nums' : '',
          )}
        >
          {String(displayValue)}
        </span>
        {!isLast ? ',' : ' '}
      </div>
    );
  },
  // 自定义比较：数据/结构/注解/翻译引用未变则跳过渲染，避免无关父级更新导致递归重绘
  (prevProps, nextProps) => {
    if (
      prevProps.data === nextProps.data &&
      prevProps.label === nextProps.label &&
      prevProps.depth === nextProps.depth &&
      prevProps.isLast === nextProps.isLast &&
      prevProps.path === nextProps.path &&
      prevProps.annotations === nextProps.annotations &&
      prevProps.translations === nextProps.translations &&
      prevProps.mediaActions === nextProps.mediaActions
    ) {
      return true;
    }
    return false;
  },
);

JsonTreeView.displayName = 'JsonTreeView';

// ============================================================================
// Header / Tree 拆分为 memo 子组件，避免搜索、下拉等状态触发整树重渲染
// ============================================================================

interface RawPanelHeaderProps {
  isPaused: boolean;
  copied: boolean;
  hasData: boolean;
  selectedFeatures: Set<string>;
  allFeaturesCount: number;
  featureGroups: Array<{ id: string; label: string; items: Array<{ id: string; label: string }> }>;
  featureSearch: string;
  onFeatureSearchChange: (v: string) => void;
  onToggleFeature: (feat: string) => void;
  onSetFeaturesChecked: (featureIds: string[], checked: boolean) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onTogglePause: () => void;
  onManualRefresh: () => void;
  onCopy: () => void;
  allFeaturesLabel: string;
  featuresCountLabel: string;
  selectAllLabel: string;
  searchFeaturePlaceholder: string;
  noSearchResultLabel: string;
  pauseLabel: string;
  resumeLabel: string;
  refreshLabel: string;
  copyLabel: string;
  copiedLabel: string;
}

const RawPanelHeader = memo((props: RawPanelHeaderProps) => {
  const {
    isPaused,
    copied,
    hasData,
    selectedFeatures,
    allFeaturesCount,
    featureGroups,
    featureSearch,
    onFeatureSearchChange,
    onToggleFeature,
    onSetFeaturesChecked,
    onSelectAll,
    onClearAll,
    onTogglePause,
    onManualRefresh,
    onCopy,
    allFeaturesLabel,
    featuresCountLabel,
    selectAllLabel,
    searchFeaturePlaceholder,
    noSearchResultLabel,
    pauseLabel,
    resumeLabel,
    refreshLabel,
    copyLabel,
    copiedLabel,
  } = props;
  const singleFeatureLabel = selectedFeatures.size === 1 ? Array.from(selectedFeatures)[0] : null;
  const headerTitle =
    selectedFeatures.size === allFeaturesCount
      ? allFeaturesLabel
      : selectedFeatures.size === 1
        ? singleFeatureLabel
        : featuresCountLabel;

  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/20">
      <div className="flex items-center gap-2 overflow-hidden mr-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs gap-1 hover:bg-muted/50 outline-none aria-expanded:bg-muted/30"
              />
            }
          >
            <ListFilter className="h-3 w-3" />
            <span className="max-w-[120px] truncate">{headerTitle}</span>
            <ChevronDown className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80 max-h-[70vh] overflow-hidden">
            <HierarchicalFilterList
              groups={featureGroups}
              selectedIds={selectedFeatures}
              searchValue={featureSearch}
              onSearchChange={onFeatureSearchChange}
              onSetItemsChecked={onSetFeaturesChecked}
              onToggleItem={onToggleFeature}
              onSelectAll={onSelectAll}
              onClearAll={onClearAll}
              searchPlaceholder={searchFeaturePlaceholder}
              emptyLabel={noSearchResultLabel}
              selectAllLabel={selectAllLabel}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-6 w-6 hover:bg-accent/50', isPaused && 'text-amber-500')}
                onClick={onTogglePause}
                aria-label={isPaused ? resumeLabel : pauseLabel}
              />
            }
          >
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </TooltipTrigger>
          <TooltipContent>{isPaused ? resumeLabel : pauseLabel}</TooltipContent>
        </Tooltip>
        {isPaused && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 hover:bg-accent/50"
                  onClick={onManualRefresh}
                  aria-label={refreshLabel}
                />
              }
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </TooltipTrigger>
            <TooltipContent>{refreshLabel}</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:bg-accent/50"
                onClick={onCopy}
                disabled={!hasData}
                aria-label={copied ? copiedLabel : copyLabel}
              />
            }
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </TooltipTrigger>
          <TooltipContent>{copied ? copiedLabel : copyLabel}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});
RawPanelHeader.displayName = 'RawPanelHeader';

interface RawPanelTreeBodyProps {
  combinedData: Record<string, unknown> | null;
  featureAnnotations: Record<string, string[]>;
  translations: JsonTreeViewProps['translations'];
  mediaActions: RawMediaActions | undefined;
  selectedCount: number;
  loadingLabel: string;
  noFeatureLabel: string;
  noEpisodeLabel: string;
  hasSelectedEpisode: boolean;
  isStale: boolean;
}

const RawPanelTreeBody = memo((props: RawPanelTreeBodyProps) => {
  const {
    combinedData,
    featureAnnotations,
    translations,
    mediaActions,
    selectedCount,
    loadingLabel,
    noFeatureLabel,
    noEpisodeLabel,
    hasSelectedEpisode,
    isStale,
  } = props;

  if (!hasSelectedEpisode) {
    return <PanelEmptyState message={noEpisodeLabel} />;
  }

  if (!combinedData && selectedCount > 0) {
    return <PanelLoadingState message={loadingLabel} />;
  }

  return (
    <ScrollArea
      className={cn(
        'flex-1 transition-opacity duration-150',
        isStale ? 'opacity-85' : 'opacity-100',
      )}
    >
      <div className="p-3 min-w-fit max-w-full">
        {combinedData ? (
          <JsonTreeView
            data={combinedData}
            annotations={featureAnnotations}
            translations={translations}
            mediaActions={mediaActions}
          />
        ) : selectedCount === 0 ? (
          <PanelEmptyState message={noFeatureLabel} className="py-20" />
        ) : null}
      </div>
    </ScrollArea>
  );
});
RawPanelTreeBody.displayName = 'RawPanelTreeBody';

// ============================================================================
// 主面板组件
// ============================================================================

const RawPanelContent: React.FC<RawPanelProps> = ({ params }) => {
  const { t } = useTranslation();
  const {
    info,
    featureData,
    subscribeFeature,
    unsubscribeFeature,
    subscribeFrameIndex,
    getFrameIndex,
    dataLoader,
    imageService,
    episodes,
  } = useLeRobotData();
  const { selectedEpisodeIndex } = useLeRobotSelection();

  // 状态
  // null 表示用户未手动选择，使用默认预设
  const [userSelectedFeatures, setUserSelectedFeatures] = useState<Set<string> | null>(null);
  const [copied, setCopied] = useState(false);
  const [featureSearch, setFeatureSearch] = useState('');
  const [isPaused, setIsPaused] = useState(false);

  // Refs
  const lastUpdateRef = useRef<number>(0);
  const pendingFrameRef = useRef<number>(0);
  const displayFrameStoreRef = useRef<{ value: number; listeners: Set<() => void> }>({
    value: getFrameIndex(),
    listeners: new Set(),
  });

  const publishDisplayFrameIndex = useCallback((nextFrameIndex: number) => {
    const store = displayFrameStoreRef.current;
    if (store.value === nextFrameIndex) return;
    store.value = nextFrameIndex;
    store.listeners.forEach((listener) => listener());
  }, []);

  const subscribeDisplayFrameIndex = useCallback((listener: () => void) => {
    const listeners = displayFrameStoreRef.current.listeners;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const getDisplayFrameSnapshot = useCallback(() => displayFrameStoreRef.current.value, []);

  const displayFrameIndex = useSyncExternalStore(
    subscribeDisplayFrameIndex,
    getDisplayFrameSnapshot,
    getDisplayFrameSnapshot,
  );

  // 预计算翻译对象，避免每次渲染都创建新对象
  const translations = useMemo(
    () => ({
      undefined: t('panels.raw.undefined'),
      downloadBinary: t('panels.raw.downloadBinary'),
      copyImage: t('panels.raw.copyImage'),
      copyingImage: t('panels.raw.copyingImage'),
      copiedImage: t('panels.raw.copiedImage'),
      downloadedImage: t('panels.raw.downloadedImage'),
      imageDtype: t('panels.raw.imageDtype'),
      videoDtype: t('panels.raw.videoDtype'),
      itemsCount: (count: number) => t('panels.raw.itemsCount', { count }),
      keysCount: (count: number) => t('panels.raw.keysCount', { count }),
      showMore: (count: number) => t('panels.raw.showMore', { count }),
      showLess: t('panels.raw.showLess'),
    }),
    [t],
  );

  // 订阅帧索引变化（优化的节流逻辑）
  useEffect(() => {
    const unsubscribe = subscribeFrameIndex((frameIndex) => {
      // 始终保存最新的帧索引
      pendingFrameRef.current = frameIndex;

      // 如果暂停了，不更新显示
      if (isPaused) return;

      const now = Date.now();
      if (now - lastUpdateRef.current >= AUTO_REFRESH_INTERVAL) {
        lastUpdateRef.current = now;
        startTransition(() => {
          publishDisplayFrameIndex(frameIndex);
        });
      }
    });
    return unsubscribe;
  }, [subscribeFrameIndex, isPaused, publishDisplayFrameIndex]);

  // 手动刷新函数
  const handleManualRefresh = useCallback(() => {
    startTransition(() => {
      publishDisplayFrameIndex(pendingFrameRef.current);
    });
    lastUpdateRef.current = Date.now();
  }, [publishDisplayFrameIndex]);

  // 切换暂停状态
  const togglePause = useCallback(() => {
    setIsPaused((prev) => {
      if (prev) {
        // 恢复时立即更新到最新帧
        startTransition(() => {
          publishDisplayFrameIndex(pendingFrameRef.current);
        });
        lastUpdateRef.current = Date.now();
      }
      return !prev;
    });
  }, [publishDisplayFrameIndex]);

  const allFeatures = useMemo(() => {
    if (!info) return [];
    return Object.keys(info.features).sort();
  }, [info]);

  // 默认选中：URL 指定单 feature 时用该 feature，否则默认全选（与 Chart 面板一致）
  const defaultFeatures = useMemo(() => {
    const featureKey = params?.featureKey;
    if (featureKey) return new Set([featureKey]);
    return new Set(allFeatures);
  }, [allFeatures, params?.featureKey]);

  // 最终使用的特征列表：用户未显式选择时用默认（全选或单 feature）
  const selectedFeatures = useMemo(() => {
    return userSelectedFeatures ?? defaultFeatures;
  }, [userSelectedFeatures, defaultFeatures]);

  // 订阅特征
  useEffect(() => {
    selectedFeatures.forEach((feat) => subscribeFeature(feat));
    return () => {
      selectedFeatures.forEach((feat) => unsubscribeFeature(feat));
    };
  }, [selectedFeatures, subscribeFeature, unsubscribeFeature]);

  // 特征注解映射
  const featureAnnotations = useMemo(() => {
    if (!info) return {};
    const map: Record<string, string[]> = {};
    Object.entries(info.features).forEach(([key, meta]) => {
      if (meta && Array.isArray(meta.names)) {
        map[key] = meta.names;
      }
    });
    return map;
  }, [info]);

  // 组合数据：从 featureData 按当前帧与选中特征聚合，供展示与复制用
  const combinedData = useMemo(() => {
    const result: Record<string, unknown> = {};
    let hasAnyData = false;
    selectedFeatures.forEach((feat) => {
      const displayType = getFeatureDisplayType(info, feat);
      if (selectedEpisodeIndex !== null && (displayType === 'image' || displayType === 'video')) {
        result[feat] = {
          __rawMedia: true,
          kind: displayType,
          featureKey: feat,
          frameIndex: displayFrameIndex,
          episodeIndex: selectedEpisodeIndex,
          fps: info?.fps ?? 30,
        } satisfies RawMediaValue;
        hasAnyData = true;
        return;
      }

      if (featureData[feat]) {
        result[feat] = featureData[feat][displayFrameIndex];
        hasAnyData = true;
      }
    });
    return hasAnyData ? result : null;
  }, [selectedFeatures, featureData, displayFrameIndex, info, selectedEpisodeIndex]);
  const deferredCombinedData = useDeferredValue(combinedData);
  const isTreeStale = deferredCombinedData !== combinedData;
  const selectedEpisode = useMemo(() => {
    if (selectedEpisodeIndex === null) return null;
    return (
      episodes.find((episode) => episode.episode_index === selectedEpisodeIndex) ??
      episodes[selectedEpisodeIndex] ??
      null
    );
  }, [episodes, selectedEpisodeIndex]);

  const mediaActions = useMemo<RawMediaActions | undefined>(() => {
    if (!dataLoader) return undefined;

    return {
      copyImage: async (media) => {
        const filename = getRawMediaFilename(media);
        if (media.kind === 'image') {
          const pathResult = dataLoader.getEpisodeDataPath(media.episodeIndex);
          if (!pathResult) throw new Error(`Episode ${media.episodeIndex} data path not found`);
          const bytes = await imageService.getImageFrameBytes(
            pathResult.path,
            media.featureKey,
            media.frameIndex,
            pathResult.startRow,
          );
          return copyImageBytesAsPng(bytes, filename);
        }

        return copyVideoFrameAsPng(
          dataLoader,
          media.episodeIndex,
          media.featureKey,
          media.frameIndex,
          media.fps,
          filename,
        );
      },
    };
  }, [dataLoader, imageService]);

  // 复制使用原始数据：从 featureData 按帧直接构建，不做 toFixed 等显示层截断，保证粘贴为最原始精度
  const handleCopy = useCallback(() => {
    const rawPayload: Record<string, unknown> = {};
    let hasAny = false;
    selectedFeatures.forEach((feat) => {
      const displayType = getFeatureDisplayType(info, feat);
      if (selectedEpisodeIndex !== null && (displayType === 'image' || displayType === 'video')) {
        const path =
          displayType === 'video'
            ? (dataLoader?.getEpisodeVideoPath(selectedEpisodeIndex, feat)?.path ?? null)
            : (dataLoader?.getEpisodeDataPath(selectedEpisodeIndex)?.path ?? null);
        rawPayload[feat] = buildRawMediaCopyPayload({
          kind: displayType,
          featureKey: feat,
          info,
          episode: selectedEpisode,
          episodeIndex: selectedEpisodeIndex,
          frameIndex: displayFrameIndex,
          path,
        });
        hasAny = true;
        return;
      }

      if (featureData[feat]?.[displayFrameIndex] !== undefined) {
        rawPayload[feat] = featureData[feat][displayFrameIndex];
        hasAny = true;
      }
    });
    if (!hasAny) return;

    const replacer = (_key: string, value: unknown): unknown =>
      value instanceof Uint8Array ? `<binary (${value.length} bytes)>` : value;
    navigator.clipboard.writeText(JSON.stringify(rawPayload, replacer, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [
    featureData,
    selectedFeatures,
    displayFrameIndex,
    info,
    selectedEpisodeIndex,
    selectedEpisode,
    dataLoader,
  ]);

  const toggleFeature = useCallback(
    (feat: string) => {
      setUserSelectedFeatures((prev) => {
        const current = prev ?? defaultFeatures;
        const next = new Set(current);
        if (next.has(feat)) next.delete(feat);
        else next.add(feat);
        return next;
      });
    },
    [defaultFeatures],
  );

  const selectAll = useCallback(() => setUserSelectedFeatures(new Set(allFeatures)), [allFeatures]);
  const clearAll = useCallback(() => setUserSelectedFeatures(new Set()), []);
  const featureGroups = useMemo(() => groupFeatureKeys(allFeatures), [allFeatures]);
  const setFeaturesChecked = useCallback(
    (featureIds: string[], checked: boolean) => {
      setUserSelectedFeatures((prev) => {
        const current = prev ?? defaultFeatures;
        return applyGroupSelection(current, featureIds, checked);
      });
    },
    [defaultFeatures],
  );

  const handleFeatureSearchChange = useCallback((v: string) => setFeatureSearch(v), []);

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <RawPanelHeader
        isPaused={isPaused}
        copied={copied}
        hasData={!!combinedData}
        selectedFeatures={selectedFeatures}
        allFeaturesCount={allFeatures.length}
        featureGroups={featureGroups}
        featureSearch={featureSearch}
        onFeatureSearchChange={handleFeatureSearchChange}
        onToggleFeature={toggleFeature}
        onSetFeaturesChecked={setFeaturesChecked}
        onSelectAll={selectAll}
        onClearAll={clearAll}
        onTogglePause={togglePause}
        onManualRefresh={handleManualRefresh}
        onCopy={handleCopy}
        allFeaturesLabel={t('panels.raw.allFeatures')}
        featuresCountLabel={
          selectedFeatures.size > 0
            ? t('panels.raw.featuresCount', { count: selectedFeatures.size })
            : t('panels.raw.none')
        }
        selectAllLabel={t('panels.raw.selectAll')}
        searchFeaturePlaceholder={t('panels.raw.searchFeature')}
        noSearchResultLabel={t('panels.raw.noSearchResult')}
        pauseLabel={t('panels.raw.pause')}
        resumeLabel={t('panels.raw.resume')}
        refreshLabel={t('panels.raw.refresh')}
        copyLabel={t('common.copy')}
        copiedLabel={t('common.copied')}
      />
      <RawPanelTreeBody
        combinedData={deferredCombinedData}
        featureAnnotations={featureAnnotations}
        translations={translations}
        mediaActions={mediaActions}
        selectedCount={selectedFeatures.size}
        loadingLabel={t('panels.raw.loading')}
        noFeatureLabel={t('panels.raw.no_feature')}
        noEpisodeLabel={t('playback.noData')}
        hasSelectedEpisode={selectedEpisodeIndex !== null}
        isStale={isTreeStale}
      />
    </div>
  );
};

export const RawPanel: React.FC<RawPanelProps> = RawPanelContent;
