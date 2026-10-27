import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AlertTriangle, Maximize, Maximize2, Minimize, Minimize2, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DockviewApi, DockviewPanelApi } from 'dockview-react';
import { useLeRobotData } from '../../../contexts/LeRobotContext';
import { buildMediaDebugMetadata } from '@/core';
import { getFeatureDisplayType, getFirstVisualFeatureName } from '@/core';
import { ImagePanel } from '../ImagePanel/ImagePanel';
import { MediaDebugOverlay } from '../Common/MediaDebugOverlay';
import { useVideoStage } from '../../../contexts/VideoStageContext';
import { useVideoVariant } from '../../../contexts/VideoVariantContext';
import type { CameraPlayer, CameraSnapshot } from '../../../services/video/CameraPlayer';

interface VideoPanelProps {
  params?: {
    featureKey?: string;
  };
  /** The dockview panel (focus / maximize); absent outside dockview. */
  panelApi?: DockviewPanelApi;
  containerApi?: DockviewApi;
}

const EMPTY_SNAPSHOT: CameraSnapshot = {
  status: 'empty',
  buffering: false,
  switching: false,
  rendition: null,
  pendingRendition: null,
  errorCode: null,
  path: null,
  width: 0,
  height: 0,
  start: null,
  end: null,
};
const noopSubscribe = () => () => undefined;

/** `flag`, but only after it stayed true for `delayMs` (no spinner flash on fast operations). */
function useDelayedFlag(flag: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!flag) {
      setShown(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [flag, delayMs]);
  return flag && shown;
}

function useCameraSnapshot(player: CameraPlayer | null): CameraSnapshot {
  return useSyncExternalStore(
    player?.subscribe ?? noopSubscribe,
    player?.getSnapshot ?? (() => EMPTY_SNAPSHOT),
    () => EMPTY_SNAPSHOT,
  );
}

function useMaximized(panelApi?: DockviewPanelApi, containerApi?: DockviewApi): boolean {
  const [maximized, setMaximized] = useState(() => panelApi?.isMaximized() ?? false);
  useEffect(() => {
    if (!panelApi || !containerApi) return;
    const update = () => setMaximized(panelApi.isMaximized());
    update();
    const disposable = containerApi.onDidMaximizedGroupChange(update);
    return () => disposable.dispose();
  }, [panelApi, containerApi]);
  return maximized;
}

function useFullscreen(element: React.RefObject<HTMLElement | null>): boolean {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const update = () =>
      setFullscreen(Boolean(element.current) && document.fullscreenElement === element.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, [element]);
  return fullscreen;
}

/**
 * One camera. The <video> elements belong to the viewer's video stage and outlive this panel: a
 * layout rebuild moves them into the new panel instead of reloading them.
 */
const VideoPanelContent: React.FC<VideoPanelProps> = ({ params, panelApi, containerApi }) => {
  const { t } = useTranslation();
  const { info } = useLeRobotData();
  const stage = useVideoStage();
  const { variant, previewVideoPath } = useVideoVariant();
  const featureKey = params?.featureKey || 'observation.images.up';
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<CameraPlayer | null>(null);
  const snapshot = useCameraSnapshot(player);
  const maximized = useMaximized(panelApi, containerApi);
  const fullscreen = useFullscreen(rootRef);
  const focused = maximized || fullscreen;

  useEffect(() => {
    if (!stage) return;
    stage.setFocusedCamera(featureKey, focused);
    return () => stage.setFocusedCamera(featureKey, false);
  }, [stage, featureKey, focused]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!stage || !host) return;
    const detach = stage.attach(featureKey, host);
    // the camera is looked up on every attach: a remount may get a new one
    setPlayer(stage.player(featureKey));
    return detach;
  }, [stage, featureKey]);

  const toggleMaximize = useCallback(() => {
    if (!panelApi) return;
    if (panelApi.isMaximized()) panelApi.exitMaximized();
    else panelApi.maximize();
  }, [panelApi]);

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement === root) {
      void document.exitFullscreen?.().catch(() => undefined);
    } else {
      void root.requestFullscreen?.().catch(() => undefined);
    }
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === 'f') {
        event.preventDefault();
        toggleFullscreen();
      } else if (key === 'm' && panelApi) {
        event.preventDefault();
        toggleMaximize();
      } else if (event.key === 'Escape' && panelApi?.isMaximized()) {
        event.preventDefault();
        panelApi.exitMaximized();
      }
    },
    [panelApi, toggleFullscreen, toggleMaximize],
  );

  const debugMetadata = useMemo(
    () =>
      buildMediaDebugMetadata(info, featureKey, {
        runtimeDimensions:
          snapshot.width && snapshot.height
            ? { width: snapshot.width, height: snapshot.height }
            : null,
        timeline:
          snapshot.start !== null
            ? { startSec: snapshot.start, endSec: snapshot.end ?? snapshot.start }
            : null,
      }),
    [featureKey, info, snapshot.end, snapshot.height, snapshot.start, snapshot.width],
  );

  const hasFrame = snapshot.status === 'ready';
  const showBusy = useDelayedFlag(hasFrame && (snapshot.buffering || snapshot.switching), 250);
  // Original chosen, but this camera plays the preview (the link carries fewer originals)
  const onPreview =
    hasFrame &&
    Boolean(previewVideoPath) &&
    variant === 'original' &&
    (snapshot.rendition === 'preview' || snapshot.pendingRendition === 'original');
  const title = featureKey.split('.').pop() || featureKey;

  return (
    <div
      ref={rootRef}
      className="group relative flex h-full w-full items-center justify-center overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-camera={featureKey}
      data-camera-status={snapshot.status}
      data-video-error={snapshot.errorCode ?? undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={t('panels.video.cameraLabel', { name: title })}
    >
      {/* The stage appends this camera's <video> elements here; React renders no children in it. */}
      <div ref={hostRef} className="absolute inset-0" />

      <MediaDebugOverlay metadata={debugMetadata} translationPrefix="panels.video.debug" />

      {!hasFrame && snapshot.status !== 'error' && (
        <div
          className="absolute inset-0 z-[2] flex items-center justify-center bg-muted/40 text-center text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-3">
            {snapshot.status === 'loading' ? (
              <div
                className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : null}
            <p className="text-xs font-medium opacity-70">{title}</p>
            <p className="text-[10px] uppercase tracking-widest opacity-50">
              {t('panels.video.placeholder')}
            </p>
          </div>
        </div>
      )}

      {showBusy && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center"
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

      {snapshot.status === 'error' && (
        <div className="absolute inset-0 z-[3] flex items-center justify-center bg-black/70 p-4 text-center">
          <div className="max-w-xs text-destructive-foreground">
            <div className="mb-2 flex justify-center text-destructive">
              <AlertTriangle className="h-8 w-8" aria-hidden />
            </div>
            <p className="font-medium text-white">
              {snapshot.errorCode === 'VIDEO_URL_REFUSED'
                ? t('panels.video.errors.urlRefused')
                : t('panels.video.errors.unavailable')}
            </p>
            {snapshot.path ? (
              <p className="mt-2 break-all text-xs text-white/60">{snapshot.path}</p>
            ) : null}
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-1.5 text-xs text-white hover:bg-white/25"
              onClick={() => player?.retryNow()}
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              {t('common.retry')}
            </button>
          </div>
        </div>
      )}

      {onPreview ? (
        <div
          className="pointer-events-none absolute left-2 top-2 z-[4] flex items-center gap-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white"
          data-camera-rendition={snapshot.rendition ?? undefined}
          data-camera-upgrading={snapshot.pendingRendition === 'original' ? 'true' : undefined}
        >
          {snapshot.pendingRendition === 'original' ? (
            <>
              <span
                className="h-2.5 w-2.5 rounded-full border border-white border-t-transparent animate-spin motion-reduce:animate-none"
                aria-hidden
              />
              {t('panels.video.rendition.loadingOriginal')}
            </>
          ) : (
            t('panels.video.rendition.preview')
          )}
        </div>
      ) : null}

      <div className="absolute right-2 top-2 z-[4] flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100">
        {panelApi ? (
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-black/50 text-white hover:bg-black/70"
            onClick={toggleMaximize}
            aria-label={maximized ? t('panels.video.restore') : t('panels.video.maximize')}
            aria-pressed={maximized}
            title={`${maximized ? t('panels.video.restore') : t('panels.video.maximize')} (M)`}
          >
            {maximized ? (
              <Minimize2 className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        ) : null}
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-black/50 text-white hover:bg-black/70"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? t('panels.video.exitFullscreen') : t('panels.video.fullscreen')}
          aria-pressed={fullscreen}
          title={`${fullscreen ? t('panels.video.exitFullscreen') : t('panels.video.fullscreen')} (F)`}
        >
          {fullscreen ? (
            <Minimize className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Maximize className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
};

/**
 * 智能视频/图像面板 - 自动检测并使用正确的显示组件
 */
export const VideoPanel: React.FC<VideoPanelProps> = ({ params, panelApi, containerApi }) => {
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

  const effectiveParams = useMemo(
    () => ({
      ...params,
      featureKey,
    }),
    [params, featureKey],
  );

  if (displayType === 'image') {
    return <ImagePanel params={effectiveParams} />;
  }

  // 默认使用视频播放器（包括 'video' 和 'none' 类型）
  return (
    <VideoPanelContent params={effectiveParams} panelApi={panelApi} containerApi={containerApi} />
  );
};
