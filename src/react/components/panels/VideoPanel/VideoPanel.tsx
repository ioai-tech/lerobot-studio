import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useCameraName,
  useLeRobotData,
  useLeRobotPlayback,
  useLeRobotSelection,
} from '../../../contexts/LeRobotContext';
import { buildMediaDebugMetadata } from '@/core';
import { checkVideoCodecSupport } from '../../../../platform/services/videoCodecSupport';
import { CameraFollower } from '../../../services/CameraFollower';
import { cameraPreload } from '../../../services/cameraPreload';
import { getFeatureDisplayType, getFirstVisualFeatureName } from '@/core';
import { ImagePanel } from '../ImagePanel/ImagePanel';
import { MediaDebugOverlay } from '../Common/MediaDebugOverlay';

interface VideoPanelProps {
  params?: {
    featureKey?: string;
  };
}

type EpisodeVideo = { path: string; start: number; end: number };

/**
 * One camera. The `<video>` element plays natively and follows the shared
 * playback clock through a `CameraFollower` (no per-frame seeking). The
 * loader owns signed URLs: when they are refreshed, or a URL fails once, the
 * element swaps its source and the follower restores position and play state
 * from the clock.
 */
/** The longest a camera holds its last frame while a new URL of the same file loads. */
export const HOLD_CAP_MS = 4000;
/** After a pause, how long a camera waits for the pause to settle before reloading at its frame. */
const PAUSED_RELOAD_DELAY_MS = 250;
/** How many times it waits again for the pause to land on the clock's frame (about 5 s). */
const PAUSED_RELOAD_MAX_WAITS = 20;

const VideoPanelContent: React.FC<VideoPanelProps> = ({ params }) => {
  const { t } = useTranslation();
  const { info, dataLoader, isLoading, failedEpisode, loadAttempt } = useLeRobotData();
  const { clock, isPlaying } = useLeRobotPlayback();
  /**
   * A camera reads ahead only while it plays (`cameraPreload`): while the
   * episode's numeric data downloads, or paused, it fetches what the shown
   * frame needs and lets its connection go, so the charts arrive with the
   * video and a seek never waits behind the other cameras' read-ahead.
   */
  const preload = cameraPreload({ loading: isLoading, playing: isPlaying });
  const preloadRef = useRef(preload);
  preloadRef.current = preload;
  const { selectedEpisodeIndex } = useLeRobotSelection();
  const featureKey = params?.featureKey || 'observation.images.up';
  const fps = info?.fps ?? 30;

  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [loadError, setLoadErrorState] = useState<string | null>(null);
  /** This camera's file failed: an episode load run again (Retry, back online) requests it again. */
  const failedRef = useRef(false);
  const setLoadError = useCallback((message: string | null) => {
    failedRef.current = message !== null;
    setLoadErrorState(message);
  }, []);
  const [unsupportedCodec, setUnsupportedCodec] = useState<string | null>(null);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [timelineRange, setTimelineRange] = useState<{ startSec: number; endSec: number } | null>(
    null,
  );
  const [currentVideoPath, setCurrentVideoPath] = useState<string>('');

  /**
   * File on the element, the loader its URL came from, and whether its
   * current URL generation was already retried.
   */
  const sourceRef = useRef<{ path: string; loader: unknown; retried: boolean } | null>(null);
  /** The last frame, held over the element while a new URL of the same file loads. */
  const holdRef = useRef<HTMLCanvasElement>(null);
  /** Selected episode's span in the current file; read by the follower. */
  const rangeRef = useRef<{ start: number; end: number } | null>(null);
  const fpsRef = useRef(fps);
  fpsRef.current = fps;
  const followerRef = useRef<CameraFollower | null>(null);
  const requestTokenRef = useRef(0);

  const debugMetadata = useMemo(
    () =>
      buildMediaDebugMetadata(info, featureKey, {
        runtimeDimensions: videoDimensions,
        timeline: timelineRange,
      }),
    [featureKey, info, timelineRange, videoDimensions],
  );

  // One follower per element, alive as long as the panel.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const follower = new CameraFollower(video, clock, {
      id: `video:${featureKey}`,
      fps: () => fpsRef.current,
      range: () => rangeRef.current,
    });
    followerRef.current = follower;
    return () => {
      follower.dispose();
      followerRef.current = null;
    };
  }, [clock, featureKey]);

  /**
   * The held frame's one owner. A hold starts when a new URL of the shown
   * file replaces the old one, and ends on the first of: a painted frame of
   * the new URL, an `error`, an `emptied` / `abort` of the new load, or the
   * cap. After the cap the camera shows the normal loading state, and a
   * later failure its named error.
   */
  const holdTimerRef = useRef<number | null>(null);
  const holdLoadStartedRef = useRef(false);
  const releaseHold = useCallback(() => {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    holdLoadStartedRef.current = false;
    if (holdRef.current) holdRef.current.style.display = 'none';
  }, []);
  const isHolding = () => holdRef.current?.style.display === 'block';
  /** Draw the shown frame over the element (or keep the one already held). */
  const beginHold = useCallback(
    (video: HTMLVideoElement) => {
      const canvas = holdRef.current;
      if (!canvas) return;
      holdLoadStartedRef.current = false;
      // A newer URL while a frame is held (another swap) keeps that frame and its cap.
      if (canvas.style.display === 'block') return;
      if (video.readyState < 2 || video.videoWidth <= 0) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      canvas.style.display = 'block';
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null;
        if (!isHolding()) return;
        releaseHold();
        if (video.readyState < 2) {
          setHasVideo(false);
          setIsInitialLoading(true);
        }
      }, HOLD_CAP_MS);
    },
    [releaseHold],
  );
  useEffect(() => releaseHold, [releaseHold]);
  /**
   * Release the held frame once the element has painted a frame of its own
   * (data being ready is not yet a painted frame); a short fallback covers
   * browsers without frame callbacks.
   */
  const releaseHoldWhenPainted = useCallback(() => {
    const video = videoRef.current as
      (HTMLVideoElement & { requestVideoFrameCallback?: (callback: () => void) => number }) | null;
    if (!isHolding()) return;
    // A paused element may present its frame without a frame callback; the
    // data is in, so a short fallback ends the hold either way.
    const fallback = window.setTimeout(releaseHold, 500);
    video?.requestVideoFrameCallback?.(() => {
      window.clearTimeout(fallback);
      releaseHold();
    });
  }, [releaseHold]);

  /**
   * Point the element at `url`. `hold` (a new URL of the file already shown:
   * a refresh or another source of the same recording) keeps the current
   * frame on screen until the new one is ready, so the camera never blanks.
   */
  const setSource = useCallback(
    (path: string, url: string, retried: boolean, loader: unknown, hold = false) => {
      const video = videoRef.current;
      if (!video) return;
      if (hold) beginHold(video);
      else releaseHold();
      sourceRef.current = { path, loader, retried };
      video.preload = preloadRef.current;
      video.src = url;
      video.load();
    },
    [beginHold, releaseHold],
  );

  /** Swap in a new URL for the same file (refresh); the follower restores time and play state. */
  const swapSource = useCallback(
    async (retry: boolean) => {
      const current = sourceRef.current;
      if (!current || !dataLoader) return;
      const token = requestTokenRef.current;
      try {
        if (retry) await dataLoader.invalidateFileUrl(current.path);
        const url = await dataLoader.getFileUrl(current.path);
        if (token !== requestTokenRef.current || sourceRef.current?.path !== current.path) return;
        // A retry marks this URL generation as retried; a refresh-driven swap
        // starts a new generation that may be retried once again.
        setSource(current.path, url, retry, current.loader, true);
      } catch (error) {
        console.error('Failed to refresh video URL:', error);
        if (token === requestTokenRef.current) {
          setHasVideo(false);
          setLoadError(t('sidebar.errorLoading'));
        }
      }
    },
    [dataLoader, setSource, setLoadError, t],
  );

  useEffect(() => {
    if (!dataLoader) return;
    return dataLoader.subscribeUrlChanges((paths) => {
      const current = sourceRef.current;
      if (current && paths.includes(current.path)) void swapSource(false);
    });
  }, [dataLoader, swapSource]);

  // Element events: first frame, errors (one URL retry), dimensions.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLoadedMetadata = () => {
      setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
    };
    const onLoadedData = () => {
      // A URL that loaded is good: a later failure (a later expiry) may retry again.
      if (sourceRef.current) sourceRef.current.retried = false;
      setHasVideo(true);
      setLoadError(null);
      setIsInitialLoading(false);
      if (!video.seeking) releaseHoldWhenPainted();
    };
    // A held frame gives way once the new URL shows the clock's frame.
    const onSeeked = () => {
      if (video.readyState >= 2) releaseHoldWhenPainted();
    };
    const onError = () => {
      const current = sourceRef.current;
      if (!current || !video.getAttribute('src')) return;
      releaseHold();
      if (!current.retried) {
        void swapSource(true);
        return;
      }
      console.error('Video load error:', current.path);
      setHasVideo(false);
      setIsInitialLoading(false);
      setLoadError(t('sidebar.errorLoading'));
    };
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('loadeddata', onLoadedData);
    // The new load has begun; an `emptied` or `abort` after this ends it
    // without data (the ones the URL change itself fires come before).
    const onLoadStart = () => {
      if (isHolding()) holdLoadStartedRef.current = true;
    };
    const onLoadEnded = () => {
      if (!holdLoadStartedRef.current) return;
      releaseHold();
      if (video.readyState < 2) {
        setHasVideo(false);
        setIsInitialLoading(true);
      }
    };
    video.addEventListener('error', onError);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadstart', onLoadStart);
    video.addEventListener('emptied', onLoadEnded);
    video.addEventListener('abort', onLoadEnded);
    return () => {
      video.removeEventListener('loadstart', onLoadStart);
      video.removeEventListener('emptied', onLoadEnded);
      video.removeEventListener('abort', onLoadEnded);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('error', onError);
    };
  }, [swapSource, releaseHold, releaseHoldWhenPainted, setLoadError, t]);

  // A camera that goes away (unmount, a rebuilt layout) stops loading at once:
  // a detached element would otherwise keep reading its file, holding the
  // browser's connections to the storage host until it is collected.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (!video?.getAttribute('src')) return;
      video.removeAttribute('src');
      video.load();
    };
  }, []);

  // Episode or camera change: gate the codec, load the file if it changed,
  // then let the follower position the element from the clock.
  useEffect(() => {
    const token = ++requestTokenRef.current;
    const run = async () => {
      const video = videoRef.current;
      const result =
        info && dataLoader && selectedEpisodeIndex !== null
          ? dataLoader.getEpisodeVideoPath(selectedEpisodeIndex, featureKey)
          : null;
      if (!video || !result || !dataLoader || !info) {
        rangeRef.current = null;
        setCurrentVideoPath('');
        setTimelineRange(null);
        return;
      }
      const episode: EpisodeVideo = {
        path: result.path,
        start: result.fromSec ?? 0,
        end: result.toSec ?? 0,
      };
      const support = await checkVideoCodecSupport(info.features?.[featureKey]);
      if (token !== requestTokenRef.current) return;
      if (!support.supported) {
        rangeRef.current = null;
        sourceRef.current = null;
        video.removeAttribute('src');
        video.load();
        setUnsupportedCodec(support.codec);
        setHasVideo(false);
        setIsInitialLoading(false);
        return;
      }
      setUnsupportedCodec(null);
      setCurrentVideoPath(episode.path);
      setVideoDimensions(null);

      const sameFile = sourceRef.current?.path === episode.path;
      // A swapped-in source shows the same moment of the same recording:
      // its file replaces the shown one in place, holding the shown frame.
      const swapped = sourceRef.current !== null && sourceRef.current.loader !== dataLoader;
      if (!sameFile || swapped || failedRef.current) {
        if (!sameFile) rangeRef.current = null;
        if (!sourceRef.current) setIsInitialLoading(true);
        setLoadError(null);
        try {
          const url = await dataLoader.getFileUrl(episode.path);
          if (token !== requestTokenRef.current) return;
          setSource(episode.path, url, false, dataLoader, swapped);
        } catch (error) {
          if (token !== requestTokenRef.current) return;
          console.error('Failed to load video:', error);
          setLoadError(t('sidebar.errorLoading'));
          setIsInitialLoading(false);
          return;
        }
      }
      rangeRef.current = { start: episode.start, end: episode.end };
      setTimelineRange({
        startSec: episode.start,
        endSec:
          episode.end > 0 ? episode.end : Number.isFinite(video.duration) ? video.duration : 0,
      });
      followerRef.current?.sync();
    };
    void run();
    // `loadAttempt`: the episode is loaded again after its load failed.
  }, [selectedEpisodeIndex, info, dataLoader, featureKey, setSource, setLoadError, t, loadAttempt]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && video.preload !== preload) video.preload = preload;
  }, [preload]);

  /**
   * A camera that played and is now paused reloads its file at the shown
   * frame. Chromium may go on reading a file it read with preload="auto"
   * after preload turns to "metadata": the whole file, at full rate, while
   * `buffered` and `networkState` show nothing, holding one of the browser's
   * six connections to the storage host. The reload ends that response and
   * reads only what the frame needs (the bounded read of a camera opened
   * paused); the follower puts it back on the clock's frame, and the shown
   * frame is held over the element until the reloaded one is painted.
   */
  const wasPlayingRef = useRef(isPlaying);
  useEffect(() => {
    const video = videoRef.current;
    const wasPlaying = wasPlayingRef.current;
    wasPlayingRef.current = isPlaying;
    if (!video || isPlaying || !wasPlaying) return;
    let cancelled = false;
    let waits = 0;
    let timer = 0;
    const reload = () => {
      if (cancelled) return;
      const current = sourceRef.current;
      const url = video.getAttribute('src');
      if (!current || !url || preloadRef.current !== 'metadata' || !video.paused) return;
      // Once the pause has landed on the clock's frame, so that frame is the
      // one held: a camera that ran past the clock steps back first.
      const settled = followerRef.current?.isSettledWhilePaused() ?? !video.seeking;
      if (!settled || video.readyState < 2) {
        if (++waits > PAUSED_RELOAD_MAX_WAITS) return;
        if (video.seeking) video.addEventListener('seeked', reload, { once: true });
        else timer = window.setTimeout(reload, PAUSED_RELOAD_DELAY_MS);
        return;
      }
      setSource(current.path, url, current.retried, current.loader, true);
    };
    timer = window.setTimeout(reload, PAUSED_RELOAD_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      video.removeEventListener('seeked', reload);
    };
  }, [isPlaying, setSource]);

  useEffect(
    () => () => {
      requestTokenRef.current += 1;
    },
    [],
  );

  // With a host label, the technical details keep the feature key.
  const { name: cameraName, key: hiddenKey } = useCameraName(featureKey);

  return (
    <div className="group relative flex h-full w-full items-center justify-center overflow-hidden bg-black">
      <MediaDebugOverlay
        metadata={debugMetadata}
        translationPrefix="panels.video.debug"
        featureKey={hiddenKey}
      />

      <canvas
        ref={holdRef}
        aria-hidden
        data-testid="video-hold-frame"
        className="pointer-events-none absolute inset-0 z-[1] h-full w-full object-contain"
        style={{ display: 'none' }}
      />
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        style={{
          display: hasVideo ? 'block' : 'none',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden' as const,
        }}
        crossOrigin="anonymous"
        muted
        playsInline
        preload={preload}
        disablePictureInPicture
        disableRemotePlayback
      />

      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center text-center text-muted-foreground">
          <div>
            {unsupportedCodec ? (
              <div
                role="status"
                className="max-w-xs mx-auto px-4 text-sm"
                data-testid="video-codec-unsupported"
              >
                <div className="flex justify-center mb-2">
                  <AlertTriangle className="h-6 w-6" aria-hidden />
                </div>
                <p>
                  {t('panels.video.codecUnsupported', {
                    codec: unsupportedCodec.toUpperCase(),
                    camera: cameraName,
                  })}
                </p>
              </div>
            ) : isInitialLoading ? (
              <div role="status" aria-live="polite">
                <div
                  className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin motion-reduce:animate-none mx-auto mb-4"
                  aria-hidden
                />
                <p className="text-sm opacity-50">{t('panels.video.placeholder')}</p>
              </div>
            ) : loadError && failedEpisode === null ? (
              // When the whole episode failed, the viewer's failure line names it once.
              <div className="text-destructive max-w-xs mx-auto">
                <div className="flex justify-center mb-2">
                  <AlertTriangle className="h-8 w-8" />
                </div>
                <p className="font-medium">{loadError}</p>
                <p className="text-xs mt-2 opacity-70 break-all">{currentVideoPath}</p>
              </div>
            ) : (
              <>
                <p className="text-lg font-semibold">{t('panels.video.title')}</p>
                <p className="text-sm mt-2">{featureKey}</p>
                <p className="text-xs mt-4 opacity-50">{t('panels.video.placeholder')}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * 智能视频/图像面板 - 自动检测并使用正确的显示组件
 */
export const VideoPanel: React.FC<VideoPanelProps> = ({ params }) => {
  const { info } = useLeRobotData();

  // 自动检测featureKey：优先使用params中指定的，否则自动检测第一个可视化特征
  const featureKey = useMemo(() => {
    if (params?.featureKey) return params.featureKey;
    return getFirstVisualFeatureName(info) || 'observation.images.up';
  }, [params?.featureKey, info]);

  // 检测特征类型
  const displayType = useMemo(() => {
    return getFeatureDisplayType(info, featureKey);
  }, [info, featureKey]);

  // 创建新的params对象，包含自动检测的featureKey
  const effectiveParams = useMemo(
    () => ({
      ...params,
      featureKey,
    }),
    [params, featureKey],
  );

  // 根据类型选择正确的组件
  if (displayType === 'image') {
    return <ImagePanel params={effectiveParams} />;
  }

  // 默认使用视频播放器（包括 'video' 和 'none' 类型）
  return <VideoPanelContent params={effectiveParams} />;
};
