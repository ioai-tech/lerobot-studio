import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import {
  DEFAULT_V3_SUBTASK_DATASET,
  isV3SubtaskSourceAvailable,
  materializeLiberoSubtaskSlim,
} from '../e2e/materializeLiberoSubtaskSlim.ts';

export const DEFAULT_V2_SUBTASK_DATASET = '/data/lerobot/route_subtasks_dual_overhead_pi05';
export const DEFAULT_PUSHT_SUBTASK_DATASET = '/data/lerobot/pusht-subtask';
export const DEFAULT_DEPTH_DATASET = '/data/lerobot/outdoor-depth';

export type LocalDatasetId = 'v2' | 'v3' | 'pusht' | 'depth';

export interface LocalDatasetStatus {
  id: LocalDatasetId;
  available: boolean;
  root: string;
  version: 'v2.1' | 'v3.0';
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.json') || filePath.endsWith('.jsonl')) return 'application/json';
  if (filePath.endsWith('.mp4')) return 'video/mp4';
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

function sendFile(res: import('http').ServerResponse, filePath: string): void {
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
  res.statusCode = 200;
  res.setHeader('Content-Type', contentTypeFor(filePath));
  res.setHeader('Content-Length', String(stat.size));
  fs.createReadStream(filePath).pipe(res);
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
  const v2Available = hasMetaInfo(v2Root);
  const pushtAvailable = isPushtSubtaskSourceAvailable(pushtRoot);
  const depthAvailable = isOutdoorDepthSourceAvailable(depthRoot);
  let v3Root: string | null = null;
  let v3Ready: Promise<string | null> | null = null;

  return {
    name: 'local-dataset',
    configureServer(server) {
      if (isV3SubtaskSourceAvailable(v3Source)) {
        v3Ready = materializeLiberoSubtaskSlim(v3Source)
          .then((root) => {
            v3Root = root;
            return root;
          })
          .catch((error: unknown) => {
            console.warn('[e2e] failed to materialize libero_10_subtask slim dataset', error);
            return null;
          });
      }

      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
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
            };
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                datasets,
                available: Object.values(datasets).some((dataset) => dataset.available),
              }),
            );
          };
          if (v3Ready) {
            void v3Ready.then(finish);
            return;
          }
          finish(v3Root);
          return;
        }

        const match = /^\/e2e-datasets\/(v2|v3|pusht|depth)\/(.*)$/.exec(url);
        if (!match) {
          next();
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
          sendFile(res, filePath);
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
        const sendV3 = (root: string | null) => serve(root, relativePath);
        if (v3Ready) {
          void v3Ready.then(sendV3);
          return;
        }
        sendV3(v3Root);
      });
    },
  };
}
