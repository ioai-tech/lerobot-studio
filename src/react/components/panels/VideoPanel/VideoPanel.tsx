import React, { useEffect, useRef, useState, useCallback, useMemo, useId } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLeRobotData, useLeRobotSelection } from '../../../contexts/LeRobotContext';
import { buildMediaDebugMetadata } from '@/core';
import { VideoUrlCache } from '@/platform';
import { getFeatureDisplayType, getFirstVisualFeatureName } from '@/core';
import { ImagePanel } from '../ImagePanel/ImagePanel';
import { MediaDebugOverlay } from '../Common/MediaDebugOverlay';
import { useVideoVariant } from '../../../contexts/VideoVariantContext';

interface VideoPanelProps {
  params?: {
    featureKey?: string;
  };
}

/**
 * 彻底优化的 VideoPanel - 零闪烁视频播放
 *
 * 关键设计：
 * 1. 视频元素始终可见，不使用 opacity 切换
 * 2. 只在真正需要加载新文件时才显示加载状态
 * 3. Episode 切换只是纯 seek，不触发任何 UI 更新
 * 4. 完全利用浏览器视频缓冲机制
 */
const VideoPanelContent: React.FC<VideoPanelProps> = ({ params }) => {
  const { t } = useTranslation();
  const { info, dataLoader, subscribeFrameIndex, getFrameIndex, mediaSync } = useLeRobotData();
  const { previewVideoPath, variant } = useVideoVariant();
  const panelId = useId();
  const { selectedEpisodeIndex } = useLeRobotSelection();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false); // 是否有可用的视频

  const [isInitialLoading, setIsInitialLoading] = useState(false); // 仅用于初始加载
  const [loadError, setLoadError] = useState<string | null>(null);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [timelineRange, setTimelineRange] = useState<{ startSec: number; endSec: number } | null>(
    null,
  );
  const [currentVideoPath, setCurrentVideoPath] = useState<string>('');
  const [isBuffering, setIsBuffering] = useState(false);

  // 当前加载的视频文件（文件级别）
  const currentVideoFileRef = useRef<{
    path: string;
    url: string;
    duration: number;
  } | null>(null);

  // 当前 episode 时间范围
  const episodeRangeRef = useRef<{
    start: number;
    end: number;
  } | null>(null);

  /** 容量保持较小；blob 生命周期以 DataSource 为准，避免与 OBJECT_URL_CACHE_SIZE 脱节 */
  const videoCacheRef = useRef<VideoUrlCache>(new VideoUrlCache(8));
  const lastSeekTimeRef = useRef<number>(0);
  const requestTokenRef = useRef(0);
  const mountedRef = useRef(true);

  const featureKey = params?.featureKey || 'observation.images.up';

  const debugMetadata = useMemo(
    () =>
      buildMediaDebugMetadata(info, featureKey, {
        runtimeDimensions: videoDimensions,
        timeline: timelineRange,
      }),
    [featureKey, info, timelineRange, videoDimensions],
  );

  /**
   * 获取 episode 的视频文件信息（版本无关，由 dataLoader 委托适配器解析）
   */
  const getVideoFileInfo = useCallback(
    async (episodeIndex: number) => {
      if (!dataLoader) return null;
      const result = dataLoader.getEpisodeVideoPath(episodeIndex, featureKey);
      if (!result) return null;
      let path = result.path;
      // 预览副本与原视频同帧、同时间戳，只是分辨率/码率更低；不存在时回退原视频
      if (variant === 'preview' && previewVideoPath) {
        const preview = dataLoader.getEpisodeVideoPath(episodeIndex, featureKey, previewVideoPath);
        if (preview && (await dataLoader.dataSource.exists(preview.path).catch(() => false))) {
          path = preview.path;
        }
      }
      return {
        path,
        start: result.fromSec ?? 0,
        end: result.toSec ?? 0,
      };
    },
    [dataLoader, featureKey, previewVideoPath, variant],
  );

  /**
   * 加载视频文件（静默加载，不显示 loading UI）
   */
  const loadVideoFileSilent = useCallback(
    async (path: string, allowRetry = true): Promise<boolean> => {
      const requestToken = requestTokenRef.current;
      if (!dataLoader) return false;

      const resolvePlay = (url: string, suppressErrorUi: boolean): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
          const video = videoRef.current;
          if (!video) {
            resolve(false);
            return;
          }

          const isFirstLoad = !currentVideoFileRef.current;
          if (isFirstLoad) {
            if (mountedRef.current && requestToken === requestTokenRef.current) {
              setIsInitialLoading(true);
              setLoadError(null);
            }
          }

          const handleLoadedMetadata = () => {
            if (!mountedRef.current || requestToken !== requestTokenRef.current) {
              return;
            }
            currentVideoFileRef.current = {
              path,
              url,
              duration: video.duration,
            };
            setCurrentVideoPath(path);
            setVideoDimensions({
              width: video.videoWidth,
              height: video.videoHeight,
            });
          };

          const handleCanPlay = () => {
            if (mountedRef.current && requestToken === requestTokenRef.current) {
              setHasVideo(true);
              setLoadError(null);
              if (isFirstLoad) {
                setIsInitialLoading(false);
              }
            }
            resolve(true);
          };

          const handleError = () => {
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('canplay', handleCanPlay);
            video.removeEventListener('error', handleError);

            console.error('Video load error:', path);
            if (
              !suppressErrorUi &&
              mountedRef.current &&
              requestToken === requestTokenRef.current
            ) {
              setHasVideo(false);
              setLoadError(t('sidebar.errorLoading'));
              if (isFirstLoad) {
                setIsInitialLoading(false);
              }
            }
            resolve(false);
          };

          video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
          video.addEventListener('canplay', handleCanPlay, { once: true });
          video.addEventListener('error', handleError, { once: true });

          video.src = url;
          video.preload = 'auto';
          video.load();
        });
      };

      try {
        let url = videoCacheRef.current.get(path);
        if (!url) {
          url = await dataLoader.getFileUrl(path);
          videoCacheRef.current.getUrl(path, url);
        }

        let ok = await resolvePlay(url, allowRetry);
        if (!ok && allowRetry) {
          try {
            videoCacheRef.current.invalidate(path);
            await dataLoader.invalidateFileUrl(path);
            const freshUrl = await dataLoader.getFileUrl(path);
            videoCacheRef.current.getUrl(path, freshUrl);
            ok = await resolvePlay(freshUrl, false);
          } catch (retryErr) {
            console.error('Failed to recover video after invalidate:', retryErr);
            if (mountedRef.current && requestToken === requestTokenRef.current) {
              setLoadError(t('sidebar.errorLoading'));
              setIsInitialLoading(false);
            }
            return false;
          }
        }
        return ok;
      } catch (e) {
        console.error('Failed to load video:', e);
        if (mountedRef.current && requestToken === requestTokenRef.current) {
          setLoadError(t('sidebar.errorLoading'));
          setIsInitialLoading(false);
        }
        return false;
      }
    },
    [dataLoader, t],
  );

  /**
   * Episode 切换处理
   */
  useEffect(() => {
    const handleEpisodeChange = async () => {
      const requestToken = ++requestTokenRef.current;
      if (!info || selectedEpisodeIndex === null || !dataLoader) {
        if (mountedRef.current && requestToken === requestTokenRef.current) {
          setCurrentVideoPath('');
          setTimelineRange(null);
        }
        return;
      }

      const videoInfo = await getVideoFileInfo(selectedEpisodeIndex);
      if (requestToken !== requestTokenRef.current) return;
      if (!videoInfo) {
        if (mountedRef.current && requestToken === requestTokenRef.current) {
          setCurrentVideoPath('');
          setTimelineRange(null);
        }
        return;
      }

      const { path, start, end } = videoInfo;
      const video = videoRef.current;
      if (!video) return;
      if (mountedRef.current && requestToken === requestTokenRef.current) {
        setVideoDimensions(null);
      }

      // 检查是否需要加载新文件
      const isSameFile = currentVideoFileRef.current?.path === path;

      if (!isSameFile) {
        // 加载新文件（静默，除非是第一次）
        const loaded = await loadVideoFileSilent(path);
        if (!loaded || requestToken !== requestTokenRef.current) return;
      }

      // 更新 episode 时间范围
      if (currentVideoFileRef.current) {
        const episodeEnd = end > 0 ? end : currentVideoFileRef.current.duration;
        episodeRangeRef.current = { start, end: episodeEnd };
        if (mountedRef.current && requestToken === requestTokenRef.current) {
          setTimelineRange({ startSec: start, endSec: episodeEnd });
        }

        // 纯 seek：新 episode 帧号已归零；切换清晰度时保持当前帧
        const target = Math.min(start + getFrameIndex() / (info.fps || 30), episodeEnd);
        if (video.readyState >= 2) {
          video.currentTime = target;
        } else {
          const handleReady = () => {
            if (requestToken !== requestTokenRef.current) {
              video.removeEventListener('canplay', handleReady);
              return;
            }
            video.currentTime = Math.min(start + getFrameIndex() / (info.fps || 30), episodeEnd);
            video.removeEventListener('canplay', handleReady);
          };
          video.addEventListener('canplay', handleReady, { once: true });
        }
      }
    };

    handleEpisodeChange();
  }, [
    selectedEpisodeIndex,
    info,
    dataLoader,
    featureKey,
    getVideoFileInfo,
    getFrameIndex,
    loadVideoFileSilent,
  ]);

  /**
   * 播放中途失败（典型：预签名 URL 过期后浏览器的下一次 Range 请求被拒）：换新 URL，保持时间点。
   * 暂停中的视频由 MediaSync 在下一次缓冲恢复时重新 play。
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!hasVideo || !video || !dataLoader) return;
    let recovering = false;
    const onError = () => {
      const file = currentVideoFileRef.current;
      // 只处理已加载文件的失败；切换文件时的失败由 loadVideoFileSilent 自己重试
      if (
        recovering ||
        !file ||
        video.currentSrc !== new URL(file.url, window.location.href).href
      ) {
        return;
      }
      recovering = true;
      const resumeAt = video.currentTime;
      void (async () => {
        try {
          videoCacheRef.current.invalidate(file.path);
          await dataLoader.invalidateFileUrl(file.path);
          const url = await dataLoader.getFileUrl(file.path);
          videoCacheRef.current.getUrl(file.path, url);
          currentVideoFileRef.current = { ...file, url };
          video.src = url;
          video.load();
          video.addEventListener(
            'loadedmetadata',
            () => {
              video.currentTime = resumeAt;
            },
            { once: true },
          );
        } catch (e) {
          console.error('Failed to recover video after a playback error:', e);
          setLoadError(t('sidebar.errorLoading'));
        } finally {
          recovering = false;
        }
      })();
    };
    video.addEventListener('error', onError);
    return () => video.removeEventListener('error', onError);
  }, [hasVideo, dataLoader, t]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestTokenRef.current += 1;
    };
  }, []);

  /**
   * 播放时由 MediaSync 驱动原生 play()（主视频即时钟），暂停/拖动/逐帧时仍按帧 seek。
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!hasVideo || !video) return;
    return mediaSync.register(panelId, {
      video,
      getStart: () => episodeRangeRef.current?.start ?? null,
    });
  }, [hasVideo, mediaSync, panelId]);

  /** 缓冲提示：数据不足以继续播放（或 seek 到未缓冲位置）时显示 */
  useEffect(() => {
    const video = videoRef.current;
    if (!hasVideo || !video) return;
    const HAVE_FUTURE_DATA = 3;
    const onWaiting = () => setIsBuffering(true);
    const onSeeking = () => {
      if (video.readyState < HAVE_FUTURE_DATA) setIsBuffering(true);
    };
    const onReady = () => setIsBuffering(false);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('seeking', onSeeking);
    for (const event of ['canplay', 'canplaythrough', 'playing', 'seeked'] as const) {
      video.addEventListener(event, onReady);
    }
    return () => {
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('seeking', onSeeking);
      for (const event of ['canplay', 'canplaythrough', 'playing', 'seeked'] as const) {
        video.removeEventListener(event, onReady);
      }
    };
  }, [hasVideo]);

  /**
   * 帧同步 - 纯 seek，零开销
   */
  useEffect(() => {
    if (!hasVideo || !episodeRangeRef.current) return;

    const unsubscribe = subscribeFrameIndex((frameIndex) => {
      const video = videoRef.current;
      const range = episodeRangeRef.current;

      if (!video || !range || video.readyState < 1) return;

      const fps = info?.fps ?? 30;
      const targetTime = Math.max(range.start, Math.min(range.start + frameIndex / fps, range.end));

      if (mediaSync.isActive()) {
        // 原生播放中：帧号来自主视频，只跟随跳转（点击时间轴、逐帧）
        if (Math.abs(video.currentTime - targetTime) > 0.3) video.currentTime = targetTime;
        return;
      }
      if (video.readyState < 2) return;

      // 节流
      const now = Date.now();
      if (now - lastSeekTimeRef.current < 16) return;

      // Seek
      const timeDiff = Math.abs(video.currentTime - targetTime);
      if (timeDiff > 0.033) {
        video.currentTime = targetTime;
        lastSeekTimeRef.current = now;
      }
    });

    return unsubscribe;
  }, [hasVideo, info, mediaSync, subscribeFrameIndex]);

  return (
    <div className="group relative flex h-full w-full items-center justify-center overflow-hidden bg-black">
      <MediaDebugOverlay metadata={debugMetadata} translationPrefix="panels.video.debug" />

      {/* Video - 始终可见，无过渡效果 */}
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
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
      />

      {hasVideo && isBuffering && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="flex items-center gap-2 rounded-md bg-black/60 px-3 py-2 text-xs text-white">
            <div
              className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin motion-reduce:animate-none"
              aria-hidden
            />
            {t('panels.video.buffering')}
          </div>
        </div>
      )}

      {/* 占位符 - 只在没有视频时显示 */}
      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center text-center text-muted-foreground">
          <div>
            {isInitialLoading ? (
              <div role="status" aria-live="polite">
                <div
                  className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin motion-reduce:animate-none mx-auto mb-4"
                  aria-hidden
                />
                <p className="text-sm opacity-50">{t('panels.video.placeholder')}</p>
              </div>
            ) : loadError ? (
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
