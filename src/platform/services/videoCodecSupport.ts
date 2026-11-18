/**
 * Decide, before mounting a camera, whether this browser can decode the codec
 * a LeRobot dataset declares for it (`info.features[key].info["video.codec"]`).
 */

/** Result of a decode-support check for one camera. */
export interface VideoCodecSupport {
  /** Codec name as declared by the dataset (for example `av1`), or null when undeclared. */
  codec: string | null;
  /** False only when the codec is declared and every available browser check rejects it. */
  supported: boolean;
}

const CODEC_STRINGS: Record<string, string[]> = {
  h264: ['avc1.640028', 'avc1.4d401f', 'avc1.42e01e'],
  avc1: ['avc1.640028', 'avc1.4d401f', 'avc1.42e01e'],
  hevc: ['hvc1.1.6.L120.90', 'hev1.1.6.L120.90'],
  h265: ['hvc1.1.6.L120.90', 'hev1.1.6.L120.90'],
  av1: ['av01.0.08M.08', 'av01.0.05M.08'],
  vp9: ['vp09.00.40.08', 'vp09.00.10.08'],
  vp8: ['vp8'],
};

/** Declared codec of a video feature, lower-cased, or null. */
export function declaredVideoCodec(feature: unknown): string | null {
  const info = (feature as { info?: Record<string, unknown> } | null | undefined)?.info;
  const value = info?.['video.codec'];
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

const cache = new Map<string, Promise<boolean>>();

async function browserDecodes(codecStrings: string[], width: number, height: number) {
  const mimes = codecStrings.map((codec) => `video/mp4; codecs="${codec}"`);
  if (typeof document !== 'undefined') {
    const probe = document.createElement('video');
    if (mimes.some((mime) => probe.canPlayType(mime) !== '')) return true;
  }
  const mediaSource = (globalThis as { MediaSource?: { isTypeSupported(type: string): boolean } })
    .MediaSource;
  if (mediaSource && mimes.some((mime) => mediaSource.isTypeSupported(mime))) return true;
  const decoder = (
    globalThis as {
      VideoDecoder?: {
        isConfigSupported(config: {
          codec: string;
          codedWidth: number;
          codedHeight: number;
        }): Promise<{ supported?: boolean }>;
      };
    }
  ).VideoDecoder;
  if (decoder) {
    for (const codec of codecStrings) {
      try {
        const result = await decoder.isConfigSupported({
          codec,
          codedWidth: width,
          codedHeight: height,
        });
        if (result.supported) return true;
      } catch {
        // try the next profile
      }
    }
  }
  return false;
}

/**
 * Check whether the browser can decode a camera's declared codec. Unknown or
 * undeclared codecs are reported as supported (the element is allowed to
 * try); a known codec is unsupported only when every available check
 * (`canPlayType`, `MediaSource.isTypeSupported`, `VideoDecoder.isConfigSupported`)
 * rejects it.
 */
export async function checkVideoCodecSupport(feature: unknown): Promise<VideoCodecSupport> {
  const codec = declaredVideoCodec(feature);
  const codecStrings = codec ? CODEC_STRINGS[codec] : undefined;
  if (!codec || !codecStrings) return { codec, supported: true };
  const info = (feature as { info?: Record<string, unknown> }).info ?? {};
  const width = Number(info['video.width']) || 640;
  const height = Number(info['video.height']) || 480;
  const key = `${codec}:${width}x${height}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = browserDecodes(codecStrings, width, height).catch(() => true);
    cache.set(key, pending);
  }
  return { codec, supported: await pending };
}
