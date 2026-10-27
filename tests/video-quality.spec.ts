import { describe, expect, it } from 'vitest';
import {
  LinkEstimate,
  measureThroughput,
  planRenditions,
  type PlannedCamera,
} from '../src/react/services/video/quality';

const MBPS = 1_000_000;

function cameras(count: number, patch: Partial<PlannedCamera> = {}): PlannedCamera[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `cam${index}`,
    visible: true,
    focused: false,
    originalBps: 13.3 * MBPS,
    current: 'preview' as const,
    ...patch,
  }));
}

describe('planRenditions', () => {
  it('shows the preview everywhere when the preview is chosen', () => {
    const plan = planRenditions({
      variant: 'preview',
      playing: true,
      cameras: cameras(2),
      linkBps: 100 * MBPS,
    });
    expect([...plan.targets.values()]).toEqual(['preview', 'preview']);
    expect(plan.limited).toBe(false);
  });

  it('switches every camera to the original while paused, whatever the link', () => {
    const plan = planRenditions({
      variant: 'original',
      playing: false,
      cameras: cameras(4),
      linkBps: 20 * MBPS,
    });
    expect([...plan.targets.values()]).toEqual(['original', 'original', 'original', 'original']);
    expect(plan.limited).toBe(false);
  });

  it('keeps every camera where it is while the link is measured', () => {
    const list = cameras(3);
    list[1].current = 'original';
    const plan = planRenditions({
      variant: 'original',
      playing: true,
      cameras: list,
      linkBps: null,
    });
    expect([...plan.targets.values()]).toEqual(['preview', 'original', 'preview']);
    expect(plan.limited).toBe(false);
  });

  it('plays every original from local files', () => {
    const plan = planRenditions({
      variant: 'original',
      playing: true,
      cameras: cameras(4),
      linkBps: Number.POSITIVE_INFINITY,
    });
    expect(plan.originalCount).toBe(4);
  });

  it('plays the originals that fit the link and keeps the preview on the others', () => {
    const plan = planRenditions({
      variant: 'original',
      playing: true,
      cameras: cameras(4),
      linkBps: 20 * MBPS,
    });
    // 0.7 × 20 Mbps admits one 13.3 Mbps original
    expect(plan.targets.get('cam0')).toBe('original');
    expect(['cam1', 'cam2', 'cam3'].map((key) => plan.targets.get(key))).toEqual([
      'preview',
      'preview',
      'preview',
    ]);
    expect(plan).toMatchObject({ limited: true, originalCount: 1, visibleCount: 4 });
    expect(plan.neededBps).toBeCloseTo(53.2 * MBPS);
  });

  it('gives the focused camera the original first', () => {
    const list = cameras(4);
    list[2].focused = true;
    const plan = planRenditions({
      variant: 'original',
      playing: true,
      cameras: list,
      linkBps: 20 * MBPS,
    });
    expect(plan.targets.get('cam2')).toBe('original');
    expect(plan.targets.get('cam0')).toBe('preview');
    expect(plan.focusedOriginal).toBe(true);
  });

  it('keeps a camera already on the original up to the keep share (no flapping)', () => {
    const list = cameras(1, { current: 'original' });
    // 13.3 / 17.5 = 0.76: above the admit share, below the keep share
    expect(
      planRenditions({
        variant: 'original',
        playing: true,
        cameras: list,
        linkBps: 17.5 * MBPS,
      }).targets.get('cam0'),
    ).toBe('original');
    expect(
      planRenditions({
        variant: 'original',
        playing: true,
        cameras: cameras(1),
        linkBps: 17.5 * MBPS,
      }).targets.get('cam0'),
    ).toBe('preview');
  });

  it('plans hidden cameras without counting them against the link', () => {
    const list = cameras(2);
    list[1].visible = false;
    const plan = planRenditions({
      variant: 'original',
      playing: true,
      cameras: list,
      linkBps: 20 * MBPS,
    });
    expect(plan.targets.get('cam0')).toBe('original');
    expect(plan).toMatchObject({ limited: false, visibleCount: 1 });
  });

  it('counts the previews the other cameras keep playing', () => {
    // 0.7 × 20 = 14 Mbps; four 1.2 Mbps previews leave 9.2 Mbps, short of 13.3 − 1.2
    const list = cameras(4, { previewBps: 1.2 * MBPS });
    const plan = planRenditions({
      variant: 'original',
      playing: true,
      cameras: list,
      linkBps: 20 * MBPS,
    });
    expect(plan.originalCount).toBe(0);
    list[3].originalBps = 9 * MBPS;
    expect(
      planRenditions({
        variant: 'original',
        playing: true,
        cameras: list,
        linkBps: 20 * MBPS,
      }).targets.get('cam3'),
    ).toBe('original');
  });

  it('uses the typical bit rate for cameras whose size is not known yet', () => {
    const list = cameras(2);
    list[1].originalBps = null;
    const plan = planRenditions({
      variant: 'original',
      playing: true,
      cameras: list,
      linkBps: 20 * MBPS,
    });
    expect(plan.neededBps).toBeCloseTo(26.6 * MBPS);
    expect(plan.limited).toBe(true);
  });
});

describe('measureThroughput', () => {
  function fakeFetch(chunks: number[], msPerChunk: number, clock: { now: number }, status = 206) {
    const requests: RequestInit[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      requests.push(init);
      let index = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index >= chunks.length) {
            controller.close();
            return;
          }
          clock.now += msPerChunk;
          controller.enqueue(new Uint8Array(chunks[index++]));
        },
      });
      return new Response(body, { status });
    }) as unknown as typeof fetch;
    return { fetchImpl, requests };
  }

  it('times the body after the first byte', async () => {
    const clock = { now: 0 };
    // 1 MB chunks every 100 ms = 80 Mbps after a first chunk that carries the latency
    const { fetchImpl, requests } = fakeFetch(Array(6).fill(1_000_000), 100, clock);
    const bps = await measureThroughput('https://example.test/v.mp4', {
      offset: 1_000,
      maxBytes: 10_000_000,
      fetchImpl,
      now: () => clock.now,
    });
    // the stream pulls one chunk ahead of the reader: within one chunk of 80 Mbps
    expect(bps).toBeGreaterThan(60_000_000);
    expect(bps).toBeLessThan(110_000_000);
    expect((requests[0].headers as Record<string, string>).Range).toBe('bytes=1000-10000999');
  });

  it('stops at the byte budget', async () => {
    const clock = { now: 0 };
    const { fetchImpl } = fakeFetch(Array(100).fill(500_000), 50, clock);
    await measureThroughput('https://example.test/v.mp4', {
      maxBytes: 2_000_000,
      fetchImpl,
      now: () => clock.now,
    });
    expect(clock.now).toBeLessThanOrEqual(250);
  });

  it('gives up on a server that never answers', async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as unknown as typeof fetch;
    const startedAt = Date.now();
    await expect(
      measureThroughput('https://example.test/v.mp4', {
        fetchImpl,
        maxMs: 50,
        headerTimeoutMs: 50,
      }),
    ).resolves.toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it('measures what arrived when the body stalls', async () => {
    let clock = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent < 4) {
            sent += 1;
            clock += 100;
            controller.enqueue(new Uint8Array(500_000));
            return;
          }
          // then nothing: the stream stalls until aborted
          return new Promise<void>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          });
        },
      });
      return new Response(body, { status: 206 });
    }) as unknown as typeof fetch;
    const bps = await measureThroughput('https://example.test/v.mp4', {
      fetchImpl,
      // the fake clock stays under the limit; the real timer ends the stalled body after 300 ms
      maxMs: 300,
      now: () => clock * 0.1,
      maxBytes: 100_000_000,
    });
    expect(bps).not.toBeNull();
  });

  it('reports nothing for a refused request', async () => {
    const clock = { now: 0 };
    const { fetchImpl } = fakeFetch([1_000], 10, clock, 403);
    expect(
      await measureThroughput('https://example.test/v.mp4', { fetchImpl, now: () => clock.now }),
    ).toBeNull();
  });
});

describe('LinkEstimate', () => {
  it('takes the best recent reading', () => {
    const link = new LinkEstimate(180_000, 60_000);
    expect(link.add(40 * MBPS, 0)).toBe(40 * MBPS);
    expect(link.add(10 * MBPS, 1_000)).toBe(40 * MBPS);
    // older than the window: forgotten
    expect(link.add(12 * MBPS, 200_000)).toBe(12 * MBPS);
  });

  it('a stall caps it, and readings from before the stall do not come back when the cap lapses', () => {
    const link = new LinkEstimate(180_000, 60_000);
    link.add(40 * MBPS, 0);
    link.capAt(8 * MBPS, 1_000);
    expect(link.add(30 * MBPS, 2_000)).toBe(8 * MBPS);
    // the cap lapsed: what was measured after the stall counts, the 40 Mbps before it does not
    expect(link.add(9 * MBPS, 70_000)).toBe(30 * MBPS);
    link.capAt(8 * MBPS, 71_000);
    expect(link.add(9 * MBPS, 140_000)).toBe(9 * MBPS);
  });
});
