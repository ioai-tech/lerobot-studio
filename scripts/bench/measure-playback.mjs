#!/usr/bin/env node
/**
 * Measure playback of a frame-coded dataset (see generate-frame-coded-dataset.mjs)
 * in headless Chromium against the bench page served by range-server.mjs.
 *
 *   node scripts/bench/measure-playback.mjs --url 'http://127.0.0.1:4877/?manifest=/manifest/x.json' \
 *     [--play-seconds 60] [--seeks 10] [--seed 7] [--label main] \
 *     [--executable /usr/bin/google-chrome] [--charts-only]
 *
 * `--charts-only` stops after the charts: first frame, first chart drawn,
 * every chart drawn, and the parquet bytes read (with their Range headers).
 *
 * Reports: time to first frame (first / all cameras), charts visible, seek
 * latency (until every camera presents the target frame), camera disagreement
 * (decoded barcode spread) paused and while playing, presented fps per camera
 * (requestVideoFrameCallback count), dropped frames, and browser CPU.
 */
import { promises as fs } from 'node:fs';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const url = opt('url');
const playSeconds = Number(opt('play-seconds', 60));
const seekCount = Number(opt('seeks', 10));
let seed = Number(opt('seed', 7));
const label = opt('label', 'run');
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const instrument = () => {
  const t = {
    firstFrame: new Map(),
    chartsAt: null,
    chartsCompleteAt: null,
    counts: new Map(),
    longTasks: [],
  };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) t.longTasks.push([entry.startTime, entry.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // not supported
  }
  window.__probe = t;
  const watch = (video) => {
    if (video.__probed) return;
    video.__probed = true;
    const id = video.closest('[data-testid]')?.dataset.testid ?? `video-${t.counts.size}`;
    video.__probeId = id;
    t.counts.set(video, 0);
    video.__events = { seeking: 0, waiting: 0, ratechange: 0, pause: 0 };
    for (const type of Object.keys(video.__events)) {
      video.addEventListener(type, () => video.__events[type]++);
    }
    const onFrame = (now, meta) => {
      if (!t.firstFrame.has(video)) t.firstFrame.set(video, now);
      t.counts.set(video, (t.counts.get(video) ?? 0) + 1);
      video.__lastMediaTime = meta.mediaTime;
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  };
  const scan = () => {
    document.querySelectorAll('video').forEach(watch);
    if (t.chartsAt == null && document.querySelector('.uplot canvas, .u-wrap canvas')) {
      t.chartsAt = performance.now();
    }
    // Every chart group drawn: the groups container is no longer busy.
    const groups = document.querySelector('[data-testid="chart-groups"]');
    if (
      t.chartsCompleteAt == null &&
      t.chartsAt != null &&
      groups &&
      groups.getAttribute('aria-busy') !== 'true'
    ) {
      t.chartsCompleteAt = performance.now();
    }
  };
  new MutationObserver(scan).observe(document, { childList: true, subtree: true });
  const poll = () => {
    scan();
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  /** Decode the barcode of every visible camera at this instant. */
  window.__decodeAll = () =>
    [...document.querySelectorAll('video')]
      .filter((video) => video.readyState >= 2 && video.videoWidth > 0)
      .map((video) => {
        ctx.drawImage(video, 0, 0, 640, 480);
        const pixels = ctx.getImageData(0, 436, 640, 1).data;
        let value = 0;
        for (let k = 0; k < 16; k++) {
          const x = 8 + k * 39 + 16;
          if (pixels[x * 4] > 128) value |= 1 << k;
        }
        return value;
      });
};

async function cpuSeconds(rootPid) {
  const children = new Map();
  for (const entry of await fs.readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const stat = await fs.readFile(`/proc/${entry}/stat`, 'utf8').catch(() => null);
    if (!stat) continue;
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    children.set(Number(entry), {
      ppid: Number(fields[1]),
      cpu: (Number(fields[11]) + Number(fields[12])) / 100,
    });
  }
  let total = 0;
  // Every process below the root, excluding the root (this script) itself.
  const stack = [...children].filter(([, info]) => info.ppid === rootPid).map(([child]) => child);
  while (stack.length) {
    const pid = stack.pop();
    total += children.get(pid)?.cpu ?? 0;
    for (const [child, info] of children) if (info.ppid === pid) stack.push(child);
  }
  return total;
}

const browser = await chromium.launch({
  headless: true,
  channel: opt('channel', undefined),
  executablePath: opt('executable', undefined),
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.addInitScript(instrument);
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
const origin = new URL(url).origin;
await fetch(`${origin}/__reads?reset=1`).catch(() => null);
await page.goto(url);

const result = { label, url };
await page.waitForFunction(
  () => {
    const p = window.__probe;
    const videos = document.querySelectorAll('video');
    return videos.length > 0 && p.firstFrame.size === videos.length;
  },
  null,
  { timeout: 120_000 },
);
await page.waitForFunction(() => window.__probe.chartsAt != null, null, { timeout: 120_000 });
Object.assign(
  result,
  await page.evaluate(() => {
    const p = window.__probe;
    const times = [...p.firstFrame.values()];
    return {
      cameras: times.length,
      firstFrameMs: Math.round(Math.min(...times)),
      allCamerasFirstFrameMs: Math.round(Math.max(...times)),
      chartsVisibleMs: Math.round(p.chartsAt),
    };
  }),
);
await page.waitForFunction(() => window.__probe.chartsCompleteAt != null, null, {
  timeout: 120_000,
});
result.chartsCompleteMs = await page.evaluate(() => Math.round(window.__probe.chartsCompleteAt));
result.chartsAfterFirstFrameMs = result.chartsVisibleMs - result.firstFrameMs;
result.chartsCompleteAfterFirstFrameMs = result.chartsCompleteMs - result.firstFrameMs;
if (argv.includes('--charts-only')) {
  // Let late reads finish so the byte count is complete.
  await page.waitForTimeout(500);
  const served = await (await fetch(`${origin}/__reads`)).json();
  const dataReads = served
    .filter((read) => /\/data\/chunk-[^/]+\/[^/]+\.parquet$/.test(read.file))
    .map((read) => ({ ...read, file: read.file.split('/').slice(-3).join('/') }));
  result.parquet = {
    requests: dataReads.length,
    bytes: dataReads.reduce((sum, read) => sum + read.bytes, 0),
    reads: dataReads,
  };
  result.pageErrors = errors;
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
}
await page.waitForFunction(() => window.__bench?.ready, null, { timeout: 120_000 });
const { frameCount } = await page.evaluate(() => ({ frameCount: window.__bench.frameCount }));
result.frameCount = frameCount;

// Seeks (paused): latency until every camera presents the target frame.
// The viewer autoplays on open; pause first.
await page.evaluate(() => window.__bench.setPlaying(false));
await page.waitForFunction(() => window.__bench.isPlaying === false);
const seeks = [];
for (let i = 0; i < seekCount; i++) {
  const target = Math.floor(rand() * (frameCount - 1));
  const sample = await page.evaluate(async (target) => {
    const start = performance.now();
    window.__bench.setFrame(target);
    while (performance.now() - start < 10_000) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const decoded = window.__decodeAll();
      if (decoded.length > 0 && decoded.every((value) => value === target)) {
        return { target, ms: performance.now() - start, decoded };
      }
    }
    return { target, ms: null, decoded: window.__decodeAll() };
  }, target);
  // Let it settle, then check agreement again.
  await page.waitForTimeout(300);
  sample.settled = await page.evaluate(() => window.__decodeAll());
  sample.pausedDisagreement =
    Math.max(...sample.settled.map((v) => Math.abs(v - sample.target))) || 0;
  seeks.push(sample);
}
const latencies = seeks.map((s) => s.ms ?? Infinity).sort((a, b) => a - b);
result.seekMs = {
  p50: Math.round(latencies[Math.floor(latencies.length * 0.5)]),
  p90: Math.round(latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.9) - 1)]),
  max: Math.round(latencies.at(-1)),
  timeouts: seeks.filter((s) => s.ms == null).length,
};
result.pausedDisagreementFrames = Math.max(...seeks.map((s) => s.pausedDisagreement));

// Play from a random start for playSeconds.
const startFrame = Math.floor(rand() * Math.max(1, frameCount - playSeconds * 40));
await page.evaluate((f) => window.__bench.setFrame(f), startFrame);
await page.waitForTimeout(1500);
const pid = process.pid;
const cpuBefore = pid ? await cpuSeconds(pid) : null;
const before = await page.evaluate(() =>
  [...window.__probe.counts.entries()].map(([video, count]) => ({
    count,
    dropped: video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0,
    total: video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0,
    events: { ...video.__events },
  })),
);
const playStartWall = Date.now();
const playStartPerf = await page.evaluate(() => performance.now());
await page.evaluate(() => window.__bench.setPlaying(true));
const spreads = [];
const clockLag = [];
while (Date.now() - playStartWall < playSeconds * 1000) {
  await page.waitForTimeout(250);
  const sample = await page.evaluate(() => ({
    decoded: window.__decodeAll(),
    clock: window.__bench.getFrame(),
    playing: window.__bench.isPlaying,
  }));
  if (sample.decoded.length > 1) {
    spreads.push(Math.max(...sample.decoded) - Math.min(...sample.decoded));
    clockLag.push(Math.max(...sample.decoded.map((v) => Math.abs(v - sample.clock))));
  }
}
const elapsed = (Date.now() - playStartWall) / 1000;
const longTasks = await page.evaluate(
  (since) => window.__probe.longTasks.filter(([start]) => start >= since),
  playStartPerf,
);
const after = await page.evaluate(() =>
  [...window.__probe.counts.entries()].map(([video, count]) => ({
    count,
    dropped: video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0,
    total: video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0,
    events: { ...video.__events },
  })),
);
const endFrame = await page.evaluate(() => window.__bench.getFrame());
await page.evaluate(() => window.__bench.setPlaying(false));
const cpuAfter = pid ? await cpuSeconds(pid) : null;
const sortedSpread = [...spreads].sort((a, b) => a - b);
result.play = {
  seconds: Number(elapsed.toFixed(1)),
  clockFramesAdvanced: endFrame - startFrame,
  clockFps: Number(((endFrame - startFrame) / elapsed).toFixed(1)),
  presentedFpsPerCamera: after.map((a, i) =>
    Number(((a.count - before[i].count) / elapsed).toFixed(1)),
  ),
  droppedPerCamera: after.map((a, i) => a.dropped - before[i].dropped),
  decodedFpsPerCamera: after.map((a, i) =>
    Number(((a.total - a.dropped - (before[i].total - before[i].dropped)) / elapsed).toFixed(1)),
  ),
  eventsPerCamera: after.map((a, i) =>
    Object.fromEntries(Object.entries(a.events).map(([k, v]) => [k, v - before[i].events[k]])),
  ),
  disagreementFrames: {
    p50: sortedSpread[Math.floor(sortedSpread.length / 2)] ?? null,
    p95: sortedSpread[Math.floor(sortedSpread.length * 0.95)] ?? null,
    max: sortedSpread.at(-1) ?? null,
    samples: sortedSpread.length,
  },
  longTasks: {
    count: longTasks.length,
    totalMs: Math.round(longTasks.reduce((sum, [, d]) => sum + d, 0)),
    maxMs: Math.round(Math.max(0, ...longTasks.map(([, d]) => d))),
  },
  maxCameraVsClockFrames: clockLag.length ? Math.max(...clockLag) : null,
  browserCpuCores: cpuBefore != null ? Number(((cpuAfter - cpuBefore) / elapsed).toFixed(2)) : null,
};
result.seeks = seeks.map(({ target, ms, settled }) => ({
  target,
  ms: ms && Math.round(ms),
  settled,
}));
result.pageErrors = errors;
console.log(JSON.stringify(result, null, 2));
await browser.close();
