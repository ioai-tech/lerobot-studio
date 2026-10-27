import { describe, expect, it } from 'vitest';
import { MediaSync, type SyncedVideo } from '../src/react/services/MediaSync';

class FakeVideo implements SyncedVideo {
  currentTime = 0;
  playbackRate = 1;
  readyState = 4;
  ended = false;
  paused = true;
  seeks = 0;
  play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
}

function tracked(video: FakeVideo): FakeVideo {
  let time = video.currentTime;
  Object.defineProperty(video, 'currentTime', {
    get: () => time,
    set: (value: number) => {
      video.seeks += 1;
      time = value;
    },
  });
  return video;
}

function setup(starts: number[]) {
  const sync = new MediaSync();
  sync.setFps(30);
  const videos = starts.map(() => tracked(new FakeVideo()));
  starts.forEach((start, index) => {
    sync.register(`v${index}`, { video: videos[index], getStart: () => start });
  });
  return { sync, videos };
}

/** Advance media time without counting it as a seek. */
function advance(video: FakeVideo, seconds: number) {
  const seeks = video.seeks;
  video.currentTime += seconds;
  video.seeks = seeks;
}

describe('MediaSync', () => {
  it('seeks every video to the episode frame and plays them at the requested rate', () => {
    const { sync, videos } = setup([10, 0]);
    sync.start(30, 2);
    expect(videos[0].currentTime).toBeCloseTo(11);
    expect(videos[1].currentTime).toBeCloseTo(1);
    expect(videos.every((video) => !video.paused && video.playbackRate === 2)).toBe(true);
    expect(sync.isActive()).toBe(true);
  });

  it('reads the frame index from the master video', () => {
    const { sync, videos } = setup([10, 0]);
    sync.start(0, 1);
    advance(videos[0], 2);
    advance(videos[1], 2);
    expect(sync.tick()).toEqual({ frameIndex: 60, buffering: false });
  });

  it('nudges a slightly late follower and seeks a far one', () => {
    const { sync, videos } = setup([0, 0]);
    sync.start(0, 1);
    advance(videos[0], 1);
    advance(videos[1], 1 - 3 / 30);
    sync.tick();
    expect(videos[1].playbackRate).toBeCloseTo(1.05);
    expect(videos[1].seeks).toBe(0);

    advance(videos[0], 1);
    sync.tick();
    expect(videos[1].currentTime).toBeCloseTo(videos[0].currentTime);
    expect(videos[1].playbackRate).toBe(1);
  });

  it('pauses every video while one buffers and resumes them in sync', () => {
    const { sync, videos } = setup([0, 0]);
    const events: boolean[] = [];
    sync.onBufferingChange((buffering) => events.push(buffering));
    sync.start(0, 1);
    advance(videos[0], 1);
    videos[1].readyState = 2;

    expect(sync.tick()?.buffering).toBe(true);
    expect(videos.every((video) => video.paused)).toBe(true);

    videos[1].readyState = 4;
    expect(sync.tick()?.buffering).toBe(false);
    expect(videos.every((video) => !video.paused)).toBe(true);
    expect(videos[1].currentTime).toBeCloseTo(videos[0].currentTime);
    expect(events).toEqual([true, false]);
  });

  it('reports the end of the episode when the master video ended', () => {
    const { sync, videos } = setup([0]);
    sync.start(0, 1);
    videos[0].ended = true;
    expect(sync.tick()?.frameIndex).toBe(Number.POSITIVE_INFINITY);
  });

  it('does not drive the clock without a video or when stopped', () => {
    const sync = new MediaSync();
    sync.start(0, 1);
    expect(sync.tick()).toBeNull();

    const { sync: withVideo, videos } = setup([0]);
    withVideo.start(0, 1);
    withVideo.stop();
    expect(videos[0].paused).toBe(true);
    expect(withVideo.tick()).toBeNull();
    expect(withVideo.isActive()).toBe(false);
  });

  it('skips videos whose episode range is not set yet', () => {
    const sync = new MediaSync();
    const pending = new FakeVideo();
    const ready = new FakeVideo();
    sync.register('pending', { video: pending, getStart: () => null });
    sync.register('ready', { video: ready, getStart: () => 5 });
    sync.start(0, 1);
    ready.currentTime = 6;
    expect(sync.tick()?.frameIndex).toBe(30);
    expect(pending.paused).toBe(true);
  });
});
