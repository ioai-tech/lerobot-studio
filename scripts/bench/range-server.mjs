#!/usr/bin/env node
/**
 * Static file server with HTTP Range support and a shared, throttled link
 * (default 20 Mbit/s and 20 ms latency) for playback measurements.
 *
 *   node scripts/bench/range-server.mjs --page <built bench page dir> \
 *     --dataset name=<dir> [--dataset name2=<dir>] [--port 4877] [--mbps 20] [--latency-ms 20]
 *
 * GET /manifest/<name>.json[?expiresIn=<s>] lists the dataset's files as
 * RemoteFileEntry[] with signed-looking URLs; a URL whose `exp` has passed is
 * answered with 403, as an expired presigned URL would be.
 */
import { createReadStream, promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const datasets = new Map(
  argv
    .flatMap((arg, i) => (arg === '--dataset' ? [argv[i + 1]] : []))
    .map((pair) => {
      const [name, dir] = pair.split('=');
      return [name, path.resolve(dir)];
    }),
);
const pageDir = opt('page') ? path.resolve(opt('page')) : null;
const port = Number(opt('port', 4877));
const bytesPerSecond = (Number(opt('mbps', 20)) * 1e6) / 8;
const latencyMs = Number(opt('latency-ms', 20));
const CHUNK = 16 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.parquet': 'application/octet-stream',
};

// One shared link: chunks are transmitted one after another at the link rate.
let linkFreeAt = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function transmit(bytes) {
  const now = performance.now();
  const start = Math.max(now, linkFreeAt);
  linkFreeAt = start + (bytes / bytesPerSecond) * 1000;
  const wait = linkFreeAt - now;
  if (wait > 1) await sleep(wait);
}

async function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.wasm']);
const gzipCache = new Map();

/** Send bytes through the throttled link. */
async function sendThrottled(res, bytes) {
  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  for (let offset = 0; offset < bytes.length && !closed; offset += CHUNK) {
    const chunk = bytes.subarray(offset, offset + CHUNK);
    await transmit(chunk.length);
    if (closed) return;
    if (!res.write(chunk)) await new Promise((resolve) => res.once('drain', resolve));
  }
  res.end();
}

async function sendFile(req, res, file, extraHeaders = {}) {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  await sleep(latencyMs);
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  // Compress text and WASM like a CDN would (only for whole-file requests).
  if (
    !req.headers.range &&
    COMPRESSIBLE.has(path.extname(file)) &&
    /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
  ) {
    const cacheKey = `${file}:${stat.mtimeMs}:${stat.size}`;
    let gz = gzipCache.get(cacheKey);
    if (!gz) {
      gz = gzipSync(await fs.readFile(file), { level: 6 });
      gzipCache.set(cacheKey, gz);
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Encoding': 'gzip',
      'Content-Length': gz.length,
      'Cache-Control': 'no-store',
      ...extraHeaders,
    });
    if (req.method === 'HEAD') return res.end();
    return sendThrottled(res, gz);
  }
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    if (range[1] === '') {
      start = Math.max(0, stat.size - Number(range[2]));
    } else {
      start = Number(range[1]);
      if (range[2] !== '') end = Math.min(end, Number(range[2]));
    }
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
      return;
    }
    status = 206;
  }
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
    ...extraHeaders,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  const stream = createReadStream(file, { start, end, highWaterMark: CHUNK });
  for await (const chunk of stream) {
    if (closed) {
      stream.destroy();
      return;
    }
    await transmit(chunk.length);
    if (closed) {
      stream.destroy();
      return;
    }
    if (!res.write(chunk)) await new Promise((resolve) => res.once('drain', resolve));
  }
  res.end();
}

let signature = 0;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const manifest = /^\/manifest\/([^/]+)\.json$/.exec(url.pathname);
    if (manifest) {
      const dir = datasets.get(manifest[1]);
      if (!dir) return res.writeHead(404).end();
      const expiresIn = Number(url.searchParams.get('expiresIn') ?? 3600);
      const exp = Date.now() + expiresIn * 1000;
      signature += 1;
      const files = await listFiles(dir);
      const entries = await Promise.all(
        files.map(async (rel) => ({
          logicalPath: rel,
          presignedUrl: `${url.origin}/data/${manifest[1]}/${rel}?sig=${signature}&exp=${exp}`,
          sizeBytes: (await fs.stat(path.join(dir, rel))).size,
          expiresAt: new Date(exp).toISOString(),
        })),
      );
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(entries));
    }
    const data = /^\/data\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (data) {
      const dir = datasets.get(data[1]);
      const exp = Number(url.searchParams.get('exp') ?? Infinity);
      if (!dir) return res.writeHead(404).end();
      if (Date.now() > exp) return res.writeHead(403).end('expired');
      const file = path.resolve(dir, decodeURIComponent(data[2]));
      if (!file.startsWith(dir + path.sep)) return res.writeHead(403).end();
      return await sendFile(req, res, file);
    }
    if (!pageDir) return res.writeHead(404).end();
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(pageDir, rel);
    if (!file.startsWith(pageDir)) return res.writeHead(403).end();
    return await sendFile(req, res, file);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log(
    `range server on http://127.0.0.1:${port} (${(bytesPerSecond * 8) / 1e6} Mbit/s, ${latencyMs} ms)`,
  );
});
