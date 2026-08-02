import type { LeRobotDataLoader } from '../services/LeRobotDataLoader';
import type { LeRobotInfo, EpisodeMetadata } from '@ioai/lerobot-studio-core';
import type { ExportAdapter } from '@ioai/lerobot-studio-core';
import type { ExportProgress, EpisodeVideoOffsets, TargetVersion } from '@ioai/lerobot-studio-core';

const CHUNK_SIZE_DEFAULT = 1000;

export type ImageVideoEncodingOptions = {
  /** H.264 is the safest default for MP4 in browsers. VP9 is available for WebM. */
  codec?: 'avc' | 'vp9';
  /** Target bitrate in bits per second. Defaults to ~quality 'medium'. */
  bitrate?: number;
  /** Cooperative cancellation. */
  signal?: AbortSignal;
};

/**
 * Return the list of feature keys that are stored as individual images (one
 * per frame) and should be re-encoded as a video during export.
 */
export function getImageFeatureKeys(info: LeRobotInfo): string[] {
  return Object.entries(info.features)
    .filter(([, f]) => f?.dtype === 'image')
    .map(([k]) => k);
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

async function decodeFrameToBitmap(bytes: Uint8Array): Promise<ImageBitmap | null> {
  try {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const blob = new Blob([copy]);
    return await createImageBitmap(blob);
  } catch (e) {
    console.warn('Failed to decode image frame', e);
    return null;
  }
}

/**
 * Encode a sequence of compressed image bytes into a single MP4 using
 * Mediabunny's CanvasSource.  Each item in `frames` is a standalone encoded
 * image (JPG/PNG bytes); we decode via `createImageBitmap`, draw on a canvas,
 * and feed it to the encoder.
 */
async function encodeFramesToMp4(
  frames: Uint8Array[],
  fps: number,
  options: ImageVideoEncodingOptions | undefined,
  signal?: AbortSignal,
): Promise<{ buffer: ArrayBuffer; duration: number } | null> {
  if (frames.length === 0) return null;
  assertNotAborted(signal);
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource } = await import('mediabunny');

  const firstBitmap = await decodeFrameToBitmap(frames[0]);
  if (!firstBitmap) return null;
  // H.264/AVC requires even frame dimensions; pad odd sizes up by 1px.
  const width = firstBitmap.width + (firstBitmap.width % 2);
  const height = firstBitmap.height + (firstBitmap.height % 2);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    firstBitmap.close?.();
    return null;
  }

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const canvasSource = new CanvasSource(canvas, {
    codec: options?.codec ?? 'avc',
    bitrate: options?.bitrate ?? 4_000_000,
  });
  output.addVideoTrack(canvasSource, { frameRate: fps });
  await output.start();

  const frameDuration = 1 / fps;
  let currentBitmap: ImageBitmap | null = firstBitmap;

  try {
    for (let i = 0; i < frames.length; i++) {
      assertNotAborted(signal);
      if (i > 0) {
        currentBitmap = await decodeFrameToBitmap(frames[i]);
      }
      const bitmap = currentBitmap;
      if (!bitmap) {
        console.warn(`Skipping undecodable frame ${i}`);
        continue;
      }
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      await canvasSource.add(i * frameDuration, frameDuration);
      bitmap.close?.();
      currentBitmap = null;
    }
    await output.finalize();
  } catch (e) {
    try {
      currentBitmap?.close?.();
    } catch {
      /* ignore */
    }
    throw e;
  }

  const buffer = target.buffer;
  if (!buffer) return null;
  return { buffer, duration: frames.length * frameDuration };
}

function isUint8ArrayLike(val: unknown): val is Uint8Array {
  return val instanceof Uint8Array;
}

async function readFramesForEpisode(
  dataLoader: LeRobotDataLoader,
  episodeIndex: number,
  key: string,
): Promise<Uint8Array[]> {
  const data = await dataLoader.loadFeatureData(episodeIndex, [key]);
  const rows = data[key] ?? [];
  const frames: Uint8Array[] = [];
  for (const row of rows) {
    if (isUint8ArrayLike(row)) {
      frames.push(row);
    } else if (row && typeof row === 'object' && 'bytes' in (row as Record<string, unknown>)) {
      const bytes = (row as Record<string, unknown>).bytes;
      if (isUint8ArrayLike(bytes)) frames.push(bytes);
    }
  }
  return frames;
}

/**
 * Encode every `dtype: 'image'` feature into MP4 videos and write them to the
 * adapter.  Returns metadata needed by `MetadataExporter` so the exported
 * `info.json` can reflect the rewritten feature types.
 *
 * Layout:
 *  - v2.1 target → `videos/chunk-XXX/{key}/episode_NNNNNN.mp4`
 *  - v3.0 target → `videos/{key}/chunk-XXX/file-YYY.mp4`
 */
export async function exportImageFeaturesAsVideo(
  dataLoader: LeRobotDataLoader,
  info: LeRobotInfo,
  episodes: EpisodeMetadata[],
  targetVersion: TargetVersion,
  adapter: ExportAdapter,
  onProgress?: (p: ExportProgress) => void,
  encoding?: ImageVideoEncodingOptions,
): Promise<{
  imageFeatureKeys: string[];
  videoOffsets: EpisodeVideoOffsets;
}> {
  const imageKeys = getImageFeatureKeys(info);
  const offsets: EpisodeVideoOffsets = new Map();
  if (imageKeys.length === 0) return { imageFeatureKeys: [], videoOffsets: offsets };

  const fps = info.fps ?? 30;
  const chunksSize = info.chunks_size ?? CHUNK_SIZE_DEFAULT;
  const total = episodes.length * imageKeys.length;
  let done = 0;
  onProgress?.({
    phase: 'videos',
    current: 0,
    total,
    message: `Encoding ${imageKeys.length} image feature(s) as MP4...`,
    cancelable: true,
  });

  for (let i = 0; i < episodes.length; i++) {
    assertNotAborted(encoding?.signal);
    const ep = episodes[i];
    const chunkIdx = Math.floor(i / chunksSize);
    for (const key of imageKeys) {
      assertNotAborted(encoding?.signal);
      let outPath: string;
      if (targetVersion === 'v3.0') {
        outPath = `videos/${key}/chunk-${String(chunkIdx).padStart(3, '0')}/file-${String(i % chunksSize).padStart(3, '0')}.mp4`;
      } else {
        outPath = `videos/chunk-${String(chunkIdx).padStart(3, '0')}/${key}/episode_${String(i).padStart(6, '0')}.mp4`;
      }
      await ensureParentDir(adapter, outPath);

      try {
        const frames = await readFramesForEpisode(dataLoader, ep.episode_index, key);
        if (frames.length === 0) {
          throw new Error(`No image frames for episode=${ep.episode_index} key=${key}`);
        }
        const result = await encodeFramesToMp4(frames, fps, encoding, encoding?.signal);
        if (!result) {
          throw new Error(`Failed to encode ${outPath}`);
        }
        await adapter.writeFile(outPath, new Uint8Array(result.buffer));
        if (targetVersion === 'v3.0') {
          if (!offsets.has(ep.episode_index)) offsets.set(ep.episode_index, {});
          offsets.get(ep.episode_index)![key] = {
            chunk_index: chunkIdx,
            file_index: i % chunksSize,
            from_timestamp: 0,
            to_timestamp: result.duration,
          };
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        throw new Error(`Image→MP4 encoding failed for ${outPath}`, { cause: e });
      }

      done++;
      onProgress?.({
        phase: 'videos',
        current: done,
        total,
        message: outPath,
        cancelable: true,
      });
    }
  }

  return { imageFeatureKeys: imageKeys, videoOffsets: offsets };
}

async function ensureParentDir(adapter: ExportAdapter, filePath: string): Promise<void> {
  const parts = filePath.split('/');
  parts.pop();
  if (parts.length === 0) return;
  let path = '';
  for (const p of parts) {
    path += (path ? '/' : '') + p;
    await adapter.createDirectory(path);
  }
}

/**
 * Build a clone of `info` where every listed image feature is rewritten to
 * `dtype: 'video'`, with an `info.fps` / `info.codec` entry to describe the
 * encoded MP4.
 */
export function rewriteFeaturesForImageToVideo(
  info: LeRobotInfo,
  imageFeatureKeys: string[],
  encoding?: ImageVideoEncodingOptions,
): LeRobotInfo {
  if (imageFeatureKeys.length === 0) return info;
  const fps = info.fps ?? 30;
  const codec = encoding?.codec ?? 'avc';
  const next: LeRobotInfo = {
    ...info,
    features: { ...info.features },
  };
  for (const key of imageFeatureKeys) {
    const feat = info.features[key];
    if (!feat) continue;
    next.features[key] = {
      ...feat,
      dtype: 'video',
      fps,
      info: {
        ...(feat.info ?? {}),
        'video.fps': fps,
        'video.codec': codec === 'avc' ? 'h264' : 'vp9',
      },
    };
  }
  return next;
}
