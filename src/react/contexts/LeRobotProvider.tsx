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
import { loadDataLoaderModule } from '../lazyChunks';
import {
  LeRobotContext,
  LeRobotDataContext,
  LeRobotPlaybackContext,
  LeRobotSelectionContext,
  LeRobotUiContext,
  LeRobotSubtaskContext,
  LeRobotSegmentContext,
  type FrameIndexSubscriber,
  type TrimPreviewHandlers,
} from './LeRobotContext';
import { useSubtaskAnnotation } from './useSubtaskAnnotation';
import { useSegmentAnnotation } from './useSegmentAnnotation';
import {
  buildPlaybackFrames,
  findSegment,
  getEagerEpisodeColumns,
  getEpisodeColumnBatches,
  getFirstAvailableEpisodeIndex,
  lastUnlabeledGap,
  pendingSelectionEpisode,
  pendingSelectionFrame,
  segmentsFromFrameIndices,
  type PendingSelection,
} from '@/core';
import { createParquetImageService, type ParquetImageServiceImpl } from '@/platform';
import { episodeNumber, getAutoLayoutVisualRows, getImageFeatureNames } from '@/core';
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

/** A committed same-timeline swap that has not landed yet (see `committedSwapRef`). */
interface CommittedSwap {
  generation: number;
  loader: LeRobotDataLoader;
  landing: PendingSelection & { episodeIndex: number; requireLength: number };
  /** A newer open failed with the view kept: this swap may land despite it. */
  handedBack: boolean;
  /** The shown episode's reload, once done. */
  reload: { loaded: boolean; fps: number } | null;
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
  const [episodeEditMode, setEpisodeEditMode] = useState(false);
  const [selectedEpisodeIndex, setSelectedEpisodeIndex] = useState<number | null>(null);
  const [currentFrames, setCurrentFrames] = useState<FrameData[]>([]);
  const [chartData, setChartData] = useState<NumericalColumnMap>({});
  const [pendingChartColumns, setPendingChartColumns] = useState<readonly string[]>([]);
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

  const sourceSubtaskSegments = useMemo(() => {
    if (sourceSubtaskIndices.length === 0 || sourceSubtaskIndices.length !== currentFrames.length) {
      return [];
    }
    return segmentsFromFrameIndices(sourceSubtaskIndices, sourceSubtasks);
  }, [currentFrames.length, sourceSubtaskIndices, sourceSubtasks]);

  /** What is on screen now, for a source swap deciding whether, and where, to keep it. */
  const viewRef = useRef({ selectedEpisodeIndex, frames: currentFrames.length, episodes });
  viewRef.current = { selectedEpisodeIndex, frames: currentFrames.length, episodes };

  // 使用 ref 跟踪当前数据源和加载器，用于清理和防止重复加载
  const dataLoaderRef = useRef<LeRobotDataLoader | null>(null);
  const currentSourceRef = useRef<DataSource | FileSystemDirectoryHandle | null>(null);
  const failedSourcesRef = useRef<Set<DataSource | FileSystemDirectoryHandle>>(new Set());
  /** The failure behind `error` of the last open, for a host's `onFatalError` cause. */
  const errorCauseRef = useRef<unknown>(null);
  const getErrorCause = useCallback(() => errorCauseRef.current, []);
  /**
   * The episode whose load failed (it is still the selected one), so Retry,
   * or the browser coming back online, loads it again; `null` otherwise.
   */
  const failedEpisodeRef = useRef<number | null>(null);
  const [failedEpisode, setFailedEpisodeState] = useState<number | null>(null);
  const setFailedEpisode = useCallback((index: number | null) => {
    failedEpisodeRef.current = index;
    setFailedEpisodeState(index);
  }, []);
  /** Bumped when a failed episode is loaded again: its panels request their files again. */
  const [loadAttempt, setLoadAttempt] = useState(0);
  const isLoadingRef = useRef(false);
  /** Monotonic generation so A→B opens discard stale init results. */
  const initGenerationRef = useRef(0);

  // 高性能播放：使用ref存储帧索引，避免触发React渲染
  const frameIndexRef = useRef(0);
  const frameSubscribersRef = useRef<Set<FrameIndexSubscriber>>(new Set());
  const selectEpisodeRef = useRef<(episodeIndex: number) => Promise<boolean>>(async () => false);
  const shouldHoldAtEpisodeEndRef = useRef<() => boolean>(() => false);
  const onNaturalEndRef = useRef<() => void>(() => undefined);
  const setFrameIndexRef = useRef<(index: number) => void>(() => undefined);
  const stableSetFrameIndex = useCallback((index: number) => setFrameIndexRef.current(index), []);
  const stableSelectEpisode = useCallback((index: number) => selectEpisodeRef.current(index), []);
  const getFrameIndexStable = useCallback(() => frameIndexRef.current, []);
  /** Set once playback exists (below); segment review pauses through it. */
  const pausePlaybackRef = useRef<() => void>(() => undefined);
  const stablePausePlayback = useCallback(() => pausePlaybackRef.current(), []);

  const segments = useSegmentAnnotation({
    episodes,
    selectedEpisodeIndex,
    versionCapability,
    episodeEditMode,
    sourceSubtasks: sourceSubtaskSegments,
    getFrameIndex: getFrameIndexStable,
    setFrameIndex: stableSetFrameIndex,
    selectEpisode: stableSelectEpisode,
    pausePlayback: stablePausePlayback,
  });
  const resetSegments = segments.reset;

  const subtask = useSubtaskAnnotation({
    canAnnotate: segments.canEditSubtasks,
    controlled: segments.controlled,
    selectedEpisodeIndex,
    episodeLength: currentFrames.length,
    sourceTable: sourceSubtasks,
    sourceSegments: sourceSubtaskSegments,
    segments: segments.episodeSegments,
    doc: segments.doc,
    dispatch: segments.dispatch,
    createId: segments.createId,
    newSegmentReview: segments.config.annotation?.newSegmentReview ?? 'confirmed',
    showNotice: segments.showNotice,
  });

  // Pause-to-label belongs to the standalone flow; a host-controlled viewer labels with keys.
  const pauseToLabel = subtask.canAnnotate && !segments.controlled;
  shouldHoldAtEpisodeEndRef.current = () => pauseToLabel;
  onNaturalEndRef.current = () => {
    if (!pauseToLabel || trimSuggestion) return;
    const gap = lastUnlabeledGap(subtask.currentSegments, currentFrames.length);
    if (!gap) return;
    if (subtask.beginPendingRange(gap.startFrame, gap.endFrame)) {
      setSubtaskDialogOpen(true);
    }
  };

  // The one owner of "is this episode load still current": each load holds a
  // token; selecting another episode replaces it, and disposing a loader
  // (unmount, reset, a new data source) clears it before the loader goes.
  // A load whose token is gone drops its results and errors.
  const episodeLoadRef = useRef<object | null>(null);

  /**
   * The committed same-timeline swap that has not landed yet: its
   * generation, its loader, and where it lands (decided once at commit,
   * from what was shown then). It owns the landing from commit until it
   * lands; a newer commit or a cleared view supersedes it. Its shown
   * episode reloads once its loader renders; it lands when that reload is
   * done and no newer open is pending. A newer open that fails with the
   * view kept hands the landing back (`handedBack`): the swap then retires
   * the previous loader, lands, and resumes, as it would have.
   */
  const committedSwapRef = useRef<CommittedSwap | null>(null);
  /**
   * Whether playback resumes when the current swap lands: true when it was
   * playing as a swap began, also across a swap superseded before landing.
   */
  const swapResumeRef = useRef(false);
  // The previous loader and image service, disposed once the swapped-in
  // source shows its episode.
  const retiringRef = useRef<{
    loader: LeRobotDataLoader;
    imageService: ParquetImageServiceImpl | null;
  } | null>(null);
  const retire = useCallback(() => {
    const retiring = retiringRef.current;
    retiringRef.current = null;
    if (!retiring) return;
    retiring.loader
      .dispose()
      .catch((err) => console.warn('Failed to dispose previous loader', err));
    retiring.imageService
      ?.dispose()
      .catch((err) => console.warn('Failed to dispose previous image service', err));
  }, []);

  // 卸载时清理资源
  useEffect(() => {
    return () => {
      episodeLoadRef.current = null;
      retire();
      // 这里的 reset 是异步的，但在卸载时我们主要关心同步清理（如 worker terminate 和 ObjectURL 撤销）
      // DataLoader.dispose 会处理这些。
      if (dataLoaderRef.current) {
        dataLoaderRef.current.dispose().catch((err) => console.warn('Unmount dispose error:', err));
      }
      imageServiceRef.current
        ?.dispose()
        .catch((err) => console.warn('Unmount image dispose error:', err));
    };
  }, [retire]);

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
    chartColumnsPending: pendingChartColumns.length > 0,
    featureData,
    setFeatureData,
  });

  const {
    clock,
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
    shouldHoldAtEpisodeEndRef,
    onNaturalEndRef,
    previewRange:
      trimSuggestion?.episodeIndex === selectedEpisodeIndex ? trimSuggestion.range : undefined,
    loopRange: segments.loopRange,
  });
  setFrameIndexRef.current = setFrameIndex;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const setPlayingRef = useRef(setPlaying);
  setPlayingRef.current = setPlaying;
  pausePlaybackRef.current = () => setPlayingRef.current(false);

  // A segment selected on another episode seeks once that episode's frames are in.
  const flushPendingSeek = segments.flushPendingSeek;
  useEffect(() => {
    flushPendingSeek(selectedEpisodeIndex, currentFrames.length);
  }, [currentFrames.length, flushPendingSeek, selectedEpisodeIndex]);

  /**
   * A deep link or a selection carried across a data-source swap, applied
   * once its episode's frames are in. While one waits, autoplay holds, so the
   * playhead lands on the asked frame instead of running past it.
   */
  const pendingSelectionRef = useRef<PendingSelection | null>(null);
  /**
   * True while a landing is being applied: the selection is not reported
   * (nor autoplayed) until segment, frame and play state are in, together.
   */
  const landingRef = useRef(false);
  const [landedTick, setLandedTick] = useState(0);
  const hasPendingSelection = useCallback(
    () => pendingSelectionRef.current !== null || landingRef.current,
    [],
  );
  /**
   * Told whenever no selection is pending any more (landed or dropped), so a
   * selection report held back meanwhile is made then, also when no frame
   * notification follows.
   */
  const settledListenersRef = useRef(new Set<() => void>());
  const subscribeSelectionSettled = useCallback((listener: () => void) => {
    settledListenersRef.current.add(listener);
    return () => {
      settledListenersRef.current.delete(listener);
    };
  }, []);
  const announceIfSettled = useCallback(() => {
    if (hasPendingSelection()) return;
    settledListenersRef.current.forEach((listener) => listener());
  }, [hasPendingSelection]);
  /** Drop the pending selection without landing it. */
  const clearPendingSelection = useCallback(() => {
    if (pendingSelectionRef.current === null) return;
    pendingSelectionRef.current = null;
    announceIfSettled();
  }, [announceIfSettled]);
  /**
   * A swap that ends without a landing (its open failed with nothing else
   * waiting, or its reload failed or was superseded): nothing is pending any
   * more, so say so, as a landing does.
   */
  const settleWithoutLanding = useCallback(() => {
    if (pendingSelectionRef.current !== null) clearPendingSelection();
    else announceIfSettled();
  }, [clearPendingSelection, announceIfSettled]);
  const setPendingSelection = useCallback(
    (selection: PendingSelection | null) => {
      if (selection === null) clearPendingSelection();
      else pendingSelectionRef.current = selection;
    },
    [clearPendingSelection],
  );
  const getPendingSelection = useCallback(() => pendingSelectionRef.current, []);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  /**
   * The one landing of a selection on the open episode, for a deep link and
   * a data-source swap alike: the segment is marked selected in place (no
   * navigation of its own), the playhead goes to the selection's frame (its
   * frame, its time, else the segment's first frame), then the play state.
   * The host hears about it once, after all of it is in.
   */
  const applyLanding = useCallback(
    (landing: PendingSelection, episodeIndex: number, frameCount: number, fps: number) => {
      landingRef.current = true;
      const found = landing.segmentId
        ? findSegment(segmentsRef.current.doc, landing.segmentId)
        : null;
      const segment = found && found.episodeIndex === episodeIndex ? found.segment : null;
      if (segment) segmentsRef.current.selectSegment(segment.id, { navigate: false });
      setFrameIndexRef.current(
        pendingSelectionFrame(landing, segment?.startFrame ?? null, fps, frameCount),
      );
      if (landing.resume) setPlayingRef.current(true);
      setLandedTick((tick) => tick + 1);
    },
    [],
  );
  // The landing is committed: report it (the frame notification the host hears).
  useEffect(() => {
    if (!landingRef.current) return;
    landingRef.current = false;
    notifyFrameSubscribers(frameIndexRef.current);
    announceIfSettled();
  }, [landedTick, notifyFrameSubscribers, announceIfSettled]);
  useEffect(() => {
    const pending = pendingSelectionRef.current;
    if (!pending || pending.episodeIndex == null || isLoading) return;
    if (selectedEpisodeIndex != null && selectedEpisodeIndex !== pending.episodeIndex) {
      // The person (or a failed load) went elsewhere first: the link no longer applies.
      clearPendingSelection();
      return;
    }
    if (selectedEpisodeIndex !== pending.episodeIndex) return;
    if (currentFrames.length === 0) {
      // The episode failed to load: nothing to land on.
      if (error) clearPendingSelection();
      return;
    }
    pendingSelectionRef.current = null;
    applyLanding(pending, selectedEpisodeIndex, currentFrames.length, info?.fps || 30);
  }, [
    currentFrames.length,
    error,
    info?.fps,
    isLoading,
    selectedEpisodeIndex,
    applyLanding,
    clearPendingSelection,
  ]);

  const reset = useCallback(async () => {
    // 清理旧资源，回到欢迎页；bump generation 使在途 initialize 失效
    initGenerationRef.current += 1;
    clearPendingSelection();
    committedSwapRef.current = null;
    episodeLoadRef.current = null;
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
    setTrimSuggestion(null);
    resetSegments();
    setModifiedEpisodes(new Map());
    setDeletedEpisodes(new Set());
    setSelectedEpisodeIndex(null);
    setSelectedEpisodeIndices(new Set());
    setCurrentFrames([]);
    setChartData({});
    setPendingChartColumns([]);
    setFeatureData({});
    setCurrentFrameIndex(0);
    frameIndexRef.current = 0;
    notifyFrameSubscribers(0);
    clearPendingFeatureLoads();
    setIsPlaying(false);
    errorCauseRef.current = null;
    setFailedEpisode(null);
    setError(null);
    clearLoading();
    setLastValidationReport(null);
    setHealthDialogOpen(false);
  }, [
    clearPendingSelection,
    setFailedEpisode,
    notifyFrameSubscribers,
    clearLoading,
    clearPendingFeatureLoads,
    setModifiedEpisodes,
    setDeletedEpisodes,
    setSelectedEpisodeIndices,
    setCurrentFrameIndex,
    setIsPlaying,
    resetSegments,
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
      const isCurrentInit = () => generation === initGenerationRef.current;
      isLoadingRef.current = true;
      // A swap from a shown episode keeps the view: the shown dataset stays
      // on screen (paused, still interactive) while the new source opens; at
      // commit it either changes in one step (same timeline) or opens as
      // usual. A first open shows the loading view.
      const keepView =
        dataLoaderRef.current !== null &&
        viewRef.current.selectedEpisodeIndex !== null &&
        viewRef.current.frames > 0;
      // A committed swap that has not landed waits for this open: this one
      // supersedes it by committing or clearing the view, or hands the
      // landing back if it fails with the view kept.
      if (committedSwapRef.current) committedSwapRef.current.handedBack = false;
      // The selection carried by the host (the #117 rule) only lends the play
      // state: the landing itself is decided at commit, from what is shown.
      const carried = keepView ? pendingSelectionRef.current : null;
      if (keepView) {
        clearPendingSelection();
        swapResumeRef.current =
          swapResumeRef.current || carried?.resume === true || isPlayingRef.current;
      } else {
        swapResumeRef.current = false;
      }
      const taskId = 'lerobot-init';
      errorCauseRef.current = null;
      setFailedEpisode(null);
      setError(null);
      if (keepView) {
        setIsPlaying(false);
      } else {
        setIsLoading(true);
        upsertTask({
          id: taskId,
          phase: 'index',
          message: tRef.current('loading.message.initLoader'),
        });
      }

      /** Clear the shown dataset (loader, image service, selection, frames). */
      const clearView = async (source: DataSource) => {
        episodeLoadRef.current = null;
        committedSwapRef.current = null;
        retire();
        if (dataLoaderRef.current) {
          await dataLoaderRef.current.dispose();
        }
        dataLoaderRef.current = null;
        setDataLoader(null);
        setInfo(null);
        setEpisodes([]);
        setTasks({});
        setSourceSubtasks({});
        setSourceSubtaskIndices([]);
        setSelectedEpisodeIndex(null);
        setCurrentFrames([]);
        setChartData({});
        setPendingChartColumns([]);
        setFeatureData({});
        setCurrentFrameIndex(0);
        frameIndexRef.current = 0;
        notifyFrameSubscribers(0);
        setIsPlaying(false);
        await imageServiceRef.current?.dispose();
        const imageService = createParquetImageService();
        imageService.setDataSource(source);
        imageServiceRef.current = imageService;
        setImageService(imageService);
      };
      /** Edits and dialogs belong to the source they were made on. */
      const resetEditing = () => {
        setSubtaskDialogOpen(false);
        setEpisodeEditMode(false);
        setTrimSuggestion(null);
        resetSegments();
        setModifiedEpisodes(new Map());
        setDeletedEpisodes(new Set());
      };

      const source =
        'getDirectoryHandle' in dataSource
          ? new DirectoryDataSource(dataSource as FileSystemDirectoryHandle)
          : dataSource;
      let loader: LeRobotDataLoader | null = null;
      /** Whether the shown dataset was given up (a first open, or another timeline). */
      let viewCleared = !keepView;
      let shownSource: DataSource | FileSystemDirectoryHandle | null = null;
      try {
        if (!keepView) {
          // 先清理旧数据源
          await clearView(source);
          if (!isCurrentInit()) return;
          resetEditing();
        }

        // The source shown until this one opens: it is the current one again
        // if this open fails with the view kept, so a retry can open this one.
        shownSource = currentSourceRef.current;
        currentSourceRef.current = dataSource;

        // 首屏优化：把重依赖（apache-arrow/worker 等）延迟到用户真正打开数据源时再加载
        const { LeRobotDataLoader: LeRobotDataLoaderCtor } = await loadDataLoaderModule();
        loader = new LeRobotDataLoaderCtor(source);

        if (!keepView) {
          upsertTask({
            id: taskId,
            phase: 'read',
            message: tRef.current('loading.message.readMetadata'),
          });
        }
        const lerobotInfo = await loader.initialize();
        if (!isCurrentInit()) {
          // A newer open owns the view: this source's late metadata is dropped.
          await loader.dispose().catch(() => {});
          return;
        }
        const episodes = loader.getEpisodes();

        if (keepView) {
          // The one landing decision, made now from what is shown now: the
          // episode on screen (also one the person picked during the swap),
          // its frame and segment, and the play state. The same timeline
          // (that episode, same length, in the new source) keeps the view.
          const shown = viewRef.current.selectedEpisodeIndex!;
          const frame = frameIndexRef.current;
          const segmentId = segmentsRef.current.selectedSegmentId ?? undefined;
          const resume = swapResumeRef.current || isPlayingRef.current;
          const landing: PendingSelection = {
            episodeIndex: shown,
            frame,
            segmentId,
            requireLength:
              viewRef.current.episodes.find((episode) => episode.episode_index === shown)?.length ??
              viewRef.current.frames,
            resume,
          };
          if (pendingSelectionEpisode(landing, episodes, new Set(), null) === shown) {
            // One transition: the loader, metadata and image service change
            // together; selection, segments and edits stay (same timeline);
            // the shown episode reloads in place, then lands.
            episodeLoadRef.current = null;
            retire();
            retiringRef.current = {
              loader: dataLoaderRef.current!,
              imageService: imageServiceRef.current,
            };
            const nextImageService = createParquetImageService();
            nextImageService.setDataSource(source);
            imageServiceRef.current = nextImageService;
            setImageService(nextImageService);
            committedSwapRef.current = {
              generation,
              loader,
              landing: { ...landing, episodeIndex: shown, requireLength: landing.requireLength! },
              handedBack: false,
              reload: null,
            };
            setIsPlaying(false);
          } else {
            // Another timeline: open as usual (the landing finds nothing to keep).
            viewCleared = true;
            swapResumeRef.current = false;
            await clearView(source);
            if (!isCurrentInit()) {
              await loader.dispose().catch(() => {});
              return;
            }
            resetEditing();
            pendingSelectionRef.current = landing;
          }
        }

        dataLoaderRef.current = loader;
        setDataLoader(loader);
        setLastValidationReport(loader.getValidationReport());
        // 规范化 names 字段（将二维数组展平为一维）
        const normalizedInfo = normalizeInfoNames(lerobotInfo);
        setInfo(normalizedInfo);
        setEpisodes(episodes);
        setTasks(loader.getTasks());
        setSourceSubtasks(loader.getSubtasks());
        if (!keepView) completeTask(taskId);
        failedSourcesRef.current.delete(dataSource);
      } catch (e) {
        if (!isCurrentInit()) {
          await loader?.dispose().catch(() => {});
          return;
        }
        console.error('Failed to initialize LeRobot data loader', e);
        failedSourcesRef.current.add(dataSource);
        const msg = e instanceof Error ? e.message : 'Unknown error during initialization';
        errorCauseRef.current = e;
        setError(msg);
        if (!viewCleared) {
          // The shown dataset stays, as it was; the error names what failed.
          currentSourceRef.current = shownSource;
          await loader?.dispose().catch(() => {});
          const waiting = committedSwapRef.current;
          if (waiting) {
            // An earlier committed swap still owns the screen: it finishes
            // (retire, land, then resume once its data is in).
            waiting.handedBack = true;
            landSwapRef.current(waiting);
          } else {
            if (swapResumeRef.current) setPlayingRef.current(true);
            swapResumeRef.current = false;
            settleWithoutLanding();
          }
        } else {
          failTask(taskId, msg);
        }
        const report = loader?.getValidationReport?.() ?? null;
        if (report?.items?.length) {
          setLastValidationReport(report);
          setHealthDialogOpen(true);
        }
      } finally {
        if (isCurrentInit()) {
          isLoadingRef.current = false;
          if (!keepView) setIsLoading(false);
        }
      }
    },
    [
      clearPendingSelection,
      setFailedEpisode,
      settleWithoutLanding,
      upsertTask,
      completeTask,
      failTask,
      notifyFrameSubscribers,
      setModifiedEpisodes,
      setDeletedEpisodes,
      setCurrentFrameIndex,
      setIsPlaying,
      resetSegments,
      retire,
    ],
  );

  /**
   * The play state a selection carries (s10 F-14): an episode opens paused, and
   * selecting another keeps playing only when playback was on. Set when a
   * selection starts, taken once when its frames are in.
   */
  const resumeAfterSelectRef = useRef(false);
  const takeResumeAfterSelect = useCallback(() => {
    const resume = resumeAfterSelectRef.current;
    resumeAfterSelectRef.current = false;
    return resume;
  }, []);

  const selectEpisode = useCallback(
    /**
     * `keepView`: reload the shown episode from a swapped-in source without
     * clearing it — the frame, charts and playback bar stay until the new
     * data replaces them, and no loading task shows.
     */
    async (index: number, options: { keepView?: boolean } = {}) => {
      if (!dataLoader || !info) return false;
      const keep = options.keepView === true;
      const showTask: typeof upsertTask = keep ? () => undefined : upsertTask;
      if (!keep) setIsLoading(true);
      // A second selection while one loads keeps the first one's play state.
      resumeAfterSelectRef.current = resumeAfterSelectRef.current || isPlayingRef.current;
      setIsPlaying(false);
      setFailedEpisode(null);
      errorCauseRef.current = null;
      setError(null);
      const taskId = 'lerobot-select-episode';
      showTask({
        id: taskId,
        phase: 'read',
        message: tRef.current('loading.message.loadEpisode', {
          number: episodeNumber(index),
          index,
        }),
      });

      setSelectedEpisodeIndex(index);
      // The shown cameras' URLs start resolving now (a signed URL is a round
      // trip), alongside the episode's data, instead of after the panels mount.
      warmEpisodeVideoUrls(dataLoader, info, index);
      if (!keep) {
        setCurrentFrames([]);
        setCurrentFrameIndex(0);
        frameIndexRef.current = 0;
        notifyFrameSubscribers(0);
        setChartData({});
        setPendingChartColumns(getEagerEpisodeColumns(info));
        setFeatureData({});
        setSourceSubtaskIndices([]);
      }
      const load = {};
      episodeLoadRef.current = load;
      const isCurrent = () => episodeLoadRef.current === load;

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
        // The time axis and the top chart group first (playback frames and the
        // first chart), then the other groups; each read fetches only its
        // columns of this episode when the source reads ranges.
        const [firstColumns, ...laterBatches] = getEpisodeColumnBatches(info);
        const laterColumns = laterBatches.flat();
        if (!keep) setPendingChartColumns([...firstColumns!, ...laterColumns]);

        showTask({
          id: taskId,
          phase: 'read',
          message: tRef.current('loading.message.fetchFrames', {
            number: episodeNumber(index),
            index,
          }),
        });
        // The later batch starts downloading once the first one's bytes are
        // in, while the first decodes; the link serves one batch at a time.
        let firstFetched: () => void = () => {};
        const fetched = new Promise<void>((resolve) => {
          firstFetched = resolve;
        });
        const laterRead =
          laterColumns.length > 0
            ? fetched.then(() => dataLoader.loadAllNumericalData(index, laterColumns))
            : null;
        // Settled below; never an unhandled rejection when the first batch fails.
        laterRead?.catch(() => {});
        let numericalData = await dataLoader.loadAllNumericalData(index, firstColumns!, {
          onFetched: firstFetched,
        });

        if (!isCurrent()) return false;

        showTask({
          id: taskId,
          phase: 'render',
          message: tRef.current('loading.message.processCharts'),
        });
        const frames = buildPlaybackFrames(numericalData, info.fps ?? 30);
        setCurrentFrames(frames);
        if (keep) {
          // The shown charts stay until their new columns arrive.
          setChartData((previous) => ({ ...previous, ...numericalData }));
        } else {
          setChartData(numericalData);
          setPendingChartColumns(laterColumns);
        }

        if (laterRead) {
          const later = await laterRead;
          if (!isCurrent()) return false;
          numericalData = { ...numericalData, ...later };
          if (keep) {
            setChartData((previous) => ({ ...previous, ...later }));
          } else {
            setChartData(numericalData);
            setPendingChartColumns([]);
          }
        }

        const subtaskSource = await dataLoader.loadEpisodeSubtaskSource(index);
        if (isCurrent()) {
          setSourceSubtaskIndices(subtaskSource.indices);
          setSourceSubtasks((previous) => ({ ...previous, ...subtaskSource.table }));
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

          if (isCurrent()) {
            setFeatureData({ ...eagerFeatureData, ...extraFeatureData });
          }
        }
        if (!keep) completeTask(taskId);

        // 触发图像预加载（后台异步，不阻塞播放）
        // 仅对 image dtype 的特征有效（video dtype 使用 <video> 元素，无需预加载）
        if (isCurrent()) {
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
                  if (!isCurrent()) return;
                  return imageService.preloadEpisode(firstColumn, startRow, endRow, episodeKey);
                })
                .catch((e) => {
                  // 预加载失败不影响正常播放，回退到按需加载
                  console.warn('Image preload failed, falling back to on-demand loading:', e);
                });
            }
          }
        }
        return isCurrent();
      } catch (e) {
        if (isCurrent()) {
          setPendingChartColumns([]);
          console.error('Failed to load episode data', e);
          const msg = e instanceof Error ? e.message : 'Unknown error while loading episode';
          setFailedEpisode(index);
          errorCauseRef.current = e;
          setError(msg);
          failTask(taskId, msg);
        }
        return false;
      } finally {
        if (isCurrent()) {
          setIsLoading(false);
        }
      }
    },
    [
      dataLoader,
      setFailedEpisode,
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

  // A committed swap lands once its reload is done and no newer open is
  // pending (or one failed and handed the landing back): the previous loader
  // goes, then the decided landing applies (frame, then the play state, the
  // new data being in). A superseded swap does nothing more.
  const landSwap = useCallback(
    (swap: CommittedSwap) => {
      if (committedSwapRef.current !== swap || !swap.reload) return;
      if (swap.generation !== initGenerationRef.current && !swap.handedBack) return;
      committedSwapRef.current = null;
      retire();
      swapResumeRef.current = false;
      const { loaded, fps } = swap.reload;
      if (!loaded) {
        settleWithoutLanding();
        return;
      }
      const { landing } = swap;
      applyLanding(landing, landing.episodeIndex, landing.requireLength, fps);
    },
    [retire, applyLanding, settleWithoutLanding],
  );
  const landSwapRef = useRef(landSwap);
  landSwapRef.current = landSwap;

  // A committed swap, once its loader renders, reloads the shown episode in
  // place, then lands (see landSwap).
  const reloadingSwapRef = useRef<CommittedSwap | null>(null);
  useEffect(() => {
    const swap = committedSwapRef.current;
    if (!swap || swap.loader !== dataLoader || !info) return;
    if (reloadingSwapRef.current === swap) return;
    reloadingSwapRef.current = swap;
    const fps = info.fps || 30;
    void selectEpisode(swap.landing.episodeIndex, { keepView: true }).then((loaded) => {
      swap.reload = { loaded, fps };
      landSwap(swap);
    });
  }, [dataLoader, info, selectEpisode, landSwap]);

  const clearError = useCallback(() => {
    errorCauseRef.current = null;
    setFailedEpisode(null);
    setError(null);
    failedSourcesRef.current.clear();
  }, [setFailedEpisode]);

  const retryEpisode = useCallback(() => {
    const index = failedEpisodeRef.current;
    if (index === null) return false;
    setLoadAttempt((attempt) => attempt + 1);
    void selectEpisodeRef.current(index);
    return true;
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
        setPendingChartColumns([]);
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

    let firstEpisodeIndex = getFirstAvailableEpisodeIndex(episodes, deletedEpisodes);
    const pending = pendingSelectionRef.current;
    if (pending) {
      const found = pending.segmentId ? findSegment(segments.doc, pending.segmentId) : null;
      const target = pendingSelectionEpisode(
        pending,
        episodes,
        deletedEpisodes,
        found?.episodeIndex ?? null,
      );
      if (target == null) {
        // Another timeline (or a link to something gone): open as usual.
        clearPendingSelection();
      } else {
        pendingSelectionRef.current = { ...pending, episodeIndex: target };
        firstEpisodeIndex = target;
      }
    }
    if (firstEpisodeIndex === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      void selectEpisode(firstEpisodeIndex);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [
    clearPendingSelection,
    selectedEpisodeIndex,
    dataLoader,
    info,
    isLoading,
    episodes,
    deletedEpisodes,
    selectEpisode,
    segments.doc,
  ]);

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
      subtasks: sourceSubtasks,
      lastValidationReport,
      initialize,
      reset,
      clearError,
      error,
      isLoading,
      setPendingSelection,
      hasPendingSelection,
      getPendingSelection,
      subscribeSelectionSettled,
      takeResumeAfterSelect,
      getErrorCause,
      retryEpisode,
      failedEpisode,
      loadAttempt,
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
      sourceSubtasks,
      lastValidationReport,
      initialize,
      reset,
      clearError,
      error,
      isLoading,
      setPendingSelection,
      hasPendingSelection,
      getPendingSelection,
      subscribeSelectionSettled,
      takeResumeAfterSelect,
      getErrorCause,
      retryEpisode,
      failedEpisode,
      loadAttempt,
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
      clock,
      currentFrames,
      chartData,
      pendingChartColumns,
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
      clock,
      currentFrames,
      chartData,
      pendingChartColumns,
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
      trimSuggestion,
      setTrimSuggestion,
      returnFromTrimPreview,
      cancelTrimPreview,
      setTrimPreviewHandlers,
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
      trimSuggestion,
      returnFromTrimPreview,
      cancelTrimPreview,
      setTrimPreviewHandlers,
    ],
  );

  const subtaskValue = useMemo(
    () => ({
      canAnnotate: subtask.canAnnotate,
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
              <LeRobotSegmentContext.Provider value={segments}>
                <LeRobotUiContext.Provider value={uiValue}>{children}</LeRobotUiContext.Provider>
              </LeRobotSegmentContext.Provider>
            </LeRobotSubtaskContext.Provider>
          </LeRobotPlaybackContext.Provider>
        </LeRobotSelectionContext.Provider>
      </LeRobotDataContext.Provider>
    </LeRobotContext.Provider>
  );
};

/** @deprecated Prefer LeRobotDataProvider — alias retained for migration. */
/** Resolve the URLs of the cameras the layout shows for an episode; the panels reuse them. */
function warmEpisodeVideoUrls(loader: LeRobotDataLoader, info: LeRobotInfo, index: number): void {
  const visualKeys = Object.entries(info.features)
    .filter(([, feature]) => feature?.dtype === 'video' || feature?.dtype === 'image')
    .map(([key]) => key);
  const { row1, row2 } = getAutoLayoutVisualRows(visualKeys, 6);
  for (const key of [...row1, ...row2]) {
    if (info.features[key]?.dtype !== 'video') continue;
    const path = loader.getEpisodeVideoPath(index, key)?.path;
    if (path) void loader.getFileUrl(path).catch(() => undefined);
  }
}

export const LeRobotProvider = LeRobotDataProvider;
