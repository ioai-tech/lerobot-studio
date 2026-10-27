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
    // the centre of frame 30, robust against float rounding to frame 29
    expect(videos[0].currentTime).toBeCloseTo(11 + 0.5 / 30, 6);
    expect(videos[1].currentTime).toBeCloseTo(1 + 0.5 / 30, 6);
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

  it('stops every camera on the last frame before the next episode of the file can show', () => {
    const sync = new MediaSync();
    sync.setFps(30);
    const master = tracked(new FakeVideo());
    const follower = tracked(new FakeVideo());
    // a 2-second episode at 10 s in the master's file, at 0 s in the follower's
    sync.register('a', { video: master, getStart: () => 10, getEnd: () => 12 });
    sync.register('b', { video: follower, getStart: () => 0, getEnd: () => 2 });
    sync.start(0, 1);
    advance(master, 1.9);
    advance(follower, 1.9);
    expect(sync.tick()?.frameIndex).toBe(57);
    // the last frame (59) starts at 11.9667: the next tick would be too late
    advance(master, 0.06);
    advance(follower, 0.06);
    expect(sync.tick()?.frameIndex).toBe(Number.POSITIVE_INFINITY);
    expect(master.paused && follower.paused).toBe(true);
    // both show frame 59 (already inside it: no seek needed)
    expect(Math.floor((master.currentTime - 10) * 30)).toBe(59);
    expect(Math.floor(follower.currentTime * 30)).toBe(59);

    // paused on frame 58 by the lookahead: seeks to the centre of the last frame
    const early = new MediaSync();
    early.setFps(30);
    const video = tracked(new FakeVideo());
    early.register('a', { video, getStart: () => 0, getEnd: () => 2 });
    early.start(0, 1);
    advance(video, 1.95);
    expect(early.tick()?.frameIndex).toBe(Number.POSITIVE_INFINITY);
    expect(video.currentTime).toBeCloseTo(59.5 / 30, 6);
    expect(sync.tick()?.frameIndex).toBe(Number.POSITIVE_INFINITY);
  });

  it('moves the master and the followers together on a step while playing', () => {
    const { sync, videos } = setup([10, 0]);
    sync.start(0, 1);
    advance(videos[0], 1);
    advance(videos[1], 1);
    sync.seekFrame(31);
    expect(videos[0].currentTime).toBeCloseTo(10 + 31.5 / 30, 6);
    expect(videos[1].currentTime).toBeCloseTo(31.5 / 30, 6);
    expect(sync.tick()?.frameIndex).toBe(31);
  });

  it('hands the play state to a camera whose element was swapped', () => {
    const sync = new MediaSync();
    sync.setFps(30);
    const first = tracked(new FakeVideo());
    const second = tracked(new FakeVideo());
    let current: FakeVideo = first;
    sync.register('cam', {
      get video() {
        return current;
      },
      getStart: () => 0,
    });
    sync.start(0, 1.5);
    expect(first.paused).toBe(false);
    current = second;
    sync.refresh('cam');
    expect(second.paused).toBe(false);
    expect(second.playbackRate).toBe(1.5);
    sync.stop();
    expect(second.paused).toBe(true);
  });

  it('pauses a camera that leaves the group', () => {
    const { sync, videos } = setup([0, 0]);
    const leave = sync.register('extra', { video: videos[0], getStart: () => 0 });
    sync.start(0, 1);
    leave();
    expect(videos[0].paused).toBe(true);
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

  it('holds the clock while a camera switches to the episode, and plays everyone once it can', () => {
    const sync = new MediaSync();
    sync.setFps(30);
    const shown = tracked(new FakeVideo());
    const switching = tracked(new FakeVideo());
    let pending = true;
    const events: Array<[boolean, boolean]> = [];
    sync.onBufferingChange((buffering, waitingForSwitch) =>
      events.push([buffering, waitingForSwitch]),
    );
    sync.register('a', { video: shown, getStart: () => 0 });
    sync.register('b', { video: switching, getStart: () => 0, isPending: () => pending });
    sync.start(0, 1);
    // nobody plays while one camera has no picture of the episode
    expect(shown.paused && switching.paused).toBe(true);
    expect(sync.tick()).toEqual({ frameIndex: 0, buffering: true });
    expect(events).toEqual([[true, true]]);
    pending = false;
    const clock = sync.tick();
    expect(clock?.buffering).toBe(false);
    expect(!shown.paused && !switching.paused).toBe(true);
  });

  it('never lets the timer run the clock while its cameras have no picture', () => {
    const sync = new MediaSync();
    sync.setFps(30);
    const loading = tracked(new FakeVideo());
    loading.readyState = 0;
    sync.register('a', { video: loading, getStart: () => 0 });
    sync.start(0, 1);
    const clock = sync.tick();
    expect(clock?.buffering).toBe(true);
    // without any camera the engine's timer runs it (null)
    const empty = new MediaSync();
    empty.start(0, 1);
    expect(empty.tick()).toBeNull();
  });

  it('keeps its master when a camera joins: the joining one meets the clock, not the reverse', () => {
    const sync = new MediaSync();
    sync.setFps(30);
    const front = tracked(new FakeVideo());
    const wrist = tracked(new FakeVideo());
    // the first registered camera let its picture go (a late switch): the second drives the clock
    front.readyState = 0;
    sync.register('front', { video: front, getStart: () => 0 });
    sync.register('wrist', { video: wrist, getStart: () => 0 });
    sync.start(0, 1);
    advance(wrist, 1.4);
    expect(sync.tick()?.frameIndex).toBe(42);
    // the first camera gets a picture again, at an older frame of the episode
    front.readyState = 4;
    front.currentTime = 0.1;
    sync.refresh('front');
    const clock = sync.tick();
    expect(clock?.frameIndex).toBe(42);
    expect(front.currentTime).toBeCloseTo(wrist.currentTime, 6);
  });

  it('never takes an element still outside its episode (a seek on its way) for the clock or its end', () => {
    const sync = new MediaSync();
    sync.setFps(30);
    const video = new FakeVideo();
    // another episode of the same file was on screen at 4 s; this one is 0-2.5 s and the seek to
    // it has not landed yet
    video.currentTime = 4;
    let seeking = true;
    sync.register('a', {
      video,
      getStart: () => 0,
      getEnd: () => 2.5,
      seek: () => {
        seeking = true;
      },
      isSeeking: () => seeking,
    });
    sync.start(0, 1);
    const clock = sync.tick();
    expect(clock?.frameIndex).not.toBe(Number.POSITIVE_INFINITY);
    expect(clock?.buffering).toBe(true);
    // the seek lands: the clock runs from the episode's first frame
    video.currentTime = 0.5 / 30;
    seeking = false;
    expect(sync.tick()).toEqual({ frameIndex: 0, buffering: false });
  });

  it('ends the episode when the master ran past its end between two ticks (no seek on its way)', () => {
    const sync = new MediaSync();
    sync.setFps(30);
    const master = new FakeVideo();
    const follower = new FakeVideo();
    const seeks: Array<[string, number]> = [];
    for (const [id, video] of [
      ['a', master],
      ['b', follower],
    ] as const) {
      sync.register(id, {
        video,
        getStart: () => 0,
        getEnd: () => 3,
        seek: (time) => {
          seeks.push([id, time]);
          video.currentTime = time;
        },
        isSeeking: () => false,
      });
    }
    sync.start(0, 1);
    master.currentTime = 1;
    follower.currentTime = 1;
    expect(sync.tick()?.buffering).toBe(false);
    // a late tick: both elements are in the next episode of the file
    master.currentTime = 3.2;
    follower.currentTime = 3.25;
    expect(sync.tick()).toEqual({ frameIndex: Number.POSITIVE_INFINITY, buffering: false });
    // both back on the last frame of the episode, paused
    expect(master.currentTime).toBeCloseTo(3 - 0.5 / 30, 5);
    expect(follower.currentTime).toBeCloseTo(3 - 0.5 / 30, 5);
    expect(master.paused).toBe(true);
    expect(follower.paused).toBe(true);
  });

  it('seeks a follower that ran past the episode end back to the clock', () => {
    const sync = new MediaSync();
    sync.setFps(30);
    const master = new FakeVideo();
    const follower = new FakeVideo();
    const seeks: number[] = [];
    sync.register('a', {
      video: master,
      getStart: () => 0,
      getEnd: () => 3,
      isSeeking: () => false,
    });
    sync.register('b', {
      video: follower,
      getStart: () => 0,
      getEnd: () => 3,
      seek: (time) => seeks.push(time),
      isSeeking: () => false,
    });
    sync.start(0, 1);
    master.currentTime = 2.9;
    follower.currentTime = 3.05;
    const clock = sync.tick();
    expect(clock?.buffering).toBe(false);
    expect(clock?.frameIndex).toBe(87);
    expect(seeks).toEqual([2.9]);
  });
});
