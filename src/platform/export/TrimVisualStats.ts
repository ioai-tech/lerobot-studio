import type { DatasetStats, FeatureStats, LeRobotInfo } from '@/core';
import type { LeRobotDataLoader } from '../services/LeRobotDataLoader';
import type { ExportTrim } from './TrimExportPlan';

/** Recompute visual statistics from retained frames; never reuse full-episode statistics after a trim. */
export async function computeTrimVisualStats(
  loader: LeRobotDataLoader,
  info: LeRobotInfo,
  episodeIndex: number,
  range: ExportTrim,
  signal?: AbortSignal,
): Promise<DatasetStats> {
  const result: DatasetStats = {};
  const length = range.endFrame - range.startFrame + 1;
  // ponytail: sample at most 100 evenly spaced frames, including both edges;
  // increase the cap or use full-frame sampling if distribution accuracy requires it.
  const count = Math.min(100, length);
  const frames = Array.from(
    { length: count },
    (_, i) => range.startFrame + Math.round((i * (length - 1)) / Math.max(1, count - 1)),
  );
  for (const [key, feature] of Object.entries(info.features)) {
    if (!['image', 'video', 'depth'].includes(feature.dtype) && feature.info?.is_depth_map !== true)
      continue;
    if (feature.dtype === 'depth' || feature.info?.is_depth_map === true) {
      throw new Error(`Cannot trim depth feature "${key}": raw depth statistics are not supported`);
    }
    const names = feature.names?.flat().map((name) => String(name).toLowerCase()) ?? [];
    const axis = names.findIndex((name) => name === 'channel' || name === 'channels');
    const channels =
      axis >= 0
        ? feature.shape[axis]
        : [1, 3].includes(feature.shape[0])
          ? feature.shape[0]
          : feature.shape.at(-1);
    if (channels !== 1 && channels !== 3)
      throw new Error(`Unsupported channel layout for "${key}"`);
    const histograms = Array.from({ length: channels }, () => new Float64Array(256));
    let pixels = 0;
    const addCanvas = (canvas: HTMLCanvasElement | OffscreenCanvas) => {
      signal?.throwIfAborted();
      const context = canvas.getContext('2d') as
        CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!context) throw new Error(`Cannot read pixels for "${key}"`);
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
      if (!width || !height) throw new Error(`Empty image for "${key}"`);
      pixels += width * height;
      for (let i = 0; i < data.length; i += 4) {
        for (let channel = 0; channel < channels; channel++)
          histograms[channel][data[i + channel]]++;
      }
    };
    if (feature.dtype === 'video') {
      const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny');
      const source = loader.getEpisodeVideoPath(episodeIndex, key);
      if (!source) throw new Error(`Missing video "${key}" for episode ${episodeIndex}`);
      const bytes = await loader.readFileBytes(source.path);
      const input = new Input({
        source: new BlobSource(new Blob([new Uint8Array(bytes)])),
        formats: ALL_FORMATS,
      });
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error(`Missing video track for "${key}"`);
        const sink = new CanvasSink(track, { poolSize: 1 });
        const times = frames.map((frame) => (source.fromSec ?? 0) + (frame + 0.25) / info.fps);
        let i = 0;
        for await (const wrapped of sink.canvasesAtTimestamps(times)) {
          if (
            !wrapped ||
            Math.abs(wrapped.timestamp - ((source.fromSec ?? 0) + frames[i] / info.fps)) >
              0.5 / info.fps
          ) {
            throw new Error(`Video "${key}" is not aligned at frame ${frames[i]}`);
          }
          addCanvas(wrapped.canvas);
          i++;
        }
        if (i !== count) throw new Error(`Incomplete video "${key}"`);
      } finally {
        input.dispose();
      }
    } else {
      const { encodedImageToBitmap } = await import('../utils/encodedImageBlob');
      const { sniffImageFormat } = await import('@/core');
      const rows = (await loader.loadFeatureData(episodeIndex, [key]))[key] ?? [];
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Cannot create image statistics canvas');
      for (const frame of frames) {
        signal?.throwIfAborted();
        const row = rows[frame];
        const bytes = row instanceof Uint8Array ? row : (row as { bytes?: unknown } | null)?.bytes;
        if (!(bytes instanceof Uint8Array))
          throw new Error(`Missing image "${key}" at frame ${frame}`);
        if (sniffImageFormat(bytes) === 'tiff')
          throw new Error('Trimming TIFF depth images requires raw depth statistics');
        const bitmap = await encodedImageToBitmap(bytes);
        try {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          context.drawImage(bitmap, 0, 0);
          addCanvas(canvas);
        } finally {
          bitmap.close();
        }
      }
    }
    const stats = { count: [count] } as FeatureStats;
    const channelStats = histograms.map((histogram) => {
      let sum = 0,
        squares = 0;
      let min = 255,
        max = 0;
      for (let value = 0; value < 256; value++) {
        if (histogram[value]) {
          min = Math.min(min, value);
          max = value;
        }
        sum += histogram[value] * value;
        squares += histogram[value] * value * value;
      }
      const mean = sum / pixels;
      const quantile = (q: number) => {
        let cumulative = 0;
        for (let value = 0; value < 256; value++) {
          cumulative += histogram[value];
          if (cumulative >= q * pixels) return value / 255;
        }
        return max / 255;
      };
      return {
        min: min / 255,
        max: max / 255,
        mean: mean / 255,
        std: Math.sqrt(Math.max(0, squares / pixels - mean * mean)) / 255,
        q01: quantile(0.01),
        q10: quantile(0.1),
        q50: quantile(0.5),
        q90: quantile(0.9),
        q99: quantile(0.99),
      };
    });
    for (const name of ['min', 'max', 'mean', 'std', 'q01', 'q10', 'q50', 'q90', 'q99'] as const) {
      stats[name] = channelStats.map((channel) => [[channel[name]]]);
    }
    result[key] = stats;
  }
  return result;
}
