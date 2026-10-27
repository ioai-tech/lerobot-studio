import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type {
  LeRobotInfo,
  EpisodeMetadata,
  FrameData,
  LeRobotFeature,
  PlaybackMode,
  SubtaskTable,
  EpisodeTrimRange,
} from '@/core';
import type { LeRobotDataLoader } from '@/platform';
import type { NumericalColumnMap } from '@/platform';
import type { DataSource } from '@/platform';
import type { ValidationReport } from '@/core';
import { DirectoryDataSource } from '@/platform';
import { useTranslation } from '../i18n/reactI18nextCompat';
import { useLoading } from './LoadingContext';
import {
  LeRobotContext,
  LeRobotDataContext,
  LeRobotPlaybackContext,
  LeRobotSelectionContext,
  LeRobotUiContext,
  LeRobotSubtaskContext,
  type FrameIndexSubscriber,
  type TrimPreviewHandlers,
} from './LeRobotContext';
import { useSubtaskAnnotation } from './useSubtaskAnnotation';
import {
  buildPlaybackFrames,
  getEagerEpisodeColumns,
  getFirstAvailableEpisodeIndex,
  lastUnlabeledGap,
} from '@/core';
import { createParquetImageService, type ParquetImageServiceImpl } from '@/platform';
import { getImageFeatureNames } from '@/core';
import { useEpisodeView } from './useEpisodeView';
import { materializeNumericFeatureRows, useFeatureSubscriptions } from './useFeatureSubscriptions';
import { usePlaybackBridge } from './usePlaybackBridge';
import { MediaSync } from '../services/MediaSync';
import { VideoStage } from '../services/video/VideoStage';
import { VideoStageContext } from './VideoStageContext';

/**
 * 规范化 info.features 中的 names 字段
 * 将二维数组 names（如 [["a", "b"]]）展平为一维数组（["a", "b"]）
 * 确保后续代码可以统一按一维数组处理
 */
function normalizeInfoNames(info: LeRobotInfo): LeRobotInfo {
  const normalizedFeatures: Record<string, LeRobotFeature> = {};

  for (const [key, feature] of Object.entries(info.features)) {
    if (feature && feature.names && Array.isArray(feature.names)) {
      // 检测是否为嵌套数组（如 [["a", "b", "c"]]）
      const isNestedArray = feature.names.some((item) => Array.isArray(item));
      if (isNestedArray) {
        // 展平为一维数组，并过滤非字符串元素
        const flatNames = feature.names
          .flat(2)
          .filter((item): item is string => typeof item === 'string');
        normalizedFeatures[key] = {
          ...feature,
          names: flatNames.length > 0 ? flatNames : null,
        };
      } else {
        // 已经是一维数组，但确保所有元素都是字符串
        const validNames = feature.names.filter((item): item is string => typeof item === 'string');
        normalizedFeatures[key] = {
          ...feature,
          names: validNames.length > 0 ? validNames : null,
        };
      }
    } else {
      normalizedFeatures[key] = feature;
    }
  }

  return {
    ...info,
    features: normalizedFeatures,
  };
}

export const LeRobotDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dataLoader, setDataLoader] = useState<LeRobotDataLoader | null>(null);
  const imageServiceRef = useRef<ParquetImageServiceImpl | null>(null);
  const [imageService, setImageService] = useState(() => {
    const service = createParquetImageService();
    imageServiceRef.current = service;
    return service;
  });
  const [info, setInfo] = useState<LeRobotInfo | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeMetadata[]>([]);
  const [tasks, setTasks] = useState<Record<number, string>>({});
  const [sourceSubtasks, setSourceSubtasks] = useState<SubtaskTable>({});
  const [sourceSubtaskIndices, setSourceSubtaskIndices] = useState<Array<number | null>>([]);
  const [subtaskDialogOpen, setSubtaskDialogOpen] = useState(false);
  const [trimEditMode, setTrimEditMode] = useState(false);
  const [trimSuggestion, setTrimSuggestion] = useState<{
    episodeIndex: number;
    range: EpisodeTrimRange;
  } | null>(null);
  const trimPreviewHandlersRef = useRef<TrimPreviewHandlers>({
    returnFromPreview: () => setTrimSuggestion(null),
    cancelPreview: () => setTrimSuggestion(null),
  });
  const setTrimPreviewHandlers = useCallback((handlers: TrimPreviewHandlers | null) => {
    trimPreviewHandlersRef.current = handlers ?? {
      returnFromPreview: () => setTrimSuggestion(null),
      cancelPreview: () => setTrimSuggestion(null),
    };
  }, []);
  const returnFromTrimPreview = useCallback(() => {
    trimPreviewHandlersRef.current.returnFromPreview();
  }, []);
  const cancelTrimPreview = useCallback(() => {
    trimPreviewHandlersRef.current.cancelPreview();
  }, []);
  const [previewTrim, setPreviewTrim] = useState(false);
  const [episodeEditMode, setEpisodeEditMode] = useState(false);
  const [selectedEpisodeIndex, setSelectedEpisodeIndex] = useState<number | null>(null);
  /** The episode whose frames, charts and subtasks are loaded (lags the selection while loading). */
  const [loadedEpisodeIndex, setLoadedEpisodeIndex] = useState<number | null>(null);
  const [currentFrames, setCurrentFrames] = useState<FrameData[]>([]);
  const [chartData, setChartData] = useState<NumericalColumnMap>({});
  const [featureData, setFeatureData] = useState<Record<string, unknown[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('sequential');
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [lastValidationReport, setLastValidationReport] = useState<ValidationReport | null>(null);
  const [healthDialogOpen, setHealthDialogOpen] = useState(false);

  const { t } = useTranslation();
  // Keep t out of callback deps so a locale switch never re-triggers dataset loading.
  const tRef = useRef(t);
  tRef.current = t;
  const {
    upsertTask,
    completeTask,
    failTask,
    clear: clearLoading,
    tasks: loadingTasks,
  } = useLoading();

  // 状态锁：避免在加载过程中进行敏感操作
  const isBusy =
    isLoading ||
    !!loadingTasks.find((t) => t.phase !== 'ready' && t.phase !== 'idle' && t.phase !== 'error');
  const versionCapability = dataLoader?.getVersionCapability() ?? null;
  const isReadOnly = versionCapability?.status === 'read-only';
  const {
    trimRanges,
    setTrimRanges,
    trimEpisode,
    trimEpisodes,
    modifiedEpisodes,
    setModifiedEpisodes,
    deletedEpisodes,
    setDeletedEpisodes,
    selectedEpisodeIndices,
    setSelectedEpisodeIndices,
    effectiveEpisodes,
    episodesForExport,
    editEpisodeTask,
    deleteEpisode,
    restoreEpisode,
    getEffectiveEpisode,
    toggleEpisodeSelection,
    selectAllInList,
    clearEpisodeSelection,
  } = useEpisodeView({ episodes, versionCapability });

  const subtask = useSubtaskAnnotation({
    versionCapability,
    // the segments belong to the frames on screen: the old episode's until the new one loaded
    selectedEpisodeIndex: loadedEpisodeIndex,
    episodeLength: currentFrames.length,
    sourceTable: sourceSubtasks,
    sourceIndices: sourceSubtaskIndices,
  });
  const resetSubtasks = subtask.resetSubtasks;

  // 使用 ref 跟踪当前数据源和加载器，用于清理和防止重复加载
  const dataLoaderRef = useRef<LeRobotDataLoader | null>(null);
  const currentSourceRef = useRef<DataSource | FileSystemDirectoryHandle | null>(null);
  const failedSourcesRef = useRef<Set<DataSource | FileSystemDirectoryHandle>>(new Set());
  const isLoadingRef = useRef(false);
  /** Monotonic generation so A→B opens discard stale init results. */
  const initGenerationRef = useRef(0);

  // 高性能播放：使用ref存储帧索引，避免触发React渲染
  const frameIndexRef = useRef(0);
  const [mediaSync] = useState(() => new MediaSync());
  const [videoStage] = useState(() => new VideoStage(mediaSync, () => frameIndexRef.current));
  const episodeLoadAbortRef = useRef<AbortController | null>(null);
  /** Numeric columns of the next episode, read ahead while the current one plays. */
  const prefetchedEpisodeRef = useRef<{
    index: number;
    loader: LeRobotDataLoader;
    data: Promise<NumericalColumnMap>;
  } | null>(null);
  const frameSubscribersRef = useRef<Set<FrameIndexSubscriber>>(new Set());
  const selectEpisodeRef = useRef<(episodeIndex: number) => Promise<boolean>>(async () => false);
  const shouldHoldAtEpisodeEndRef = useRef<() => boolean>(() => false);
  const onNaturalEndRef = useRef<() => void>(() => undefined);
  shouldHoldAtEpisodeEndRef.current = () => subtask.canAnnotate && episodeEditMode;
  onNaturalEndRef.current = () => {
    if (!(subtask.canAnnotate && episodeEditMode) || trimEditMode || trimSuggestion) return;
    const gap = lastUnlabeledGap(subtask.currentSegments, currentFrames.length);
    if (!gap) return;
    if (subtask.beginPendingRange(gap.startFrame, gap.endFrame)) {
      setSubtaskDialogOpen(true);
    }
  };

  // 卸载时清理资源
  useEffect(() => {
    return () => {
      // the episode load in flight is no longer current: it must not report the worker it loses
      episodeLoadAbortRef.current?.abort();
      // 这里的 reset 是异步的，但在卸载时我们主要关心同步清理（如 worker terminate 和 ObjectURL 撤销）
      // DataLoader.dispose 会处理这些。
      if (dataLoaderRef.current) {
        dataLoaderRef.current.dispose().catch((err) => console.warn('Unmount dispose error:', err));
      }
      imageServiceRef.current
        ?.dispose()
        .catch((err) => console.warn('Unmount image dispose error:', err));
    };
  }, []);

  const loadingEpisodeRef = useRef<number | null>(null);
  const episodeLoadingRef = useRef(false);

  // 高性能帧索引订阅API
  const subscribeFrameIndex = useCallback((callback: FrameIndexSubscriber) => {
    frameSubscribersRef.current.add(callback);
    // 延迟到微任务，避免订阅方在同一调用栈里读取到尚未稳定的闭包状态。
    queueMicrotask(() => {
      if (!frameSubscribersRef.current.has(callback)) return;
      callback(frameIndexRef.current);
    });
    return () => {
      frameSubscribersRef.current.delete(callback);
    };
  }, []);

  const getFrameIndex = useCallback(() => {
    return frameIndexRef.current;
  }, []);

  // 通知所有帧索引订阅者（不触发React渲染！）
  const notifyFrameSubscribers = useCallback((newIndex: number) => {
    frameSubscribersRef.current.forEach((callback) => {
      try {
        callback(newIndex);
      } catch (e) {
        console.error('Frame subscriber error:', e);
      }
    });
  }, []);

  // The cameras follow the playhead (paused seeks, scrubbing) and live as long as the provider.
  useEffect(() => videoStage.connectFrames(subscribeFrameIndex), [videoStage, subscribeFrameIndex]);
  useEffect(() => () => videoStage.dispose(), [videoStage]);

  const setScrubbing = useCallback(
    (scrubbing: boolean) => videoStage.setScrubbing(scrubbing),
    [videoStage],
  );

  const {
    subscribeFeature,
    unsubscribeFeature,
    clearPendingFeatureLoads,
    getSubscribedFeatureNames,
  } = useFeatureSubscriptions({
    selectedEpisodeIndex,
    dataLoader,
    info,
    chartData,
    featureData,
    setFeatureData,
    episodeLoadingRef,
  });

  const {
    currentFrameIndex,
    setCurrentFrameIndex,
    isPlaying,
    setIsPlaying,
    setFrameIndex,
    togglePlay,
    setPlaying,
    seek,
    peekNextEpisode,
  } = usePlaybackBridge({
    mediaSync,
    videoStage,
    isBusy,
    frameCount: currentFrames.length,
    frameIndexRef,
    notifyFrameSubscribers,
    fps: info?.fps,
    playbackSpeed,
    playbackMode,
    episodes,
    selectedEpisodeIndex,
    deletedEpisodes,
    selectEpisodeRef,
    shouldHoldAtEpisodeEndRef,
    onNaturalEndRef,
    previewRange:
      trimSuggestion?.episodeIndex === selectedEpisodeIndex
        ? trimSuggestion.range
        : previewTrim && selectedEpisodeIndex != null
          ? trimRanges.get(selectedEpisodeIndex)
          : undefined,
  });
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  /** The selection whose autoplay is still to happen (see `consumeEpisodeAutoplay`). */
  const autoplayRef = useRef<{ episode: number | null; play: boolean }>({
    episode: null,
    play: true,
  });
  // a new dataset autoplays its first episode again
  useEffect(() => {
    autoplayRef.current = { episode: null, play: true };
  }, [dataLoader]);
  const consumeEpisodeAutoplay = useCallback((episodeIndex: number | null) => {
    const intent = autoplayRef.current;
    if (episodeIndex === null || intent.episode !== episodeIndex || !intent.play) return false;
    autoplayRef.current = { episode: episodeIndex, play: false };
    return true;
  }, []);

  const reset = useCallback(async () => {
    // 清理旧资源，回到欢迎页；bump generation 使在途 initialize 失效
    initGenerationRef.current += 1;
    try {
      if (dataLoaderRef.current) {
        await dataLoaderRef.current.dispose();
      }
    } catch (e) {
      console.warn('Failed to dispose previous loader', e);
    }
    try {
      await imageServiceRef.current?.dispose();
    } catch (e) {
      console.warn('Failed to dispose previous image service', e);
    }
    const nextImageService = createParquetImageService();
    imageServiceRef.current = nextImageService;
    setImageService(nextImageService);
    dataLoaderRef.current = null;
    currentSourceRef.current = null;
    failedSourcesRef.current.clear();
    isLoadingRef.current = false;
    setDataLoader(null);
    setInfo(null);
    setEpisodes([]);
    setTasks({});
    setSourceSubtasks({});
    setSourceSubtaskIndices([]);
    setSubtaskDialogOpen(false);
    setEpisodeEditMode(false);
    setTrimEditMode(false);
    setPreviewTrim(false);
    setTrimRanges(new Map());
    setTrimSuggestion(null);
    resetSubtasks();
    setModifiedEpisodes(new Map());
    setDeletedEpisodes(new Set());
    setSelectedEpisodeIndex(null);
    setLoadedEpisodeIndex(null);
    episodeLoadAbortRef.current?.abort();
    prefetchedEpisodeRef.current = null;
    setSelectedEpisodeIndices(new Set());
    setCurrentFrames([]);
    setChartData({});
    setFeatureData({});
    setCurrentFrameIndex(0);
    frameIndexRef.current = 0;
    notifyFrameSubscribers(0);
    clearPendingFeatureLoads();
    setIsPlaying(false);
    setError(null);
    clearLoading();
    setLastValidationReport(null);
    setHealthDialogOpen(false);
  }, [
    notifyFrameSubscribers,
    clearLoading,
    clearPendingFeatureLoads,
    setModifiedEpisodes,
    setDeletedEpisodes,
    setSelectedEpisodeIndices,
    setCurrentFrameIndex,
    setIsPlaying,
    resetSubtasks,
    setTrimRanges,
  ]);

  const initialize = useCallback(
    async (dataSource: DataSource | FileSystemDirectoryHandle) => {
      // 如果已经在初始化同一个源，或者这个源之前失败过，跳过
      if (
        currentSourceRef.current === dataSource &&
        (dataLoaderRef.current || isLoadingRef.current)
      ) {
        return;
      }

      if (failedSourcesRef.current.has(dataSource)) {
        console.log('Skipping initialization for previously failed source');
        return;
      }

      const generation = ++initGenerationRef.current;
      isLoadingRef.current = true;
      setIsLoading(true);
      setError(null);
      const taskId = 'lerobot-init';
      upsertTask({
        id: taskId,
        phase: 'index',
        message: tRef.current('loading.message.initLoader'),
      });

      let loader: LeRobotDataLoader | null = null;
      try {
        // 先清理旧数据源
        if (dataLoaderRef.current) {
          await dataLoaderRef.current.dispose();
        }
        if (generation !== initGenerationRef.current) {
          return;
        }
        dataLoaderRef.current = null;
        setDataLoader(null);
        setInfo(null);
        setEpisodes([]);
        setTasks({});
        setSourceSubtasks({});
        setSourceSubtaskIndices([]);
        setSubtaskDialogOpen(false);
        setEpisodeEditMode(false);
        setTrimEditMode(false);
        setPreviewTrim(false);
        setTrimRanges(new Map());
        setTrimSuggestion(null);
        resetSubtasks();
        setModifiedEpisodes(new Map());
        setDeletedEpisodes(new Set());
        setSelectedEpisodeIndex(null);
        setLoadedEpisodeIndex(null);
        episodeLoadAbortRef.current?.abort();
        prefetchedEpisodeRef.current = null;
        setCurrentFrames([]);
        setChartData({});
        setFeatureData({});
        setCurrentFrameIndex(0);
        frameIndexRef.current = 0;
        notifyFrameSubscribers(0);
        setIsPlaying(false);

        currentSourceRef.current = dataSource;

        const source =
          'getDirectoryHandle' in dataSource
            ? new DirectoryDataSource(dataSource as FileSystemDirectoryHandle)
            : dataSource;
        await imageServiceRef.current?.dispose();
        const nextImageService = createParquetImageService();
        nextImageService.setDataSource(source);
        imageServiceRef.current = nextImageService;
        setImageService(nextImageService);

        // 首屏优化：把重依赖（apache-arrow/worker 等）延迟到用户真正打开数据源时再加载
        const { LeRobotDataLoader: LeRobotDataLoaderCtor } =
          await import('../../platform/services/LeRobotDataLoader');
        loader = new LeRobotDataLoaderCtor(source);

        upsertTask({
          id: taskId,
          phase: 'read',
          message: tRef.current('loading.message.readMetadata'),
        });
        const lerobotInfo = await loader.initialize();
        if (generation !== initGenerationRef.current) {
          await loader.dispose().catch(() => {});
          return;
        }
        const episodes = loader.getEpisodes();

        dataLoaderRef.current = loader;
        setDataLoader(loader);
        setLastValidationReport(loader.getValidationReport());
        // 规范化 names 字段（将二维数组展平为一维）
        const normalizedInfo = normalizeInfoNames(lerobotInfo);
        setInfo(normalizedInfo);
        setEpisodes(episodes);
        setTasks(loader.getTasks());
        setSourceSubtasks(loader.getSubtasks());
        completeTask(taskId);
        failedSourcesRef.current.delete(dataSource);
      } catch (e) {
        if (generation !== initGenerationRef.current) {
          await loader?.dispose().catch(() => {});
          return;
        }
        console.error('Failed to initialize LeRobot data loader', e);
        failedSourcesRef.current.add(dataSource);
        const msg = e instanceof Error ? e.message : 'Unknown error during initialization';
        setError(msg);
        failTask(taskId, msg);
        const report = loader?.getValidationReport?.() ?? null;
        if (report?.items?.length) {
          setLastValidationReport(report);
          setHealthDialogOpen(true);
        }
      } finally {
        if (generation === initGenerationRef.current) {
          isLoadingRef.current = false;
          setIsLoading(false);
        }
      }
    },
    [
      upsertTask,
      completeTask,
      failTask,
      notifyFrameSubscribers,
      setModifiedEpisodes,
      setDeletedEpisodes,
      setCurrentFrameIndex,
      setIsPlaying,
      resetSubtasks,
      setTrimRanges,
    ],
  );

  // 宽数据集的其余数值列：图表选中时再按 Range 读取，并合并进 chartData。
  const chartDataRef = useRef(chartData);
  chartDataRef.current = chartData;
  const chartColumnLoadsRef = useRef(new Set<string>());
  const ensureChartColumns = useCallback(
    (featureKeys: string[]) => {
      const index = loadingEpisodeRef.current;
      if (!dataLoader || index === null || index === undefined) return;
      const loads = chartColumnLoadsRef.current;
      const missing = featureKeys.filter(
        (key) => chartDataRef.current[key] === undefined && !loads.has(`${index}:${key}`),
      );
      if (missing.length === 0) return;
      missing.forEach((key) => loads.add(`${index}:${key}`));
      dataLoader
        .loadAllNumericalData(index, missing)
        .then((data) => {
          if (loadingEpisodeRef.current !== index) return;
          setChartData((previous) => ({ ...previous, ...data }));
        })
        .catch((e) => console.error(`Failed to load chart columns for episode ${index}`, e))
        .finally(() => missing.forEach((key) => loads.delete(`${index}:${key}`)));
    },
    [dataLoader],
  );

  const selectEpisode = useCallback(
    async (index: number) => {
      if (!dataLoader || !info) return false;
      // The previous episode's load is no longer needed: cancel its Range requests.
      episodeLoadAbortRef.current?.abort();
      const controller = new AbortController();
      episodeLoadAbortRef.current = controller;
      const { signal } = controller;
      // the latest call owns the loading state (two calls for the same episode: auto-advance + click)
      const isCurrent = () => episodeLoadAbortRef.current === controller && !signal.aborted;

      // the first episode autoplays; later ones play on only when chosen while playing
      autoplayRef.current = {
        episode: index,
        play: autoplayRef.current.episode === null || isPlayingRef.current,
      };
      setIsLoading(true);
      setIsPlaying(false);
      setError(null);
      const taskId = 'lerobot-select-episode';
      upsertTask({
        id: taskId,
        phase: 'read',
        message: tRef.current('loading.message.loadEpisode', { index }),
      });

      // The cameras switch first (their ranges change before the frame index is announced), so no
      // camera seeks the old episode's file to the new episode's frame. Charts, frames and subtasks
      // keep showing the old episode (dimmed) until the new one is loaded, then swap at once.
      loadingEpisodeRef.current = index;
      episodeLoadingRef.current = true;
      frameIndexRef.current = 0;
      videoStage.selectEpisode(index);
      setSelectedEpisodeIndex(index);
      setCurrentFrameIndex(0);
      notifyFrameSubscribers(0);

      // 若新 episode 对应的 parquet 与当前缓存不同（v3 分片 / v2.1 多文件），释放整文件解析缓存
      // （主线程 Arrow Table + worker 整文件表）；Range footer 与块缓存保留，切换保持温热。
      try {
        const nextPath = dataLoader.getEpisodeDataPath(index)?.path ?? null;
        if (nextPath && !dataLoader.isFileBytesCached(nextPath)) {
          await dataLoader.releaseParsedCaches();
        }
        imageService.clearPreload();
      } catch {
        // 非致命，继续加载流程
      }

      try {
        const eagerColumns = getEagerEpisodeColumns(info);
        const eagerSet = new Set(eagerColumns);
        upsertTask({
          id: taskId,
          phase: 'read',
          message: tRef.current('loading.message.fetchFrames', { index }),
        });

        const prefetched = prefetchedEpisodeRef.current;
        prefetchedEpisodeRef.current = null;
        const numericLoad =
          prefetched && prefetched.index === index && prefetched.loader === dataLoader
            ? prefetched.data.catch(() =>
                dataLoader.loadAllNumericalData(index, eagerColumns, { signal }),
              )
            : dataLoader.loadAllNumericalData(index, eagerColumns, { signal });
        // Subscribed features outside the eager columns load in parallel with them.
        const subscribedFeatures = getSubscribedFeatureNames(info);
        const extraFeatures = subscribedFeatures.filter((name) => !eagerSet.has(name));
        const [numericalData, subtaskSource, extraFeatureData] = await Promise.all([
          numericLoad,
          dataLoader.loadEpisodeSubtaskSource(index, { signal }),
          extraFeatures.length > 0
            ? dataLoader.loadFeatureData(index, extraFeatures, { signal })
            : Promise.resolve({} as Record<string, unknown[]>),
        ]);

        if (!isCurrent()) return false;

        upsertTask({
          id: taskId,
          phase: 'render',
          message: tRef.current('loading.message.processCharts'),
        });
        const frames = buildPlaybackFrames(numericalData, info.fps ?? 30);
        const featureRows: Record<string, unknown[]> = { ...extraFeatureData };
        for (const name of subscribedFeatures) {
          if (name in numericalData) {
            featureRows[name] = materializeNumericFeatureRows(numericalData[name]);
          }
        }
        // one render: frames, charts, subtasks and raw rows of the new episode together
        setCurrentFrames(frames);
        setChartData(numericalData);
        setSourceSubtaskIndices(subtaskSource.indices);
        setSourceSubtasks((previous) => ({ ...previous, ...subtaskSource.table }));
        setFeatureData(featureRows);
        setLoadedEpisodeIndex(index);
        completeTask(taskId);

        // 触发图像预加载（后台异步，不阻塞播放）
        // 仅对 image dtype 的特征有效（video dtype 使用 <video> 元素，无需预加载）
        const imageFeatureNames = getImageFeatureNames(info);
        if (imageFeatureNames.length > 0) {
          const pathResult = dataLoader.getEpisodeDataPath(index);
          if (pathResult) {
            const { path, startRow, endRow } = pathResult;
            const firstColumn = imageFeatureNames[0];
            const episodeKey = `${index}:${firstColumn}`;

            // 先确保 Worker 已加载文件（Comlink 路径），再触发预加载
            imageService
              .ensureFileLoaded(path, firstColumn)
              .then(() => {
                if (loadingEpisodeRef.current !== index) return;
                return imageService.preloadEpisode(firstColumn, startRow, endRow, episodeKey);
              })
              .catch((e) => {
                // 预加载失败不影响正常播放，回退到按需加载
                console.warn('Image preload failed, falling back to on-demand loading:', e);
              });
          }
        }
        return isCurrent();
      } catch (e) {
        if (isCurrent()) {
          console.error('Failed to load episode data', e);
          const msg = e instanceof Error ? e.message : 'Unknown error while loading episode';
          setError(msg);
          failTask(taskId, msg);
        }
        return false;
      } finally {
        if (isCurrent()) {
          episodeLoadingRef.current = false;
          setIsLoading(false);
        }
      }
    },
    [
      dataLoader,
      imageService,
      info,
      upsertTask,
      completeTask,
      failTask,
      notifyFrameSubscribers,
      getSubscribedFeatureNames,
      setCurrentFrameIndex,
      setIsPlaying,
      videoStage,
    ],
  );
  selectEpisodeRef.current = selectEpisode;

  useEffect(() => {
    videoStage.setDataset(dataLoader, info);
  }, [videoStage, dataLoader, info]);

  // Read the next episode ahead: its footer and numeric columns now, its videos when playback gets
  // close to the end (or after a short idle while paused).
  useEffect(() => {
    if (!dataLoader || !info || loadedEpisodeIndex === null || isLoading) return;
    if (loadedEpisodeIndex !== selectedEpisodeIndex) return;
    const next = peekNextEpisode();
    if (next < 0) {
      videoStage.schedulePrefetch(null);
      return;
    }
    videoStage.schedulePrefetch(next);
    if (next === loadedEpisodeIndex) return; // loop: the data is already here
    const current = prefetchedEpisodeRef.current;
    if (current && current.index === next && current.loader === dataLoader) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void dataLoader.prefetchEpisode(next, { signal: controller.signal });
      const data = dataLoader.loadAllNumericalData(next, getEagerEpisodeColumns(info), {
        signal: controller.signal,
      });
      data.catch(() => {
        if (prefetchedEpisodeRef.current?.data === data) prefetchedEpisodeRef.current = null;
      });
      prefetchedEpisodeRef.current = { index: next, loader: dataLoader, data };
    }, 300);
    return () => {
      window.clearTimeout(timer);
      // keep a finished or running prefetch for the episode it belongs to; drop the rest
      const pending = prefetchedEpisodeRef.current;
      if (!pending || pending.index !== next) controller.abort();
    };
  }, [
    dataLoader,
    info,
    loadedEpisodeIndex,
    selectedEpisodeIndex,
    isLoading,
    playbackMode,
    episodes,
    deletedEpisodes,
    peekNextEpisode,
    videoStage,
  ]);

  const clearError = useCallback(() => {
    setError(null);
    failedSourcesRef.current.clear();
  }, []);

  // 当当前选中的 episode 被删除时，切换到第一个未删除的
  useEffect(() => {
    if (
      selectedEpisodeIndex !== null &&
      deletedEpisodes.has(selectedEpisodeIndex) &&
      dataLoader &&
      info &&
      !isLoading
    ) {
      const firstNonDeleted = episodes.find((e) => !deletedEpisodes.has(e.episode_index));
      if (firstNonDeleted) {
        selectEpisode(firstNonDeleted.episode_index);
      } else {
        setSelectedEpisodeIndex(null);
        setLoadedEpisodeIndex(null);
        setCurrentFrames([]);
        setChartData({});
        setFeatureData({});
      }
    }
  }, [deletedEpisodes, selectedEpisodeIndex, episodes, dataLoader, info, isLoading, selectEpisode]);

  // 数据集初始化后自动选中首个可用 episode，但把重型 parquet 读取延后到首屏布局已渲染之后。
  useEffect(() => {
    if (
      selectedEpisodeIndex !== null ||
      !dataLoader ||
      !info ||
      isLoading ||
      episodes.length === 0
    ) {
      return;
    }

    const firstEpisodeIndex = getFirstAvailableEpisodeIndex(episodes, deletedEpisodes);
    if (firstEpisodeIndex === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      void selectEpisode(firstEpisodeIndex);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [selectedEpisodeIndex, dataLoader, info, isLoading, episodes, deletedEpisodes, selectEpisode]);

  const dataValue = useMemo(
    () => ({
      info,
      versionCapability,
      isReadOnly,
      featureData,
      subscribeFeature,
      unsubscribeFeature,
      subscribeFrameIndex,
      getFrameIndex,
      dataLoader,
      imageService,
      mediaSync,
      episodes,
      tasks,
      subtasks: sourceSubtasks,
      lastValidationReport,
      initialize,
      reset,
      clearError,
      error,
      isLoading,
    }),
    [
      info,
      versionCapability,
      isReadOnly,
      featureData,
      subscribeFeature,
      unsubscribeFeature,
      subscribeFrameIndex,
      getFrameIndex,
      dataLoader,
      imageService,
      mediaSync,
      episodes,
      tasks,
      sourceSubtasks,
      lastValidationReport,
      initialize,
      reset,
      clearError,
      error,
      isLoading,
    ],
  );

  const selectionValue = useMemo(
    () => ({
      trimRanges,
      trimEpisode,
      trimEpisodes,
      selectedEpisodeIndex,
      selectedEpisodeIndices,
      toggleEpisodeSelection,
      setSelectedEpisodeIndices,
      selectAllInList,
      clearEpisodeSelection,
      deletedEpisodes,
      modifiedEpisodes,
      effectiveEpisodes,
      episodesForExport,
      editEpisodeTask,
      deleteEpisode,
      restoreEpisode,
      getEffectiveEpisode,
      selectEpisode,
    }),
    [
      trimRanges,
      trimEpisode,
      trimEpisodes,
      selectedEpisodeIndex,
      selectedEpisodeIndices,
      toggleEpisodeSelection,
      setSelectedEpisodeIndices,
      selectAllInList,
      clearEpisodeSelection,
      deletedEpisodes,
      modifiedEpisodes,
      effectiveEpisodes,
      episodesForExport,
      editEpisodeTask,
      deleteEpisode,
      restoreEpisode,
      getEffectiveEpisode,
      selectEpisode,
    ],
  );

  const pendingEpisodeIndex =
    selectedEpisodeIndex !== null && selectedEpisodeIndex !== loadedEpisodeIndex
      ? selectedEpisodeIndex
      : null;

  const playbackValue = useMemo(
    () => ({
      currentFrames,
      loadedEpisodeIndex,
      pendingEpisodeIndex,
      setScrubbing,
      chartData,
      ensureChartColumns,
      currentFrameIndex,
      isPlaying,
      playbackMode,
      playbackSpeed,
      setFrameIndex,
      togglePlay,
      setPlaying,
      consumeEpisodeAutoplay,
      seek,
      setPlaybackMode,
      setPlaybackSpeed,
    }),
    [
      currentFrames,
      loadedEpisodeIndex,
      pendingEpisodeIndex,
      setScrubbing,
      chartData,
      ensureChartColumns,
      currentFrameIndex,
      isPlaying,
      playbackMode,
      playbackSpeed,
      setFrameIndex,
      togglePlay,
      setPlaying,
      consumeEpisodeAutoplay,
      seek,
    ],
  );

  const uiValue = useMemo(
    () => ({
      trimSuggestion,
      setTrimSuggestion,
      returnFromTrimPreview,
      cancelTrimPreview,
      setTrimPreviewHandlers,
      trimEditMode,
      setTrimEditMode,
      previewTrim,
      setPreviewTrim,
      healthDialogOpen,
      setHealthDialogOpen,
      subtaskDialogOpen,
      setSubtaskDialogOpen,
      episodeEditMode,
      setEpisodeEditMode,
    }),
    [
      healthDialogOpen,
      subtaskDialogOpen,
      episodeEditMode,
      trimEditMode,
      previewTrim,
      trimSuggestion,
      returnFromTrimPreview,
      cancelTrimPreview,
      setTrimPreviewHandlers,
    ],
  );

  const subtaskValue = useMemo(
    () => ({
      canAnnotate: subtask.canAnnotate,
      overlay: subtask.overlay,
      currentSegments: subtask.currentSegments,
      knownLabels: subtask.knownLabels,
      coverage: subtask.coverage,
      pendingRange: subtask.pendingRange,
      endAtPlayhead: subtask.endAtPlayhead,
      beginPendingRange: subtask.beginPendingRange,
      cancelPending: subtask.cancelPending,
      clearPendingAnnotation: subtask.clearPendingAnnotation,
      commitPending: subtask.commitPending,
      updateSegment: subtask.updateSegment,
      replaceEpisodeSegments: subtask.replaceEpisodeSegments,
      removeSegment: subtask.removeSegment,
    }),
    [subtask],
  );

  // 兼容层：完整 value 供 useLeRobot() 的现有消费者使用
  const value = useMemo(
    () => ({
      ...dataValue,
      ...selectionValue,
      ...playbackValue,
      ...subtaskValue,
      ...uiValue,
    }),
    [dataValue, selectionValue, playbackValue, subtaskValue, uiValue],
  );

  return (
    <LeRobotContext.Provider value={value}>
      <LeRobotDataContext.Provider value={dataValue}>
        <LeRobotSelectionContext.Provider value={selectionValue}>
          <LeRobotPlaybackContext.Provider value={playbackValue}>
            <LeRobotSubtaskContext.Provider value={subtaskValue}>
              <LeRobotUiContext.Provider value={uiValue}>
                <VideoStageContext.Provider value={videoStage}>
                  {children}
                </VideoStageContext.Provider>
              </LeRobotUiContext.Provider>
            </LeRobotSubtaskContext.Provider>
          </LeRobotPlaybackContext.Provider>
        </LeRobotSelectionContext.Provider>
      </LeRobotDataContext.Provider>
    </LeRobotContext.Provider>
  );
};

/** @deprecated Prefer LeRobotDataProvider — alias retained for migration. */
export const LeRobotProvider = LeRobotDataProvider;
