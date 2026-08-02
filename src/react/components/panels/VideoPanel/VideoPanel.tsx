import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLeRobot } from '../../../contexts/LeRobotContext';
import { buildMediaDebugMetadata } from '@/core';
import { VideoUrlCache } from '@/platform';
import { getFeatureDisplayType, getFirstVisualFeatureName } from '@/core';
import { ImagePanel } from '../ImagePanel/ImagePanel';
import { MediaDebugOverlay } from '../Common/MediaDebugOverlay';

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
  const { info, selectedEpisodeIndex, dataLoader, subscribeFrameIndex } = useLeRobot();

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
    (episodeIndex: number) => {
      if (!dataLoader) return null;
      const result = dataLoader.getEpisodeVideoPath(episodeIndex, featureKey);
      if (!result) return null;
      return {
        path: result.path,
        start: result.fromSec ?? 0,
        end: result.toSec ?? 0,
      };
    },
    [dataLoader, featureKey],
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

      const videoInfo = getVideoFileInfo(selectedEpisodeIndex);
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

        // 纯 seek 操作，无任何 UI 更新
        if (video.readyState >= 2) {
          video.currentTime = start;
        } else {
          const handleReady = () => {
            if (requestToken !== requestTokenRef.current) {
              video.removeEventListener('canplay', handleReady);
              return;
            }
            video.currentTime = start;
            video.removeEventListener('canplay', handleReady);
          };
          video.addEventListener('canplay', handleReady, { once: true });
        }
      }
    };

    handleEpisodeChange();
  }, [selectedEpisodeIndex, info, dataLoader, featureKey, getVideoFileInfo, loadVideoFileSilent]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestTokenRef.current += 1;
    };
  }, []);

  /**
   * 帧同步 - 纯 seek，零开销
   */
  useEffect(() => {
    if (!hasVideo || !episodeRangeRef.current) return;

    const unsubscribe = subscribeFrameIndex((frameIndex) => {
      const video = videoRef.current;
      const range = episodeRangeRef.current;

      if (!video || !range || video.readyState < 2) return;

      const fps = info?.fps ?? 30;
      const targetTime = Math.max(range.start, Math.min(range.start + frameIndex / fps, range.end));

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
  }, [hasVideo, info, subscribeFrameIndex]);

  return (
    <div className="group relative flex h-full w-full items-center justify-center overflow-hidden bg-black">
      <MediaDebugOverlay
        featureKey={featureKey}
        metadata={debugMetadata}
        translationPrefix="panels.video.debug"
      />

      {/* Video - 始终可见，无过渡效果 */}
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        style={{
          display: hasVideo ? 'block' : 'none',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden' as const,
        }}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
      />

      {/* 占位符 - 只在没有视频时显示 */}
      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center text-center text-muted-foreground">
          <div>
            {isInitialLoading ? (
              <>
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-sm opacity-50">{t('panels.video.placeholder')}</p>
              </>
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
  const { info } = useLeRobot();

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
