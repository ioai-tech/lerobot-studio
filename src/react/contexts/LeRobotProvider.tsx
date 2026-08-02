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
import { PlaybackEngine } from '../services/PlaybackEngine';

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

function materializeNumericFeatureRows(column: NumericalColumnMap[string]): unknown[] {
  const rows: unknown[] = [];
  for (let rowIndex = 0; rowIndex < column.rows; rowIndex++) {
    const offset = rowIndex * column.width;
    if (column.width <= 1) {
      rows.push(column.values[offset] ?? 0);
      continue;
    }

    rows.push(Array.from(column.values.slice(offset, offset + column.width)));
  }
  return rows;
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
  const [modifiedEpisodes, setModifiedEpisodes] = useState<Map<number, Partial<EpisodeMetadata>>>(
    () => new Map(),
  );
  const [deletedEpisodes, setDeletedEpisodes] = useState<Set<number>>(() => new Set());
  const [selectedEpisodeIndex, setSelectedEpisodeIndex] = useState<number | null>(null);
  const [selectedEpisodeIndices, setSelectedEpisodeIndices] = useState<Set<number>>(
    () => new Set(),
  );
  const [currentFrames, setCurrentFrames] = useState<FrameData[]>([]);
  const [chartData, setChartData] = useState<NumericalColumnMap>({});
  const [featureData, setFeatureData] = useState<Record<string, unknown[]>>({});
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
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
  // busy 期间用户通过 setPlaying 请求的目标状态（null 表示无挂起）
  const pendingPlayRef = useRef<boolean | null>(null);
  // busy 期间通过 togglePlay 请求的“翻转一次”（仅内部/autoplay 可能用到）
  const pendingToggleOnceRef = useRef(false);

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

  // 后台暂停逻辑
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isPlaying) {
        setIsPlaying(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isPlaying]);

  const loadingEpisodeRef = useRef<number | null>(null);
  const subscriptionsRef = useRef<Record<string, number>>({});
  const infoRef = useRef<LeRobotInfo | null>(null);
  const selectedEpisodeIndexRef = useRef<number | null>(null);
  const chartDataRef = useRef<NumericalColumnMap>({});
  const featureDataRef = useRef<Record<string, unknown[]>>({});
  const pendingFeatureLoadsRef = useRef<Set<string>>(new Set());
  const loadingFeatureLoadsRef = useRef<Set<string>>(new Set());
  const featureLoadTimerRef = useRef<number | null>(null);

  useEffect(() => {
    infoRef.current = info;
  }, [info]);

  useEffect(() => {
    selectedEpisodeIndexRef.current = selectedEpisodeIndex;
  }, [selectedEpisodeIndex]);

  useEffect(() => {
    chartDataRef.current = chartData;
  }, [chartData]);

  useEffect(() => {
    featureDataRef.current = featureData;
  }, [featureData]);

  const clearPendingFeatureLoads = useCallback(() => {
    pendingFeatureLoadsRef.current.clear();
    loadingFeatureLoadsRef.current.clear();
    if (featureLoadTimerRef.current !== null) {
      window.clearTimeout(featureLoadTimerRef.current);
      featureLoadTimerRef.current = null;
    }
  }, []);

  const flushPendingFeatureLoads = useCallback(async () => {
    featureLoadTimerRef.current = null;

    const episodeIndex = selectedEpisodeIndexRef.current;
    const loader = dataLoaderRef.current;
    const currentInfo = infoRef.current;
    if (episodeIndex === null || !loader || !currentInfo) {
      pendingFeatureLoadsRef.current.clear();
      return;
    }

    const queuedFeatures = Array.from(pendingFeatureLoadsRef.current).filter((featureName) => {
      if (loadingFeatureLoadsRef.current.has(featureName)) return false;
      if (featureDataRef.current[featureName] !== undefined) return false;
      const feature = currentInfo.features[featureName];
      return !(feature && (feature.dtype === 'image' || feature.dtype === 'video'));
    });

    if (queuedFeatures.length === 0) {
      pendingFeatureLoadsRef.current.clear();
      return;
    }

    queuedFeatures.forEach((featureName) => {
      pendingFeatureLoadsRef.current.delete(featureName);
      loadingFeatureLoadsRef.current.add(featureName);
    });

    const eagerFeatureData: Record<string, unknown[]> = {};
    const missingFeatures: string[] = [];

    queuedFeatures.forEach((featureName) => {
      const numericalColumn = chartDataRef.current[featureName];
      if (numericalColumn) {
        eagerFeatureData[featureName] = materializeNumericFeatureRows(numericalColumn);
      } else {
        missingFeatures.push(featureName);
      }
    });

    if (
      Object.keys(eagerFeatureData).length > 0 &&
      selectedEpisodeIndexRef.current === episodeIndex
    ) {
      setFeatureData((prev) => ({ ...prev, ...eagerFeatureData }));
    }

    if (missingFeatures.length > 0) {
      try {
        const data = await loader.loadFeatureData(episodeIndex, missingFeatures);
        if (selectedEpisodeIndexRef.current === episodeIndex) {
          setFeatureData((prev) => ({ ...prev, ...data }));
        }
      } catch (e) {
        console.error(`Failed to load batched feature data for episode ${episodeIndex}`, e);
      }
    }

    queuedFeatures.forEach((featureName) => {
      loadingFeatureLoadsRef.current.delete(featureName);
    });

    if (pendingFeatureLoadsRef.current.size > 0) {
      featureLoadTimerRef.current = window.setTimeout(() => {
        void flushPendingFeatureLoads();
      }, 0);
    }
  }, []);

  const scheduleFeatureLoad = useCallback(
    (featureName: string) => {
      const episodeIndex = selectedEpisodeIndexRef.current;
      if (episodeIndex === null) return;

      pendingFeatureLoadsRef.current.add(featureName);
      if (featureLoadTimerRef.current === null) {
        featureLoadTimerRef.current = window.setTimeout(() => {
          void flushPendingFeatureLoads();
        }, 0);
      }
    },
    [flushPendingFeatureLoads],
  );

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
  }, [notifyFrameSubscribers, clearLoading, clearPendingFeatureLoads]);

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
        const { LeRobotDataLoader: LeRobotDataLoaderCtor } = await import('@/platform');
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
    [upsertTask, completeTask, failTask, notifyFrameSubscribers],
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
        const subscribedFeatures = Object.entries(subscriptionsRef.current)
          .filter(([name, count]) => {
            if (count <= 0) return false;
            const feat = info.features[name];
            if (feat && (feat.dtype === 'image' || feat.dtype === 'video')) return false;
            return true;
          })
          .map(([name]) => name);

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
    [dataLoader, imageService, info, upsertTask, completeTask, failTask, notifyFrameSubscribers],
  );

  useEffect(() => {
    clearPendingFeatureLoads();
  }, [selectedEpisodeIndex, clearPendingFeatureLoads]);

  const clearError = useCallback(() => {
    setError(null);
    failedSourcesRef.current.clear();
  }, []);

  const subscribeFeature = useCallback(
    async (featureName: string) => {
      subscriptionsRef.current[featureName] = (subscriptionsRef.current[featureName] || 0) + 1;

      // Skip loading image/video features - they are loaded on-demand by ImagePanel/VideoPanel
      const feature = info?.features?.[featureName];
      if (feature && (feature.dtype === 'image' || feature.dtype === 'video')) {
        return;
      }

      // 首次订阅时按 batch 合并补读，避免“恢复全选”触发逐列重复解析。
      if (subscriptionsRef.current[featureName] === 1) {
        if (featureDataRef.current[featureName] !== undefined) {
          return;
        }
        scheduleFeatureLoad(featureName);
      }
    },
    [info, scheduleFeatureLoad],
  );

  const unsubscribeFeature = useCallback((featureName: string) => {
    if (subscriptionsRef.current[featureName] > 0) {
      subscriptionsRef.current[featureName]--;
    }
  }, []);

  const setFrameIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < currentFrames.length) {
        frameIndexRef.current = index;
        // 只在非播放状态时更新React state（用于UI同步）
        if (!isPlaying) {
          setCurrentFrameIndex(index);
        }
        // 通知所有订阅者（直接DOM更新，无React渲染）
        notifyFrameSubscribers(index);
      }
    },
    [currentFrames.length, isPlaying, notifyFrameSubscribers],
  );

  const togglePlay = useCallback(() => {
    if (isBusy) {
      pendingToggleOnceRef.current = !pendingToggleOnceRef.current;
      return;
    }
    setIsPlaying((prev) => !prev);
  }, [isBusy]);

  const setPlaying = useCallback(
    (target: boolean) => {
      if (isBusy) {
        pendingPlayRef.current = target;
        return;
      }
      setIsPlaying(target);
    },
    [isBusy],
  );

  // busy -> idle 时，应用挂起的目标播放状态或一次翻转
  useEffect(() => {
    if (!isBusy) {
      if (pendingPlayRef.current !== null) {
        const target = pendingPlayRef.current;
        pendingPlayRef.current = null;
        pendingToggleOnceRef.current = false;
        setIsPlaying(target);
      } else if (pendingToggleOnceRef.current) {
        pendingToggleOnceRef.current = false;
        setIsPlaying((prev) => !prev);
      }
    }
  }, [isBusy]);

  const seek = useCallback(
    (offset: number) => {
      if (isBusy) return;
      setFrameIndex(frameIndexRef.current + offset);
    },
    [setFrameIndex, isBusy],
  );

  const editEpisodeTask = useCallback(
    (episodeIndex: number, newTask: string) => {
      setModifiedEpisodes((prev) => {
        const next = new Map(prev);
        const existing = episodes.find((e) => e.episode_index === episodeIndex);
        if (existing) {
          next.set(episodeIndex, { ...existing, tasks: [newTask] });
        }
        return next;
      });
    },
    [episodes],
  );

  const deleteEpisode = useCallback((episodeIndex: number) => {
    setDeletedEpisodes((prev) => new Set(prev).add(episodeIndex));
  }, []);

  const restoreEpisode = useCallback((episodeIndex: number) => {
    setDeletedEpisodes((prev) => {
      const next = new Set(prev);
      next.delete(episodeIndex);
      return next;
    });
  }, []);

  const getEffectiveEpisode = useCallback(
    (episode: EpisodeMetadata): EpisodeMetadata => {
      const modified = modifiedEpisodes.get(episode.episode_index);
      if (modified) {
        return { ...episode, ...modified } as EpisodeMetadata;
      }
      return episode;
    },
    [modifiedEpisodes],
  );

  const effectiveEpisodes = useMemo(() => {
    return episodes
      .filter((e) => !deletedEpisodes.has(e.episode_index))
      .map((e) => getEffectiveEpisode(e));
  }, [episodes, deletedEpisodes, getEffectiveEpisode]);

  const episodesForExport = useMemo(() => {
    if (selectedEpisodeIndices.size === 0) return effectiveEpisodes;
    const set = selectedEpisodeIndices;
    return effectiveEpisodes.filter((e) => set.has(e.episode_index));
  }, [effectiveEpisodes, selectedEpisodeIndices]);

  const toggleEpisodeSelection = useCallback((index: number) => {
    setSelectedEpisodeIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const selectAllInList = useCallback((indices: number[]) => {
    setSelectedEpisodeIndices(new Set(indices));
  }, []);

  const clearEpisodeSelection = useCallback(() => {
    setSelectedEpisodeIndices(new Set());
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

  // 高性能播放循环：委托给 PlaybackEngine（与 React render 解耦）
  const playbackEngineRef = useRef<PlaybackEngine | null>(null);
  useEffect(() => {
    const engine = new PlaybackEngine({
      getFrameIndex: () => frameIndexRef.current,
      setFrameIndexSilent: (index) => {
        frameIndexRef.current = index;
      },
      notifyFrame: notifyFrameSubscribers,
      getFrameCount: () => currentFrames.length,
      getFps: () => info?.fps || 30,
      getPlaybackSpeed: () => playbackSpeed,
      getPlaybackMode: () => playbackMode,
      getEpisodes: () => episodes,
      getSelectedEpisodeIndex: () => selectedEpisodeIndex,
      getDeletedEpisodes: () => deletedEpisodes,
      onStop: () => setIsPlaying(false),
      onAdvanceEpisode: (episodeIndex) => selectEpisode(episodeIndex),
      onResumeAfterEpisode: () => setIsPlaying(true),
    });
    playbackEngineRef.current = engine;
    return () => {
      engine.dispose();
      playbackEngineRef.current = null;
    };
  }, [
    currentFrames.length,
    info?.fps,
    playbackSpeed,
    playbackMode,
    episodes,
    selectedEpisodeIndex,
    deletedEpisodes,
    selectEpisode,
    notifyFrameSubscribers,
  ]);

  useEffect(() => {
    const engine = playbackEngineRef.current;
    if (!engine) return;
    if (isPlaying && currentFrames.length > 0 && !isBusy) {
      engine.start();
    } else {
      engine.stop();
      if (!isPlaying && frameIndexRef.current !== currentFrameIndex) {
        setCurrentFrameIndex(frameIndexRef.current);
      }
    }
    return () => {
      engine.stop();
    };
  }, [isPlaying, currentFrames.length, isBusy, currentFrameIndex]);

  const dataValue = useMemo(
    () => ({
      info,
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
