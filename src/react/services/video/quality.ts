/**
 * Which rendition each camera plays. Paused, every camera shows the rendition the user chose. While
 * playing, the original videos of all visible cameras may need more than the link carries (four
 * 13 Mbps originals over a 20 Mbps link): then the cameras that fit play the original (the focused
 * one first) and the others keep the preview, instead of every camera stalling.
 */

export type Rendition = 'preview' | 'original';

export interface PlannedCamera {
  key: string;
  /** On screen (a panel shows it and it is not scrolled away or covered by a maximized panel). */
  visible: boolean;
  /** Maximized or full screen: gets the original first. */
  focused: boolean;
  /** Bits per second of its original video, when known. */
  originalBps: number | null;
  /** Bits per second of its preview copy, when known (it plays that when not on the original). */
  previewBps?: number | null;
  /** The rendition it shows (or is switching to) now: keeps a camera where it is near the limit. */
  current: Rendition | null;
  /** The rendition on screen now (null: nothing yet). */
  shown?: Rendition | null;
  /** Its original starved while playing next to as many cameras: it keeps the preview. */
  blocked?: boolean;
}

export interface RenditionPlan {
  targets: Map<string, Rendition>;
  /** Some visible camera plays the preview because the link cannot carry its original. */
  limited: boolean;
  /** Bits per second the originals of all visible cameras need (null: unknown). */
  neededBps: number | null;
  linkBps: number | null;
  /** Visible cameras that play the original under this plan. */
  originalCount: number;
  visibleCount: number;
  /** The focused camera plays the original while others do not. */
  focusedOriginal: boolean;
}

/**
 * Share of the measured link the videos may claim when a camera starts the original, and when one
 * already plays it (no flapping). Range-request video does not keep up much above ~80 % of a link
 * (measured: one 13 Mbps original and three previews on 20 Mbps lost 15 % of the time to stalls).
 */
export const LINK_ADMIT_SHARE = 0.7;
export const LINK_KEEP_SHARE = 0.8;

export function planRenditions(input: {
  variant: Rendition;
  playing: boolean;
  cameras: readonly PlannedCamera[];
  linkBps: number | null;
}): RenditionPlan {
  const { variant, playing, cameras, linkBps } = input;
  const targets = new Map<string, Rendition>();
  const visible = cameras.filter((camera) => camera.visible);
  const known = visible.map((camera) => camera.originalBps).filter(isPositive);
  const typical = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null;
  const bpsOf = (camera: PlannedCamera) => camera.originalBps ?? typical;
  const neededBps =
    typical === null ? null : visible.reduce((sum, camera) => sum + (bpsOf(camera) ?? 0), 0);
  const plan: RenditionPlan = {
    targets,
    limited: false,
    neededBps,
    linkBps,
    originalCount: 0,
    visibleCount: visible.length,
    focusedOriginal: false,
  };

  if (variant === 'preview') {
    for (const camera of cameras) targets.set(camera.key, 'preview');
    return plan;
  }
  if (!playing || neededBps === null || linkBps === Number.POSITIVE_INFINITY) {
    // paused (a keyframe group per camera), sizes unknown, or a local source: everything original
    for (const camera of cameras) targets.set(camera.key, 'original');
    plan.originalCount = visible.length;
    return plan;
  }
  if (linkBps === null) {
    // the link is being measured: nobody starts a download it might not carry
    for (const camera of cameras) targets.set(camera.key, camera.current ?? 'original');
    plan.originalCount = visible.filter((camera) => camera.current !== 'preview').length;
    return plan;
  }

  // focused first, then cameras already on the original (no flapping), then panel order
  const order = [...visible].sort(
    (a, b) =>
      Number(b.focused) - Number(a.focused) ||
      Number(b.current === 'original') - Number(a.current === 'original'),
  );
  // every visible camera plays at least its preview; an original costs the difference
  const previewOf = (camera: PlannedCamera) =>
    isPositive(camera.previewBps ?? null) ? (camera.previewBps as number) : 0;
  let used = visible.reduce((sum, camera) => sum + previewOf(camera), 0);
  for (const camera of order) {
    const bps = Math.max(0, (bpsOf(camera) ?? 0) - previewOf(camera));
    const share = camera.current === 'original' ? LINK_KEEP_SHARE : LINK_ADMIT_SHARE;
    if (!camera.blocked && used + bps <= linkBps * share) {
      used += bps;
      targets.set(camera.key, 'original');
      plan.originalCount += 1;
      if (camera.focused) plan.focusedOriginal = true;
    } else {
      targets.set(camera.key, 'preview');
      plan.limited = true;
    }
  }
  // hidden cameras stay as they are (no download for a picture nobody sees); showing one plans again
  for (const camera of cameras) {
    if (!camera.visible) targets.set(camera.key, camera.shown ?? camera.current ?? 'preview');
  }
  if (!plan.limited) plan.focusedOriginal = false;
  return plan;
}

function isPositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

/**
 * Throughput of the link to `url`: download up to `maxBytes` from `offset` for at most `maxMs`, and
 * time the body after its first byte (the request latency is not throughput). Null when the server
 * refuses or the sample is too small to tell.
 */
export async function measureThroughput(
  url: string,
  options: {
    offset?: number;
    maxBytes?: number;
    maxMs?: number;
    fetchImpl?: typeof fetch;
    now?: () => number;
  } = {},
): Promise<number | null> {
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
  const maxMs = options.maxMs ?? 2_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => performance.now());
  const controller = new AbortController();
  const startedAt = now();
  let firstAt: number | null = null;
  let lastAt = startedAt;
  let bytesAfterFirst = 0;
  let total = 0;
  try {
    const response = await fetchImpl(url, {
      headers: { Range: `bytes=${offset}-${offset + maxBytes - 1}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    try {
      while (total < maxBytes && now() - startedAt < maxMs) {
        const { done, value } = await reader.read();
        if (done) break;
        const at = now();
        if (firstAt === null) firstAt = at;
        else bytesAfterFirst += value.byteLength;
        total += value.byteLength;
        lastAt = at;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      controller.abort();
    }
  } catch {
    return null;
  }
  if (firstAt !== null && lastAt - firstAt >= 50 && bytesAfterFirst >= 64 * 1024) {
    return (bytesAfterFirst * 8 * 1000) / (lastAt - firstAt);
  }
  // a small or instant body: the whole request is the best guess (a lower bound)
  const elapsed = lastAt - startedAt;
  return total >= 64 * 1024 && elapsed > 0 ? (total * 8 * 1000) / elapsed : null;
}

/** Seconds buffered contiguously after `time` in `element` (0 when `time` is not buffered). */
export function bufferedAhead(element: HTMLMediaElement, time: number): number {
  const ranges = element.buffered;
  for (let index = 0; index < ranges.length; index++) {
    if (ranges.start(index) <= time + 0.05 && time < ranges.end(index)) {
      return ranges.end(index) - time;
    }
  }
  return 0;
}
