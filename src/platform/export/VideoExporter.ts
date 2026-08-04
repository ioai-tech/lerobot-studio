import type { LeRobotDataLoader } from '../services/LeRobotDataLoader';
import type { LeRobotInfo, EpisodeMetadata } from '@/core';
import { isV2Info, isV3Info } from '@/core';
import type { ExportAdapter } from '@/core';
import type { ExportProgress, EpisodeVideoOffsets, TargetVersion } from '@/core';

const CHUNK_SIZE_DEFAULT = 1000;
const VIDEO_FILE_SIZE_MB_DEFAULT = 200;

export type VideoExportOptions = { signal?: AbortSignal };

/** Optional trim for Conversion (v3 segment export). */
export type ConvertSegmentTrim = { fromSec?: number; toSec?: number };

/**
 * Returns true only when the trim describes a meaningful sub-segment.
 *
 * The v2 adapter returns `{ fromSec: 0, toSec: 0 }` as a sentinel meaning
 * "the whole file is one episode". A trim of `start=0, end=0` would cause
 * Mediabunny's Conversion to throw `options.trim.start must be less than
 * options.trim.end.`  We coerce those sentinels back to "no trim".
 */
function hasMeaningfulTrim(r: { fromSec?: number; toSec?: number }): boolean {
  const from = Number(r.fromSec ?? 0);
  const to = Number(r.toSec ?? 0);
  return Number.isFinite(to) && to > 0 && to > from;
}

/** Magic-byte check: a valid MP4 container starts with "....ftyp" at offset 4. */
function looksLikeMp4(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return (
    bytes[4] === 0x66 /* f */ &&
    bytes[5] === 0x74 /* t */ &&
    bytes[6] === 0x79 /* y */ &&
    bytes[7] === 0x70 /* p */
  );
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

/**
 * Convert one video segment (bytes) to MP4 using Mediabunny's Conversion API.
 *
 * Key improvements over the previous implementation:
 * - Wires the user-supplied AbortSignal into `Conversion.cancel()` so long
 *   transcodes respond to cancellation promptly.
 * - Returns `null` (caller must treat as failure) rather than swallowing all
 *   errors silently – previously conversion failures led to `0-byte` MP4s
 *   being written to disk and corrupt datasets downstream.
 * - The caller is responsible for deciding whether to fall back or propagate
 *   the failure. We no longer write WebM with a `.mp4` extension.
 */
async function convertSegmentWithMediabunny(
  bytes: Uint8Array,
  trim?: ConvertSegmentTrim,
  signal?: AbortSignal,
): Promise<{ buffer: ArrayBuffer; duration: number } | null> {
  if (!bytes?.length) return null;
  assertNotAborted(signal);
  const { Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, BufferTarget, Conversion } =
    await import('mediabunny');
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy], { type: 'application/octet-stream' });
  const source = new BlobSource(blob);
  const input = new Input({ source, formats: ALL_FORMATS });
  const fullDuration = await input.computeDuration();
  if (!Number.isFinite(fullDuration) || fullDuration <= 0) return null;
  const rawStart = trim?.fromSec ?? 0;
  const rawEnd = trim?.toSec ?? fullDuration;
  // Defensive: sentinel `{fromSec:0, toSec:0}` or reversed ranges mean "whole
  // file". Passing `start>=end` to Mediabunny throws, so collapse those cases.
  const useTrim =
    trim != null &&
    Number.isFinite(rawStart) &&
    Number.isFinite(rawEnd) &&
    rawEnd > rawStart &&
    (rawStart > 0 || rawEnd < fullDuration);
  const start = useTrim ? rawStart : 0;
  const end = useTrim ? rawEnd : fullDuration;
  const duration = Math.max(0, end - start);
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat(),
    target,
  });
  const conversion = await Conversion.init({
    input,
    output,
    ...(useTrim ? { trim: { start, end } } : {}),
  });
  if (!conversion.isValid) return null;

  const onAbort = () => {
    conversion.cancel().catch(() => undefined);
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
      return null;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    await conversion.execute();
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }
  const buffer = target.buffer;
  if (!buffer) return null;
  return { buffer, duration };
}

/**
 * Copy path: v2 source → v2.1 target only. Read each episode file as bytes and write (avoids blob URL cache eviction).
 */
async function exportVideosCopy(
  dataLoader: LeRobotDataLoader,
  info: LeRobotInfo,
  episodes: EpisodeMetadata[],
  adapter: ExportAdapter,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const videoKeys = Object.entries(info.features)
    .filter(([, f]) => f?.dtype === 'video')
    .map(([k]) => k);
  if (videoKeys.length === 0) return;

  const chunksSize = info.chunks_size ?? CHUNK_SIZE_DEFAULT;
  let done = 0;
  const total = episodes.length * videoKeys.length;

  for (let i = 0; i < episodes.length; i++) {
    assertNotAborted(signal);
    const ep = episodes[i];
    for (const key of videoKeys) {
      assertNotAborted(signal);
      const chunkIdx = Math.floor(i / chunksSize);
      const path = `videos/chunk-${String(chunkIdx).padStart(3, '0')}/${key}/episode_${String(i).padStart(6, '0')}.mp4`;
      const pathResult = dataLoader.getEpisodeVideoPath(ep.episode_index, key);
      if (!pathResult) {
        throw new Error(`Missing source video for episode ${ep.episode_index}, feature "${key}"`);
      }
      try {
        const bytes = await dataLoader.readFileBytes(pathResult.path);
        await ensureParentDir(adapter, path);
        await adapter.writeFile(path, bytes);
      } catch (e) {
        throw new Error(
          `Failed to export video "${path}": ${e instanceof Error ? e.message : String(e)}`,
          {
            cause: e,
          },
        );
      }
      done++;
      onProgress?.({ phase: 'videos', current: done, total, message: path, cancelable: false });
    }
  }
}

/**
 * Transcode path: v3 target. One file per episode per (chunk, key).
 *
 * Optimization: when the source is already an MP4 that covers exactly one
 * episode (v2 → v3 on an existing MP4 with fromSec/toSec unset), we byte-copy
 * instead of decoding/re-encoding.  Otherwise we use Mediabunny Conversion
 * (which also handles the trim case needed for v3 → v3 where a single file
 * holds multiple episodes).
 *
 * Stability changes:
 * - Failures no longer write a 0-byte `.mp4`.  The error is logged, the
 *   episode is skipped (no video offset entry), and the caller can decide.
 * - Abort propagates into Conversion.cancel via convertSegmentWithMediabunny.
 */
async function exportVideosTranscodeToV3(
  dataLoader: LeRobotDataLoader,
  info: LeRobotInfo,
  episodes: EpisodeMetadata[],
  adapter: ExportAdapter,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<EpisodeVideoOffsets> {
  const videoKeys = Object.entries(info.features)
    .filter(([, f]) => f?.dtype === 'video')
    .map(([k]) => k);
  if (videoKeys.length === 0) return new Map();

  const chunksSize = info.chunks_size ?? CHUNK_SIZE_DEFAULT;
  if (!Number.isSafeInteger(chunksSize) || chunksSize <= 0) {
    throw new Error('chunks_size must be a positive integer');
  }
  const videoSizeLimit =
    (info as { video_files_size_in_mb?: number }).video_files_size_in_mb ??
    VIDEO_FILE_SIZE_MB_DEFAULT;
  if (!Number.isFinite(videoSizeLimit) || videoSizeLimit <= 0) {
    throw new Error('video_files_size_in_mb must be a positive number');
  }

  const offsets: EpisodeVideoOffsets = new Map();
  let done = 0;
  const total = episodes.length * videoKeys.length;
  onProgress?.({
    phase: 'videos',
    current: 0,
    total,
    message: 'Starting video export...',
    cancelable: false,
  });

  for (const key of videoKeys) {
    // Official LeRobot concatenates episode MP4s while the current file stays
    // below video_files_size_in_mb. Mediabunny cannot remux-concatenate
    // independently encoded MP4s without a lossy transcode. Preserve every
    // episode losslessly as its own file instead, and apply chunks_size to the
    // number of files (not the number of episodes as a format concept).
    let chunkIdx = 0;
    let fileIdx = 0;
    for (let newIdx = 0; newIdx < episodes.length; newIdx++) {
      assertNotAborted(signal);
      const ep = episodes[newIdx];
      const pathResult = dataLoader.getEpisodeVideoPath(ep.episode_index, key);
      const outPath = `videos/${key}/chunk-${String(chunkIdx).padStart(3, '0')}/file-${String(fileIdx).padStart(3, '0')}.mp4`;

      if (!pathResult) {
        throw new Error(`Missing source video for episode ${ep.episode_index}, feature "${key}"`);
      }

      try {
        const bytes = await dataLoader.readFileBytes(pathResult.path);
        const hasTrim = hasMeaningfulTrim(pathResult);
        const trim = hasTrim ? { fromSec: pathResult.fromSec, toSec: pathResult.toSec } : undefined;

        // Fast path: source is already an MP4 AND we don't need to trim →
        // byte copy.  Massively faster and avoids any transcoding failure
        // mode for already-compatible sources (v2 MP4 → v3 MP4).
        if (!hasTrim && looksLikeMp4(bytes)) {
          await ensureParentDir(adapter, outPath);
          await adapter.writeFile(outPath, bytes);
          const duration =
            Number(pathResult.toSec ?? 0) > 0
              ? Number(pathResult.toSec)
              : await tryComputeMp4Duration(bytes);
          if (!offsets.has(ep.episode_index)) offsets.set(ep.episode_index, {});
          offsets.get(ep.episode_index)![key] = {
            chunk_index: chunkIdx,
            file_index: fileIdx,
            from_timestamp: 0,
            to_timestamp: duration,
          };
        } else {
          const result = await convertSegmentWithMediabunny(bytes, trim, signal);
          if (!result) {
            throw new Error(`Video conversion produced no MP4 output: ${outPath}`);
          } else {
            await ensureParentDir(adapter, outPath);
            await adapter.writeFile(outPath, new Uint8Array(result.buffer));
            if (!offsets.has(ep.episode_index)) offsets.set(ep.episode_index, {});
            offsets.get(ep.episode_index)![key] = {
              chunk_index: chunkIdx,
              file_index: fileIdx,
              from_timestamp: 0,
              to_timestamp: result.duration,
            };
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        throw new Error(
          `Failed to export video "${outPath}": ${e instanceof Error ? e.message : String(e)}`,
          {
            cause: e,
          },
        );
      }

      done++;
      onProgress?.({
        phase: 'videos',
        current: done,
        total,
        message: outPath,
        cancelable: false,
      });
      if (fileIdx + 1 >= chunksSize) {
        chunkIdx++;
        fileIdx = 0;
      } else {
        fileIdx++;
      }
    }
  }
  return offsets;
}

/**
 * Transcode path: v2.1 target with v3 source. One file per episode per key.
 *
 * Stability changes:
 * - Removed the WebM-labelled-as-mp4 fallback that corrupted datasets when
 *   Mediabunny Conversion failed.  If MP4 conversion isn't possible for this
 *   segment, we skip the file and log; the surrounding dataset remains valid.
 */
async function exportVideosTranscodeToV2FromV3(
  dataLoader: LeRobotDataLoader,
  info: LeRobotInfo,
  episodes: EpisodeMetadata[],
  adapter: ExportAdapter,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const videoKeys = Object.entries(info.features)
    .filter(([, f]) => f?.dtype === 'video')
    .map(([k]) => k);
  if (videoKeys.length === 0) return;

  const chunksSize = info.chunks_size ?? CHUNK_SIZE_DEFAULT;
  let done = 0;
  const total = episodes.length * videoKeys.length;

  for (let i = 0; i < episodes.length; i++) {
    assertNotAborted(signal);
    const ep = episodes[i];
    for (const key of videoKeys) {
      assertNotAborted(signal);
      const pathResult = dataLoader.getEpisodeVideoPath(ep.episode_index, key);
      if (!pathResult) {
        throw new Error(`Missing source video for episode ${ep.episode_index}, feature "${key}"`);
      }
      const chunkIdx = Math.floor(i / chunksSize);
      const outPath = `videos/chunk-${String(chunkIdx).padStart(3, '0')}/${key}/episode_${String(i).padStart(6, '0')}.mp4`;
      try {
        const bytes = await dataLoader.readFileBytes(pathResult.path);
        const hasTrim = hasMeaningfulTrim(pathResult);
        const trim = hasTrim ? { fromSec: pathResult.fromSec, toSec: pathResult.toSec } : undefined;
        const result = await convertSegmentWithMediabunny(bytes, trim, signal);
        if (!result) {
          throw new Error(`Video conversion produced no MP4 output: ${outPath}`);
        } else {
          await ensureParentDir(adapter, outPath);
          await adapter.writeFile(outPath, new Uint8Array(result.buffer));
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        throw new Error(
          `Failed to export video "${outPath}": ${e instanceof Error ? e.message : String(e)}`,
          {
            cause: e,
          },
        );
      }
      done++;
      onProgress?.({ phase: 'videos', current: done, total, message: outPath, cancelable: false });
    }
  }
}

/**
 * Best-effort MP4 duration probe via Mediabunny.
 *
 * Used for the byte-copy fast path so we can still populate accurate video
 * offsets. Returns 0 if duration can't be determined.
 */
async function tryComputeMp4Duration(bytes: Uint8Array): Promise<number> {
  try {
    const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const blob = new Blob([copy], { type: 'video/mp4' });
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const d = await input.computeDuration();
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0;
  }
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
 * Dispatcher: Copy (v2 source → v2.1 only) vs Transcode (v2→v3, v3→v3, v3→v2.1).
 */
export async function exportVideosByTarget(
  dataLoader: LeRobotDataLoader,
  info: LeRobotInfo,
  episodes: EpisodeMetadata[],
  targetVersion: TargetVersion,
  adapter: ExportAdapter,
  onProgress?: (p: ExportProgress) => void,
  options?: VideoExportOptions,
): Promise<EpisodeVideoOffsets | null> {
  if (targetVersion === 'v2.1' && isV2Info(info)) {
    await exportVideosCopy(dataLoader, info, episodes, adapter, onProgress, options?.signal);
    return null;
  }

  if (targetVersion === 'v3.0') {
    return exportVideosTranscodeToV3(
      dataLoader,
      info,
      episodes,
      adapter,
      onProgress,
      options?.signal,
    );
  }

  if (targetVersion === 'v2.1' && isV3Info(info)) {
    await exportVideosTranscodeToV2FromV3(
      dataLoader,
      info,
      episodes,
      adapter,
      onProgress,
      options?.signal,
    );
    return null;
  }

  return null;
}
