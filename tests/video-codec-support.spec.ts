import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeRobotFeature } from '../src/core/types/lerobot';
import { visualAspectRatio } from '../src/core/panels/visualFit';

type CodecSupportModule = typeof import('../src/platform/services/videoCodecSupport');

/** A browser whose every decode check refuses AV1 (Safari on a Mac without AV1 decode). */
function stubBrowserWithoutAv1() {
  const refusesAv1 = (codec: string) => !codec.includes('av01');
  vi.stubGlobal('MediaSource', { isTypeSupported: (type: string) => refusesAv1(type) });
  vi.stubGlobal('VideoDecoder', {
    isConfigSupported: async (config: { codec: string }) => ({
      supported: refusesAv1(config.codec),
    }),
  });
}

function camera(where: 'info' | 'video_info', codec: string): LeRobotFeature {
  const metadata = {
    'video.codec': codec,
    'video.pix_fmt': 'yuv420p',
    'video.width': 640,
    'video.height': 480,
  };
  return {
    dtype: 'video',
    shape: [480, 640, 3],
    names: ['height', 'width', 'channel'],
    [where]: metadata,
  } as LeRobotFeature;
}

describe('video codec support', () => {
  let support: CodecSupportModule;

  beforeEach(async () => {
    // The support check caches per codec and size; start each case cold.
    vi.resetModules();
    stubBrowserWithoutAv1();
    support = await import('../src/platform/services/videoCodecSupport');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the declared codec from video_info as well as info', () => {
    expect(support.declaredVideoCodec(camera('info', 'AV1'))).toBe('av1');
    expect(support.declaredVideoCodec(camera('video_info', 'av1'))).toBe('av1');
    expect(support.declaredVideoCodec(undefined)).toBeNull();
    expect(
      support.declaredVideoCodec({ dtype: 'video', shape: [1], names: null } as LeRobotFeature),
    ).toBeNull();
  });

  it('refuses an AV1 camera declared under video_info where AV1 cannot be decoded', async () => {
    await expect(support.checkVideoCodecSupport(camera('video_info', 'av1'))).resolves.toEqual({
      codec: 'av1',
      supported: false,
    });
  });

  it('still refuses an AV1 camera declared under info', async () => {
    await expect(support.checkVideoCodecSupport(camera('info', 'av1'))).resolves.toEqual({
      codec: 'av1',
      supported: false,
    });
  });

  it.each(['info', 'video_info'] as const)(
    'plays an H.264 camera declared under %s',
    async (where) => {
      await expect(support.checkVideoCodecSupport(camera(where, 'h264'))).resolves.toEqual({
        codec: 'h264',
        supported: true,
      });
    },
  );

  it('lets an undeclared codec try', async () => {
    await expect(
      support.checkVideoCodecSupport({ dtype: 'video', shape: [1], names: null }),
    ).resolves.toEqual({ codec: null, supported: true });
  });

  it('checks the size declared under video_info', async () => {
    const decoder = vi.fn(async () => ({ supported: false }));
    vi.stubGlobal('MediaSource', { isTypeSupported: () => false });
    vi.stubGlobal('VideoDecoder', { isConfigSupported: decoder });
    const feature = camera('video_info', 'vp9');
    (feature.video_info as Record<string, unknown>)['video.width'] = 1280;
    (feature.video_info as Record<string, unknown>)['video.height'] = 720;
    await support.checkVideoCodecSupport(feature);
    expect(decoder).toHaveBeenCalledWith(
      expect.objectContaining({ codedWidth: 1280, codedHeight: 720 }),
    );
  });
});

describe('camera aspect from video metadata', () => {
  it('reads the declared size from video_info', () => {
    const feature = {
      dtype: 'video',
      shape: [3, 10, 10],
      names: null,
      video_info: { 'video.width': 1280, 'video.height': 720 },
    } as LeRobotFeature;
    expect(visualAspectRatio(feature)).toBeCloseTo(16 / 9);
  });
});
