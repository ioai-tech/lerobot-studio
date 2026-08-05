import { describe, expect, it } from 'vitest';
import { isSameFrameLoadRequest, shouldCommitFrameResult, type FrameLoadRequest } from '@/core';

describe('image panel frame race guards', () => {
  it('matches same frame request identity', () => {
    const request: FrameLoadRequest = {
      episode: 3,
      frame: 42,
      key: 'observation.images.cam_high',
    };
    expect(isSameFrameLoadRequest(request, { ...request })).toBe(true);
  });

  it('does not match when episode/frame/key differs', () => {
    const left: FrameLoadRequest = {
      episode: 3,
      frame: 42,
      key: 'observation.images.cam_high',
    };
    const right: FrameLoadRequest = {
      episode: 4,
      frame: 42,
      key: 'observation.images.cam_high',
    };
    expect(isSameFrameLoadRequest(left, right)).toBe(false);
  });

  it('commits result only for current mounted request', () => {
    const request: FrameLoadRequest = {
      episode: 5,
      frame: 0,
      key: 'observation.images.cam_right_wrist',
    };
    expect(
      shouldCommitFrameResult(request, 5, 'observation.images.cam_right_wrist', true, 11, 11),
    ).toBe(true);
    expect(
      shouldCommitFrameResult(request, 5, 'observation.images.cam_right_wrist', true, 11, 12),
    ).toBe(false);
    expect(
      shouldCommitFrameResult(request, 6, 'observation.images.cam_right_wrist', true, 11, 11),
    ).toBe(false);
  });
});
