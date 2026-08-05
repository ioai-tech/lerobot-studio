import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { LeRobotInfo, EpisodeMetadata, FrameData, LeRobotFeature, PlaybackMode } from '@/core';
import type { LeRobotDataLoader } from '@/platform';
import type { NumericalColumnMap } from '@/platform';
import type { DataSource } from '@/platform';
import type { ValidationReport } from '@/core';
import { DirectoryDataSource } from '@/platform';
import { useLoading } from './LoadingContext';
import {
  LeRobotContext,
  LeRobotDataContext,
  LeRobotPlaybackContext,
  LeRobotSelectionContext,
  LeRobotUiContext,
  type FrameIndexSubscriber,
} from './LeRobotContext';
import { buildPlaybackFrames, getEagerEpisodeColumns, getFirstAvailableEpisodeIndex } from '@/core';
import { createParquetImageService, type ParquetImageServiceImpl } from '@/platform';
import { getImageFeatureNames } from '@/core';
import { useEpisodeView } from './useEpisodeView';
import { materializeNumericFeatureRows, useFeatureSubscriptions } from './useFeatureSubscriptions';
import { usePlaybackBridge } from './usePlaybackBridge';

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
  const [selectedEpisodeIndex, setSelectedEpisodeIndex] = useState<number | null>(null);
  const [currentFrames, setCurrentFrames] = useState<FrameData[]>([]);
  const [chartData, setChartData] = useState<NumericalColumnMap>({});
  const [featureData, setFeatureData] = useState<Record<string, unknown[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('sequential');
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [lastValidationReport, setLastValidationReport] = useState<ValidationReport | null>(null);
  const [healthDialogOpen, setHealthDialogOpen] = useState(false);

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

  // 使用 ref 跟踪当前数据源和加载器，用于清理和防止重复加载
  const dataLoaderRef = useRef<LeRobotDataLoader | null>(null);
  const currentSourceRef = useRef<DataSource | FileSystemDirectoryHandle | null>(null);
  const failedSourcesRef = useRef<Set<DataSource | FileSystemDirectoryHandle>>(new Set());
  const isLoadingRef = useRef(false);
  /** Monotonic generation so A→B opens discard stale init results. */
  const initGenerationRef = useRef(0);

  // 高性能播放：使用ref存储帧索引，避免触发React渲染
  const frameIndexRef = useRef(0);
  const frameSubscribersRef = useRef<Set<FrameIndexSubscriber>>(new Set());
  const selectEpisodeRef = useRef<(episodeIndex: number) => Promise<boolean>>(async () => false);

  // 卸载时清理资源
  useEffect(() => {
    return () => {
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
  } = usePlaybackBridge({
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
  });

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
    setModifiedEpisodes(new Map());
    setDeletedEpisodes(new Set());
    setSelectedEpisodeIndex(null);
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
      upsertTask({ id: taskId, phase: 'index', message: 'Initializing data loader...' });

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
        setModifiedEpisodes(new Map());
        setDeletedEpisodes(new Set());
        setSelectedEpisodeIndex(null);
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

        upsertTask({ id: taskId, phase: 'read', message: 'Reading metadata...' });
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
    ],
  );

  const selectEpisode = useCallback(
    async (index: number) => {
      if (!dataLoader || !info) return false;
      setIsLoading(true);
      setIsPlaying(false);
      setError(null);
      const taskId = 'lerobot-select-episode';
      upsertTask({ id: taskId, phase: 'read', message: `Loading episode ${index}...` });

      setSelectedEpisodeIndex(index);
      setCurrentFrameIndex(0);
      frameIndexRef.current = 0;
      notifyFrameSubscribers(0);
      setChartData({});
      setFeatureData({});
      loadingEpisodeRef.current = index;

      // 若新 episode 对应的 parquet 与当前缓存不同（v3 分片 / v2.1 多文件），主动释放
      // 旧文件的解析缓存（主线程 Arrow Table + worker 内部 fileCache），避免叠加式内存占用。
      // ParquetImageService 的预加载 Map 也一并清空，防止图像 bitmap 残留。
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

        // 只预取播放和图表所需的时间轴/数值列，其他特征继续按需加载。
        upsertTask({
          id: taskId,
          phase: 'read',
          message: `Fetching frame data for episode ${index}...`,
        });
        const numericalData = await dataLoader.loadAllNumericalData(index, eagerColumns);

        if (loadingEpisodeRef.current !== index) return false;

        upsertTask({ id: taskId, phase: 'render', message: 'Processing charts...' });
        const frames = buildPlaybackFrames(numericalData, info.fps ?? 30);
        setCurrentFrames(frames);

        if (loadingEpisodeRef.current === index) {
          setChartData(numericalData);
        }

        // 已订阅特征优先复用已加载的数值列，剩余列再按需补读。
        const subscribedFeatures = getSubscribedFeatureNames(info);

        if (subscribedFeatures.length > 0) {
          const eagerFeatureData: Record<string, unknown[]> = {};
          const missingFeatures: string[] = [];

          subscribedFeatures.forEach((name) => {
            if (name in numericalData) {
              eagerFeatureData[name] = materializeNumericFeatureRows(numericalData[name]);
            } else {
              missingFeatures.push(name);
            }
          });

          const extraFeatureData =
            missingFeatures.length > 0
              ? await dataLoader.loadFeatureData(index, missingFeatures)
              : {};

          if (loadingEpisodeRef.current === index) {
            setFeatureData({ ...eagerFeatureData, ...extraFeatureData });
          }
        }
        completeTask(taskId);

        // 触发图像预加载（后台异步，不阻塞播放）
        // 仅对 image dtype 的特征有效（video dtype 使用 <video> 元素，无需预加载）
        if (loadingEpisodeRef.current === index) {
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
        }
        return loadingEpisodeRef.current === index;
      } catch (e) {
        if (loadingEpisodeRef.current === index) {
          console.error('Failed to load episode data', e);
          const msg = e instanceof Error ? e.message : 'Unknown error while loading episode';
          setError(msg);
          failTask(taskId, msg);
        }
        return false;
      } finally {
        if (loadingEpisodeRef.current === index) {
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
    ],
  );
  selectEpisodeRef.current = selectEpisode;

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
      episodes,
      tasks,
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
      episodes,
      tasks,
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

  const playbackValue = useMemo(
    () => ({
      currentFrames,
      chartData,
      currentFrameIndex,
      isPlaying,
      playbackMode,
      playbackSpeed,
      setFrameIndex,
      togglePlay,
      setPlaying,
      seek,
      setPlaybackMode,
      setPlaybackSpeed,
    }),
    [
      currentFrames,
      chartData,
      currentFrameIndex,
      isPlaying,
      playbackMode,
      playbackSpeed,
      setFrameIndex,
      togglePlay,
      setPlaying,
      seek,
    ],
  );

  const uiValue = useMemo(
    () => ({
      healthDialogOpen,
      setHealthDialogOpen,
    }),
    [healthDialogOpen],
  );

  // 兼容层：完整 value 供 useLeRobot() 的现有消费者使用
  const value = useMemo(
    () => ({ ...dataValue, ...selectionValue, ...playbackValue, ...uiValue }),
    [dataValue, selectionValue, playbackValue, uiValue],
  );

  return (
    <LeRobotContext.Provider value={value}>
      <LeRobotDataContext.Provider value={dataValue}>
        <LeRobotSelectionContext.Provider value={selectionValue}>
          <LeRobotPlaybackContext.Provider value={playbackValue}>
            <LeRobotUiContext.Provider value={uiValue}>{children}</LeRobotUiContext.Provider>
          </LeRobotPlaybackContext.Provider>
        </LeRobotSelectionContext.Provider>
      </LeRobotDataContext.Provider>
    </LeRobotContext.Provider>
  );
};

/** @deprecated Prefer LeRobotDataProvider — alias retained for migration. */
export const LeRobotProvider = LeRobotDataProvider;
