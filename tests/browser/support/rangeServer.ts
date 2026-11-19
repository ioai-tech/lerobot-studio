/**
 * Global setup of the browser tests: a slow HTTP/1.1 range server on its own
 * origin, the shape of object storage behind a signed URL.
 *
 * Chrome opens at most six connections to one host over HTTP/1.1, and every
 * camera of a viewer reads its file from the same storage host. A camera
 * whose element keeps reading ahead while paused holds one of those six; a
 * seek then waits for a free one. The media port serves one large H.264 file
 * (generated once with ffmpeg) under any `/v/<name>.mp4`, throttled per
 * connection; the control port (another origin, so its own six) reports the
 * media responses: how many are open now, the most at once, and each one.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

/** Bytes per second each media connection is sent. */
export const RANGE_SERVER_RATE = 2.5 * 1024 * 1024;
const CHUNK = 16 * 1024;

export interface RangeServerInfo {
  media: string;
  control: string;
  /** Seconds of the served video (12 s, 30 fps, one keyframe a second). */
  durationS: number;
}

export interface RangeServerStats {
  open: number;
  maxOpen: number;
  requests: Array<{
    path: string;
    range: string | null;
    start: number;
    end: number | null;
    bytes: number;
  }>;
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** Null where ffmpeg is missing outside CI: the tests that need it are skipped. */
    rangeServer: RangeServerInfo | null;
  }
}

/** 12 s of 320x240 noise at 30 fps: about 32 MB, so a paused reader stays busy for seconds. */
const FFMPEG_ARGS = [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  "nullsrc=s=320x240:r=30:d=12,geq=lum='random(1)*255':cb=128:cr=128",
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-crf',
  '1',
  '-g',
  '30',
  '-keyint_min',
  '30',
  '-bf',
  '0',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
];

function videoFile(): string | null {
  const dir = path.join(os.tmpdir(), 'lerobot-studio-range-server');
  // Keyed by the encode arguments: a changed recipe never reuses an old file.
  const key = createHash('sha256').update(JSON.stringify(FFMPEG_ARGS)).digest('hex').slice(0, 16);
  const file = path.join(dir, `noise-12s-${key}.mp4`);
  if (fs.existsSync(file) && fs.statSync(file).size > 16 * 1024 * 1024) return file;
  fs.mkdirSync(dir, { recursive: true });
  const partial = `${file}.${process.pid}.part.mp4`;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    // CI installs ffmpeg for the browser suite: a missing one there is an error, never a skip.
    if (process.env.CI) throw new Error('ffmpeg is required for the range-server browser tests');
    console.warn('ffmpeg not found: the range-server browser tests are skipped');
    return null;
  }
  execFileSync('ffmpeg', [...FFMPEG_ARGS, partial], { stdio: 'inherit' });
  fs.renameSync(partial, file);
  return file;
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

export default async function setup(project: TestProject) {
  const file = videoFile();
  if (!file) {
    project.provide('rangeServer', null);
    return;
  }
  const size = fs.statSync(file).size;
  const started = Date.now();
  const stats: RangeServerStats = { open: 0, maxOpen: 0, requests: [] };
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
  };

  const media = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }
    if (!req.url?.startsWith('/v/')) {
      res.writeHead(404, cors).end();
      return;
    }
    const range = req.headers.range ?? null;
    const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    const first = match ? Number(match[1]) : 0;
    const last = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (first >= size) {
      res.writeHead(416, { ...cors, 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    const row = {
      path: req.url,
      range,
      start: Date.now() - started,
      end: null as number | null,
      bytes: 0,
    };
    stats.requests.push(row);
    stats.open += 1;
    stats.maxOpen = Math.max(stats.maxOpen, stats.open);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      stats.open -= 1;
      row.end = Date.now() - started;
    };
    res.on('close', close);
    res.writeHead(match ? 206 : 200, {
      ...cors,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(last - first + 1),
      ...(match ? { 'Content-Range': `bytes ${first}-${last}/${size}` } : {}),
    });
    const fd = fs.openSync(file, 'r');
    let at = first;
    const buffer = Buffer.alloc(CHUNK);
    const tick = () => {
      if (closed || res.destroyed) {
        fs.closeSync(fd);
        return;
      }
      if (at > last) {
        fs.closeSync(fd);
        res.end();
        return;
      }
      const n = fs.readSync(fd, buffer, 0, Math.min(CHUNK, last - at + 1), at);
      at += n;
      row.bytes += n;
      res.write(Buffer.from(buffer.subarray(0, n)));
      setTimeout(tick, (n / RANGE_SERVER_RATE) * 1000);
    };
    tick();
  });

  const control = http.createServer((req, res) => {
    const headers = { ...cors, 'Content-Type': 'application/json' };
    if (req.url === '/reset') {
      stats.maxOpen = stats.open;
      stats.requests = stats.requests.filter((row) => row.end === null);
      res.writeHead(200, headers).end('{}');
      return;
    }
    res.writeHead(200, headers).end(JSON.stringify(stats));
  });

  const info: RangeServerInfo = {
    media: await listen(media),
    control: await listen(control),
    durationS: 12,
  };
  project.provide('rangeServer', info);
  return async () => {
    media.closeAllConnections();
    control.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => media.close(resolve)),
      new Promise((resolve) => control.close(resolve)),
    ]);
  };
}
