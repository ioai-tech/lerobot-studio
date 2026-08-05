import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLeRobotData, useLeRobotSelection } from '../../../contexts/LeRobotContext';
import { buildMediaDebugMetadata } from '@/core';
import { getFirstVisualFeatureName } from '@/core';
import { MediaDebugOverlay } from '../Common/MediaDebugOverlay';

interface ImagePanelProps {
  params?: {
    featureKey?: string;
  };
}

/**
 * ImagePanel - 高性能图像显示面板（canvas 版本）
 *
 * 优化策略：
 * 1. 预加载模式优先：episode 选中后，所有帧 ImageBitmap 已在 Worker 解码完毕，
 *    播放时通过 raw postMessage Transferable 传回，直接 canvas.drawImage()，
 *    全程零 React setState，零 Blob URL 创建，零图像解码开销。
 * 2. 回退模式：预加载未命中时（首帧或 episode 切换初期）退回 Comlink 按需加载。
 * 3. canvas 替代 <img>：帧更新直接操作 DOM，不触发 React reconciler。
 */
export const ImagePanel: React.FC<ImagePanelProps> = ({ params }) => {
  const { t } = useTranslation();
  const { info, dataLoader, imageService, subscribeFrameIndex } = useLeRobotData();
  const { selectedEpisodeIndex } = useLeRobotSelection();

  const featureKey = useMemo(() => {
    if (params?.featureKey) return params.featureKey;
    return getFirstVisualFeatureName(info) || 'observation.images.cam_high';
  }, [params?.featureKey, info]);

  // ─── UI 状态（仅在非播放路径上更新）───
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasImage, setHasImage] = useState(false);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(
    null,
  );

  // ─── Refs ───
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mountedRef = useRef(true);
  const selectedEpisodeRef = useRef<number | null>(selectedEpisodeIndex);
  const featureKeyRef = useRef(featureKey);
  const dataLoaderRef = useRef(dataLoader);
  const imageServiceRef = useRef(imageService);
  const infoRef = useRef(info);

  // 帧请求序号，防止乱序回写
  const requestSeqRef = useRef(0);
  // 当前正在处理的帧请求，防止并发
  const loadingRef = useRef(false);
  const queuedFrameRef = useRef<number | null>(null);
  const queueProcessingRef = useRef(false);

  selectedEpisodeRef.current = selectedEpisodeIndex;
  featureKeyRef.current = featureKey;
  dataLoaderRef.current = dataLoader;
  imageServiceRef.current = imageService;
  infoRef.current = info;

  // ─── canvas 绘制 ───
  const drawBitmap = useCallback(
    (bitmap: ImageBitmap) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 仅在尺寸变化时调整 canvas 分辨率
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        if (mountedRef.current) {
          setImageDimensions({ width: bitmap.width, height: bitmap.height });
        }
      }

      ctx.drawImage(bitmap, 0, 0);

      if (!hasImage && mountedRef.current) {
        setHasImage(true);
        setIsLoading(false);
      }
    },
    [hasImage],
  );

  const drawBitmapRef = useRef(drawBitmap);
  drawBitmapRef.current = drawBitmap;

  // ─── 帧加载队列处理 ───
  const processQueuedFrame = useCallback(() => {
    if (queueProcessingRef.current) return;
    queueProcessingRef.current = true;

    void (async () => {
      try {
        while (true) {
          const frameIndex = queuedFrameRef.current;
          if (frameIndex === null) break;
          queuedFrameRef.current = null;

          const episode = selectedEpisodeRef.current;
          if (episode === null) continue;

          const key = featureKeyRef.current;
          const loader = dataLoaderRef.current;
          const service = imageServiceRef.current;
          const currentInfo = infoRef.current;
          if (!loader || !currentInfo) continue;

          const pathResult = loader.getEpisodeDataPath(episode);
          if (!pathResult) {
            if (mountedRef.current) {
              setError('Cannot determine parquet file path');
              setIsLoading(false);
            }
            continue;
          }

          const requestSeq = ++requestSeqRef.current;

          // ── 优先走 Worker 的按需 ImageBitmap 零拷贝通道 ──
          try {
            const bitmap = await service.getFrameBitmap(key, frameIndex, pathResult.startRow);
            if (bitmap !== null) {
              const isStillCurrent =
                mountedRef.current &&
                requestSeq === requestSeqRef.current &&
                selectedEpisodeRef.current === episode &&
                featureKeyRef.current === key;
              if (isStillCurrent) {
                drawBitmapRef.current(bitmap);
                bitmap.close();
                setError(null);
                setIsLoading(false);
              } else {
                bitmap.close();
              }
              continue;
            }
            // null = Worker 未加载文件等，回退到按需 Comlink 路径（下面会 ensure 文件）
          } catch {
            // 回退
          }

          // ── 回退：按需 Comlink 加载 ──
          loadingRef.current = true;
          if (!hasImage && mountedRef.current) {
            setIsLoading(true);
          }

          try {
            const url = await service.getImageFrame(
              pathResult.path,
              key,
              Math.max(0, frameIndex),
              pathResult.startRow,
            );

            const isStillCurrent =
              mountedRef.current &&
              requestSeq === requestSeqRef.current &&
              selectedEpisodeRef.current === episode &&
              featureKeyRef.current === key;

            if (isStillCurrent) {
              // 将 URL 转成 ImageBitmap 并绘制
              const img = new Image();
              await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('Image decode failed'));
                img.src = url;
              });
              const bitmap = await createImageBitmap(img);
              drawBitmapRef.current(bitmap);
              bitmap.close();
              setError(null);
              setIsLoading(false);
            }
          } catch (e) {
            const isStillCurrent =
              mountedRef.current &&
              requestSeq === requestSeqRef.current &&
              selectedEpisodeRef.current === episode &&
              featureKeyRef.current === key;
            if (isStillCurrent) {
              setError(e instanceof Error ? e.message : 'Failed to load image');
              setIsLoading(false);
            }
          } finally {
            if (requestSeqRef.current === requestSeq) {
              loadingRef.current = false;
            }
          }
        }
      } finally {
        queueProcessingRef.current = false;
        if (queuedFrameRef.current !== null) {
          processQueuedFrame();
        }
      }
    })();
  }, [hasImage]);

  const processQueuedFrameRef = useRef(processQueuedFrame);
  processQueuedFrameRef.current = processQueuedFrame;

  const enqueueFrame = useCallback((frameIndex: number) => {
    if (selectedEpisodeRef.current === null) return;
    queuedFrameRef.current = frameIndex;
    processQueuedFrameRef.current();
  }, []);

  // ─── 订阅帧变化（核心热路径：播放时每帧触发）───
  useEffect(() => {
    const unsubscribe = subscribeFrameIndex((frameIndex) => {
      enqueueFrame(frameIndex);
    });
    return unsubscribe;
  }, [subscribeFrameIndex, enqueueFrame]);

  // ─── Episode 切换时重置 ───
  useEffect(() => {
    if (selectedEpisodeIndex === null) return;

    requestSeqRef.current += 1;
    queuedFrameRef.current = null;
    loadingRef.current = false;

    // 清空 canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }

    setHasImage(false);
    setImageDimensions(null);
    setIsLoading(false);
    setError(null);

    const timer = setTimeout(() => {
      enqueueFrame(0);
    }, 0);

    return () => clearTimeout(timer);
  }, [selectedEpisodeIndex, featureKey, enqueueFrame]);

  // ─── 挂载/卸载 ───
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSeqRef.current += 1;
      queuedFrameRef.current = null;
      loadingRef.current = false;
    };
  }, []);

  const featureExists = useMemo(() => {
    if (!info?.features) return false;
    const feature = info.features[featureKey];
    return feature && feature.dtype === 'image';
  }, [info, featureKey]);

  const debugMetadata = useMemo(
    () =>
      buildMediaDebugMetadata(info, featureKey, {
        runtimeDimensions: imageDimensions,
      }),
    [featureKey, imageDimensions, info],
  );

  return (
    <div className="group relative flex h-full w-full items-center justify-center overflow-hidden bg-black">
      <MediaDebugOverlay
        featureKey={featureKey}
        metadata={debugMetadata}
        translationPrefix="panels.image.debug"
      />

      {/* canvas 始终保留，帧更新直接 drawImage，无 React 渲染 */}
      <canvas
        ref={canvasRef}
        className="h-full w-full object-contain"
        style={{
          display: hasImage ? 'block' : 'none',
          transform: 'translateZ(0)',
          imageRendering: 'auto',
        }}
      />

      {/* 加载状态 */}
      {isLoading && !hasImage && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          role="status"
          aria-live="polite"
        >
          <div className="text-center text-muted-foreground">
            <div
              className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin motion-reduce:animate-none mx-auto mb-4"
              aria-hidden
            />
            <p className="text-sm opacity-50">{t('common.loading')}</p>
          </div>
        </div>
      )}

      {/* 错误状态 */}
      {error && !hasImage && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-destructive p-4">
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* 无内容占位 */}
      {!hasImage && !isLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-center text-muted-foreground">
          <div>
            <p className="text-lg font-semibold">{t('panels.image.title')}</p>
            <p className="text-sm mt-2">{featureKey}</p>
            {!featureExists && (
              <p className="text-xs mt-4 text-destructive">
                {t('panels.image.featureNotFound', { key: featureKey })}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
