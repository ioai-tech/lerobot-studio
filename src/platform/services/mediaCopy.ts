import type { LeRobotDataLoader } from './LeRobotDataLoader';

export type MediaCopyResult = 'clipboard' | 'download';

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode canvas'));
    }, type);
  });
}

function drawBitmapToCanvas(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable');
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

export function sanitizeMediaFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'media';
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function writePngBlobToClipboardOrDownload(
  blob: Blob,
  filename: string,
): Promise<MediaCopyResult> {
  const ClipboardItemCtor = typeof ClipboardItem !== 'undefined' ? ClipboardItem : null;
  if (navigator.clipboard?.write && ClipboardItemCtor) {
    try {
      await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
      return 'clipboard';
    } catch {
      // Fall through to download fallback when browser policy blocks image clipboard writes.
    }
  }

  downloadBlob(blob, filename);
  return 'download';
}

export async function imageBytesToPngBlob(bytes: Uint8Array): Promise<Blob> {
  const bitmap = await createImageBitmap(new Blob([copyToArrayBuffer(bytes)]));
  try {
    const canvas = drawBitmapToCanvas(bitmap);
    return await canvasToBlob(canvas, 'image/png');
  } finally {
    bitmap.close();
  }
}

export async function copyImageBytesAsPng(
  bytes: Uint8Array,
  filenameBase: string,
): Promise<MediaCopyResult> {
  const blob = await imageBytesToPngBlob(bytes);
  return writePngBlobToClipboardOrDownload(blob, `${sanitizeMediaFilename(filenameBase)}.png`);
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let handleEvent = () => {};
    let handleError = () => {};

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for video ${eventName}`));
    }, 10000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener(eventName, handleEvent);
      video.removeEventListener('error', handleError);
    };

    handleEvent = () => {
      cleanup();
      resolve();
    };

    handleError = () => {
      cleanup();
      reject(new Error('Failed to load video'));
    };

    video.addEventListener(eventName, handleEvent, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });
}

export async function getVideoFramePngBlob(
  dataLoader: LeRobotDataLoader,
  episodeIndex: number,
  featureKey: string,
  frameIndex: number,
  fps: number,
): Promise<Blob> {
  const videoInfo = dataLoader.getEpisodeVideoPath(episodeIndex, featureKey);
  if (!videoInfo) {
    throw new Error(`Video feature ${featureKey} is not available for episode ${episodeIndex}`);
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.style.position = 'fixed';
  video.style.left = '-10000px';
  video.style.top = '-10000px';
  video.style.width = '1px';
  video.style.height = '1px';

  document.body.appendChild(video);
  try {
    const url = await dataLoader.getFileUrl(videoInfo.path);
    video.src = url;
    video.load();
    await waitForVideoEvent(video, 'loadedmetadata');

    const start = videoInfo.fromSec ?? 0;
    const end = videoInfo.toSec && videoInfo.toSec > 0 ? videoInfo.toSec : video.duration;
    const targetTime = Math.max(start, Math.min(start + frameIndex / fps, end));

    if (Math.abs(video.currentTime - targetTime) > 0.001) {
      video.currentTime = targetTime;
      await waitForVideoEvent(video, 'seeked');
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      throw new Error('Video dimensions are unavailable');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable');
    ctx.drawImage(video, 0, 0, width, height);
    return await canvasToBlob(canvas, 'image/png');
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    document.body.removeChild(video);
  }
}

export async function copyVideoFrameAsPng(
  dataLoader: LeRobotDataLoader,
  episodeIndex: number,
  featureKey: string,
  frameIndex: number,
  fps: number,
  filenameBase: string,
): Promise<MediaCopyResult> {
  const blob = await getVideoFramePngBlob(dataLoader, episodeIndex, featureKey, frameIndex, fps);
  return writePngBlobToClipboardOrDownload(blob, `${sanitizeMediaFilename(filenameBase)}.png`);
}
