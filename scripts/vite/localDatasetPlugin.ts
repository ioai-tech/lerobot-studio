import fs from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import type { Plugin } from 'vite';

const DEFAULT_V3_SUBTASK_DATASET = '/data/lerobot/libero_10_subtask';

export const DEFAULT_V2_SUBTASK_DATASET = '/data/lerobot/route_subtasks_dual_overhead_pi05';
export const DEFAULT_PUSHT_SUBTASK_DATASET = '/data/lerobot/pusht-subtask';
export const DEFAULT_DEPTH_DATASET = '/data/lerobot/outdoor-depth';

export type LocalDatasetId = 'v2' | 'v3' | 'pusht' | 'depth' | 'large' | 'framecoded';

export interface LocalDatasetStatus {
  id: LocalDatasetId;
  available: boolean;
  root: string;
  version: 'v2.1' | 'v3.0';
  /** Why a dataset this host can build is missing (the build failed); tests then fail, not skip. */
  error?: string;
}

/** One dataset request seen by the dev server (browser tests count and inspect them). */
export interface DatasetRequestLogEntry {
  id: string;
  path: string;
  query: string;
  range: string | null;
  method: string;
  status: number;
  at: number;
}

const requestLog: DatasetRequestLogEntry[] = [];
/** Requests seen per URL with `?failTimes=` (fail the first n, then serve). */
const failCounts = new Map<string, number>();
const REQUEST_LOG_LIMIT = 5_000;

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.json') || filePath.endsWith('.jsonl')) return 'application/json';
  if (filePath.endsWith('.mp4')) return 'video/mp4';
  if (filePath.endsWith('.mkv')) return 'video/x-matroska';
  if (filePath.endsWith('.parquet')) return 'application/octet-stream';
  return 'application/octet-stream';
}

function safeJoin(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) return null;
  return resolved;
}

function hasMetaInfo(root: string): boolean {
  try {
    return fs.existsSync(path.join(root, 'meta', 'info.json'));
  } catch {
    return false;
  }
}

function isV3SubtaskSourceAvailable(root: string): boolean {
  try {
    return fs.existsSync(path.join(root, 'data/chunk-000/file-000.parquet'));
  } catch {
    return false;
  }
}

export function isPushtSubtaskSourceAvailable(root: string): boolean {
  try {
    return hasMetaInfo(root) && fs.existsSync(path.join(root, 'meta', 'subtasks.parquet'));
  } catch {
    return false;
  }
}

export function isOutdoorDepthSourceAvailable(root: string): boolean {
  try {
    return hasMetaInfo(root) && fs.existsSync(path.join(root, 'data/chunk-000/file-000.parquet'));
  } catch {
    return false;
  }
}

/**
 * Optional link emulation for playback tests: `LEROBOT_E2E_THROTTLE_MBPS` caps the bytes per second
 * of every dataset response together, the way one user link is shared by all cameras.
 */
function createThrottle(mbps: number): (chunk: Buffer) => Promise<void> {
  const bytesPerMs = (mbps * 1_000_000) / 8 / 1000;
  let nextFree = 0;
  return (chunk) => {
    const now = Date.now();
    const start = Math.max(now, nextFree);
    nextFree = start + chunk.byteLength / bytesPerMs;
    const wait = nextFree - now;
    return wait > 1 ? new Promise((resolve) => setTimeout(resolve, wait)) : Promise.resolve();
  };
}

const throttleMbps = Number(process.env.LEROBOT_E2E_THROTTLE_MBPS ?? '');
const throttle = throttleMbps > 0 ? createThrottle(throttleMbps) : null;

function streamFile(
  res: import('http').ServerResponse,
  filePath: string,
  range?: { start: number; end: number },
): void {
  const stream = fs.createReadStream(filePath, range);
  if (!throttle) {
    stream.pipe(res);
    return;
  }
  res.on('close', () => stream.destroy());
  void (async () => {
    try {
      for await (const chunk of stream) {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
        await throttle(buffer);
        if (res.destroyed) return;
        if (!res.write(buffer)) await once(res, 'drain');
      }
      res.end();
    } catch {
      res.destroy();
    }
  })();
}

/** Serves a file with `Range: bytes=` support (206 / 416), like an object store behind a presigned URL. */
function sendFile(
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse,
  filePath: string,
): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  if (!stat.isFile()) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.setHeader('Content-Type', contentTypeFor(filePath));
  res.setHeader('Accept-Ranges', 'bytes');
  const header = req.headers.range;
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header) : null;
  if (match && (match[1] || match[2])) {
    let start: number;
    let end: number;
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    } else {
      start = Math.max(0, stat.size - Number(match[2]));
      end = stat.size - 1;
    }
    if (start > end || start >= stat.size) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    streamFile(res, filePath, { start, end });
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Length', String(stat.size));
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  streamFile(res, filePath);
}

function listFiles(root: string, prefix = ''): Array<{ path: string; size: number }> {
  const entries: Array<{ path: string; size: number }> = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    // stat follows symlinks, so a dataset assembled from links lists like a real one
    const stat = fs.statSync(path.join(root, relative));
    if (stat.isDirectory()) entries.push(...listFiles(root, relative));
    else if (stat.isFile()) entries.push({ path: relative, size: stat.size });
  }
  return entries;
}

/**
 * Serves `/e2e-datasets/{v2,v3,pusht,depth}/...` from host-local LeRobot datasets when present.
 * Browser tests probe `/e2e-datasets/status` and skip missing entries.
 */
export function localDatasetPlugin(): Plugin {
  const v2Root = process.env.LEROBOT_V2_SUBTASK_DATASET?.trim() || DEFAULT_V2_SUBTASK_DATASET;
  const v3Source = process.env.LEROBOT_V3_SUBTASK_DATASET?.trim() || DEFAULT_V3_SUBTASK_DATASET;
  const pushtRoot =
    process.env.LEROBOT_PUSHT_SUBTASK_DATASET?.trim() || DEFAULT_PUSHT_SUBTASK_DATASET;
  const depthRoot = process.env.LEROBOT_DEPTH_DATASET?.trim() || DEFAULT_DEPTH_DATASET;
  // A large dataset served as a remote manifest (Range reads, native playback); opt-in by path.
  const largeRoot = process.env.LEROBOT_LARGE_DATASET?.trim() ?? '';
  const largeAvailable = largeRoot !== '' && hasMetaInfo(largeRoot);
  const v2Available = hasMetaInfo(v2Root);
  const pushtAvailable = isPushtSubtaskSourceAvailable(pushtRoot);
  const depthAvailable = isOutdoorDepthSourceAvailable(depthRoot);
  let v3Root: string | null = null;
  let v3Ready: Promise<string | null> | null = null;

  return {
    name: 'local-dataset',
    configureServer(server) {
      if (isV3SubtaskSourceAvailable(v3Source)) {
        v3Ready = import('../e2e/materializeLiberoSubtaskSlim.ts')
          .then(({ materializeLiberoSubtaskSlim }) => materializeLiberoSubtaskSlim(v3Source))
          .then((root) => {
            v3Root = root;
            return root;
          })
          .catch((error: unknown) => {
            console.warn('[e2e] failed to materialize libero_10_subtask slim dataset', error);
            return null;
          });
      }

      let frameCodedRoot: string | null = null;
      let frameCodedError: string | undefined;
      const frameCodedReady = import('../e2e/materializeFrameCodedDataset.ts')
        .then(({ materializeFrameCodedDataset }) => materializeFrameCodedDataset())
        .then((root) => {
          frameCodedRoot = root;
          return root;
        })
        .catch((error: unknown) => {
          console.warn('[e2e] failed to build the frame-coded dataset', error);
          frameCodedError = error instanceof Error ? error.message : String(error);
          return null;
        });

      server.middlewares.use((req, res, next) => {
        const [url = '', queryString = ''] = (req.url ?? '').split('?');
        const query = new URLSearchParams(queryString);

        if (url === '/e2e-datasets/request-log') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(requestLog));
          if (query.get('clear') === '1') requestLog.length = 0;
          return;
        }
        if (url === '/e2e-datasets/status') {
          const finish = (v3: string | null) => {
            const datasets: Record<string, LocalDatasetStatus> = {
              v2: { id: 'v2', available: v2Available, root: v2Root, version: 'v2.1' },
              v3: {
                id: 'v3',
                available: Boolean(v3),
                root: v3 ?? v3Source,
                version: 'v3.0',
              },
              pusht: {
                id: 'pusht',
                available: pushtAvailable,
                root: pushtRoot,
                version: 'v3.0',
              },
              depth: {
                id: 'depth',
                available: depthAvailable,
                root: depthRoot,
                version: 'v3.0',
              },
              large: { id: 'large', available: largeAvailable, root: largeRoot, version: 'v3.0' },
              framecoded: {
                id: 'framecoded',
                available: Boolean(frameCodedRoot),
                root: frameCodedRoot ?? '',
                version: 'v3.0',
                ...(frameCodedError
                  ? { error: frameCodedError }
                  : !frameCodedRoot && process.env.LEROBOT_E2E_REQUIRE_FRAMECODED === '1'
                    ? {
                        error: 'ffmpeg with libx264 is required (LEROBOT_E2E_REQUIRE_FRAMECODED=1)',
                      }
                    : {}),
              },
            };
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                datasets,
                available: Object.values(datasets).some((dataset) => dataset.available),
                // opt-in timing report (tests/browser/playback-metrics.browser.spec.tsx)
                metrics: process.env.LEROBOT_PLAYBACK_METRICS === '1',
              }),
            );
          };
          void Promise.all([v3Ready ?? Promise.resolve(v3Root), frameCodedReady]).then(([v3]) =>
            finish(v3),
          );
          return;
        }

        const manifestMatch = /^\/e2e-datasets\/(large|framecoded)-manifest$/.exec(url);
        if (manifestMatch) {
          void frameCodedReady.then(() => {
            const id = manifestMatch[1];
            const root = id === 'large' ? (largeAvailable ? largeRoot : null) : frameCodedRoot;
            if (!root) {
              res.statusCode = 404;
              res.end('local dataset unavailable');
              return;
            }
            const origin = `http://${req.headers.host ?? 'localhost'}`;
            // ?expiresInMs=N: "presigned" URLs that the server refuses (403) after N ms
            const expiresInMs = Number(query.get('expiresInMs') ?? '');
            const expiresAt =
              Number.isFinite(expiresInMs) && expiresInMs > 0 ? Date.now() + expiresInMs : null;
            const signature = query.get('sig') ?? '1';
            const files = listFiles(root).map((file) => ({
              logicalPath: file.path,
              presignedUrl: `${origin}/e2e-datasets/${id}/${file.path
                .split('/')
                .map(encodeURIComponent)
                .join('/')}${expiresAt ? `?exp=${expiresAt}&sig=${signature}` : ''}`,
              sizeBytes: file.size,
              ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
            }));
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(files));
          });
          return;
        }

        const match = /^\/e2e-datasets\/(v2|v3|pusht|depth|large|framecoded)\/(.*)$/.exec(url);
        if (!match) {
          next();
          return;
        }

        const entry: DatasetRequestLogEntry = {
          id: match[1],
          path: decodeURIComponent(match[2]),
          query: queryString,
          range: typeof req.headers.range === 'string' ? req.headers.range : null,
          method: req.method ?? 'GET',
          status: 0,
          at: Date.now(),
        };
        requestLog.push(entry);
        if (requestLog.length > REQUEST_LOG_LIMIT)
          requestLog.splice(0, requestLog.length - REQUEST_LOG_LIMIT);
        res.on('finish', () => {
          entry.status = res.statusCode;
        });
        const respond = () => {
          // ?exp=<epoch ms>: an expired signature is refused like an object store does
          const exp = Number(query.get('exp') ?? '');
          if (Number.isFinite(exp) && exp > 0 && Date.now() > exp) {
            res.statusCode = 403;
            res.end('signature expired');
            return;
          }
          // ?fail=<status>: a failing server (backoff tests); with &failTimes=<n>, only the first
          // n requests of this URL fail
          const fail = Number(query.get('fail') ?? '');
          const failTimes = Number(query.get('failTimes') ?? '');
          let failing = Number.isInteger(fail) && fail >= 400;
          if (failing && Number.isInteger(failTimes) && failTimes > 0) {
            const seen = (failCounts.get(req.url ?? '') ?? 0) + 1;
            failCounts.set(req.url ?? '', seen);
            failing = seen <= failTimes;
          }
          if (failing) {
            res.statusCode = fail;
            res.end('failing on purpose');
            return;
          }

          const serve = (root: string | null, relativePath: string) => {
            if (!root) {
              res.statusCode = 404;
              res.end('local dataset unavailable');
              return;
            }
            const filePath = safeJoin(root, relativePath);
            if (!filePath) {
              res.statusCode = 400;
              res.end('invalid path');
              return;
            }
            sendFile(req, res, filePath);
          };

          const id = match[1] as LocalDatasetId;
          const relativePath = decodeURIComponent(match[2]);
          if (id === 'v2') {
            serve(v2Available ? v2Root : null, relativePath);
            return;
          }
          if (id === 'pusht') {
            serve(pushtAvailable ? pushtRoot : null, relativePath);
            return;
          }
          if (id === 'depth') {
            serve(depthAvailable ? depthRoot : null, relativePath);
            return;
          }
          if (id === 'large') {
            serve(largeAvailable ? largeRoot : null, relativePath);
            return;
          }
          if (id === 'framecoded') {
            void frameCodedReady.then((root) => serve(root, relativePath));
            return;
          }
          const sendV3 = (root: string | null) => serve(root, relativePath);
          if (v3Ready) {
            void v3Ready.then(sendV3);
            return;
          }
          sendV3(v3Root);
        };
        // ?delayMs=<ms>: a slow server (race tests): the answer comes after it
        const delayMs = Number(query.get('delayMs') ?? '');
        if (Number.isFinite(delayMs) && delayMs > 0) {
          setTimeout(respond, delayMs);
          return;
        }
        respond();
      });
    },
  };
}
