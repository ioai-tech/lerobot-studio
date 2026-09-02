import type { LeRobotFeature, LeRobotInfo } from '../types/lerobot';

export interface MediaRuntimeDimensions {
  width?: number | null;
  height?: number | null;
}

export interface MediaTimelineRange {
  startSec: number;
  endSec: number;
}

export interface MediaDebugMetadata {
  dtype: string;
  shapeText: string | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  pixelFormat: string | null;
  channels: number | null;
  hasAudio: boolean | null;
  timeline: MediaTimelineRange | null;
}

function toPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function toOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function toOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function getFeatureInfoValue(feature: LeRobotFeature | undefined, key: string): unknown {
  if (!feature) return undefined;
  const extra = feature as LeRobotFeature & { video_info?: Record<string, unknown> };
  return extra.info?.[key] ?? extra.video_info?.[key];
}

function inferResolutionFromShape(
  feature: LeRobotFeature | undefined,
): MediaRuntimeDimensions | null {
  const shape = feature?.shape;
  if (!Array.isArray(shape) || shape.length === 0) {
    return null;
  }

  const names = Array.isArray(feature?.names) ? feature.names : [];
  const heightIndex = names.indexOf('height');
  const widthIndex = names.indexOf('width');
  if (heightIndex >= 0 && widthIndex >= 0) {
    return {
      height: toPositiveNumber(shape[heightIndex]),
      width: toPositiveNumber(shape[widthIndex]),
    };
  }

  if (shape.length === 2) {
    return {
      height: toPositiveNumber(shape[0]),
      width: toPositiveNumber(shape[1]),
    };
  }

  if (shape.length === 3) {
    const [first, second, third] = shape;
    if (third <= 4 && first > 4 && second > 4) {
      return {
        height: toPositiveNumber(first),
        width: toPositiveNumber(second),
      };
    }

    if (first <= 4 && second > 4 && third > 4) {
      return {
        height: toPositiveNumber(second),
        width: toPositiveNumber(third),
      };
    }
  }

  return null;
}

function inferChannels(feature: LeRobotFeature | undefined): number | null {
  const explicitChannels = toPositiveNumber(getFeatureInfoValue(feature, 'video.channels'));
  if (explicitChannels) {
    return explicitChannels;
  }

  const shape = feature?.shape;
  const names = Array.isArray(feature?.names) ? feature.names : [];
  const channelIndex = names.findIndex((name) => name === 'channel' || name === 'channels');
  if (Array.isArray(shape) && channelIndex >= 0) {
    return toPositiveNumber(shape[channelIndex]);
  }

  if (Array.isArray(shape) && shape.length === 3) {
    const [first, , third] = shape;
    if (first <= 4) return toPositiveNumber(first);
    if (third <= 4) return toPositiveNumber(third);
  }

  return null;
}

export function buildMediaDebugMetadata(
  info: LeRobotInfo | null,
  featureKey: string,
  options?: {
    runtimeDimensions?: MediaRuntimeDimensions | null;
    timeline?: MediaTimelineRange | null;
  },
): MediaDebugMetadata | null {
  const feature = info?.features?.[featureKey];
  if (!feature) {
    return null;
  }

  const runtimeWidth = toPositiveNumber(options?.runtimeDimensions?.width);
  const runtimeHeight = toPositiveNumber(options?.runtimeDimensions?.height);
  const infoWidth = toPositiveNumber(getFeatureInfoValue(feature, 'video.width'));
  const infoHeight = toPositiveNumber(getFeatureInfoValue(feature, 'video.height'));
  const shapeResolution = inferResolutionFromShape(feature);
  const width = runtimeWidth ?? infoWidth ?? shapeResolution?.width ?? null;
  const height = runtimeHeight ?? infoHeight ?? shapeResolution?.height ?? null;

  const featureFps = toPositiveNumber(feature.fps);
  const infoFps = toPositiveNumber(getFeatureInfoValue(feature, 'video.fps'));
  const datasetFps = toPositiveNumber(info?.fps);

  const timeline = options?.timeline
    ? {
        startSec: options.timeline.startSec,
        endSec: options.timeline.endSec,
      }
    : null;

  return {
    dtype: feature.dtype,
    shapeText:
      Array.isArray(feature.shape) && feature.shape.length > 0
        ? `[${feature.shape.join(', ')}]`
        : null,
    fps: featureFps ?? infoFps ?? datasetFps,
    width,
    height,
    codec: toOptionalString(getFeatureInfoValue(feature, 'video.codec')),
    pixelFormat: toOptionalString(getFeatureInfoValue(feature, 'video.pix_fmt')),
    channels: inferChannels(feature),
    hasAudio: toOptionalBoolean(
      getFeatureInfoValue(feature, 'has_audio') ?? getFeatureInfoValue(feature, 'video.has_audio'),
    ),
    timeline,
  };
}
