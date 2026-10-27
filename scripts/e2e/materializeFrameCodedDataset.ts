/**
 * A small LeRobot v3 dataset whose video frames encode their own dataset frame index, so browser
 * tests can read which frame every camera shows (exact seeks, no frame of another episode, quality
 * switch keeps the frame).
 *
 * - 4 episodes x 90 frames at 30 fps; episodes 0-1 share data/video file 000, episodes 2-3 file 001
 *   (same-file and cross-file switches).
 * - 2 cameras with different sizes; a half-size preview copy of every video under
 *   `meta/preview/videos/...` (same frames, same timestamps).
 * - Each frame: 10 bits of the dataset frame index as white/black blocks in the top half and the
 *   complement in the bottom half (decoded by comparing the two, robust to compression).
 * - H.264 with B-frames and a 15-frame GOP, data parquet with 45-row row groups.
 *
 * Needs ffmpeg with libx264; returns null without it.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as arrow from 'apache-arrow';
import { getParquetWasmNode } from '../parquetWasmNode.ts';

export const FRAME_CODED_FPS = 30;
export const FRAME_CODED_EPISODE_FRAMES = 90;
export const FRAME_CODED_EPISODES = 4;
export const FRAME_CODED_BITS = 10;
export const FRAME_CODED_CAMERAS = {
  'observation.images.front': { width: 320, height: 180 },
  'observation.images.wrist': { width: 240, height: 180 },
} as const;
export const FRAME_CODED_PREVIEW_PATH =
  'meta/preview/videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4';
const VERSION = 'v1';

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

export function frameCodedOutputDir(): string {
  return path.join(repoRoot(), 'tests/fixtures/generated/frame-coded');
}

function hasLibx264(): boolean {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.includes('libx264');
}

/** RGB frame: bit i of `value` as a block in the top half, its complement below. */
function drawFrame(value: number, width: number, height: number, tint: number): Buffer {
  const frame = Buffer.alloc(width * height * 3);
  const blockWidth = Math.floor(width / FRAME_CODED_BITS);
  for (let y = 0; y < height; y++) {
    const top = y < height / 2;
    for (let x = 0; x < width; x++) {
      const bit = Math.min(FRAME_CODED_BITS - 1, Math.floor(x / blockWidth));
      const set = ((value >> bit) & 1) === 1;
      const white = top ? set : !set;
      const offset = (y * width + x) * 3;
      frame[offset] = white ? 235 : 16;
      frame[offset + 1] = white ? 235 : 16 + tint;
      frame[offset + 2] = white ? 235 : 16;
    }
  }
  return frame;
}

async function encodeVideo(
  dest: string,
  firstValue: number,
  count: number,
  width: number,
  height: number,
  tint: number,
): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-s',
      `${width}x${height}`,
      '-r',
      String(FRAME_CODED_FPS),
      '-i',
      '-',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'veryfast',
      '-crf',
      '14',
      '-g',
      '15',
      '-bf',
      '2',
      '-movflags',
      '+faststart',
      dest,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let stderr = '';
  ffmpeg.stderr.on('data', (chunk) => (stderr += String(chunk)));
  const done = new Promise<void>((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${stderr}`)),
    );
  });
  for (let index = 0; index < count; index++) {
    if (!ffmpeg.stdin.write(drawFrame(firstValue + index, width, height, tint))) {
      await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
    }
  }
  ffmpeg.stdin.end();
  await done;
}

async function writeParquet(
  table: arrow.Table,
  dest: string,
  rowGroupSize?: number,
): Promise<void> {
  const wasm = await getParquetWasmNode();
  const ipc = arrow.tableToIPC(table, 'stream');
  const copy = new Uint8Array(ipc.length);
  copy.set(ipc);
  const wasmTable = wasm.Table.fromIPCStream(copy);
  const properties = rowGroupSize
    ? new wasm.WriterPropertiesBuilder().setMaxRowGroupSize(rowGroupSize).build()
    : undefined;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, wasm.writeParquet(wasmTable, properties));
}

function floatList(rows: number[][]): arrow.Vector {
  return arrow.vectorFromArray(
    rows,
    new arrow.List(new arrow.Field('item', new arrow.Float32(), true)),
  );
}

async function writeData(root: string): Promise<void> {
  const fileEpisodes = [
    [0, 1],
    [2, 3],
  ];
  for (const [fileIndex, episodes] of fileEpisodes.entries()) {
    const rows = episodes.flatMap((episode) =>
      Array.from({ length: FRAME_CODED_EPISODE_FRAMES }, (_, frame) => ({
        episode,
        frame,
        global: episode * FRAME_CODED_EPISODE_FRAMES + frame,
      })),
    );
    const table = new arrow.Table({
      timestamp: arrow.vectorFromArray(
        rows.map((row) => row.frame / FRAME_CODED_FPS),
        new arrow.Float32(),
      ),
      frame_index: arrow.vectorFromArray(
        rows.map((row) => BigInt(row.frame)),
        new arrow.Int64(),
      ),
      episode_index: arrow.vectorFromArray(
        rows.map((row) => BigInt(row.episode)),
        new arrow.Int64(),
      ),
      index: arrow.vectorFromArray(
        rows.map((row) => BigInt(row.global)),
        new arrow.Int64(),
      ),
      task_index: arrow.vectorFromArray(
        rows.map(() => 0n),
        new arrow.Int64(),
      ),
      'observation.state': floatList(rows.map((row) => [row.global, Math.sin(row.frame / 10)])),
      action: floatList(rows.map((row) => [row.global + 0.5, Math.cos(row.frame / 10)])),
    });
    await writeParquet(
      table,
      path.join(root, `data/chunk-000/file-${String(fileIndex).padStart(3, '0')}.parquet`),
      45,
    );
  }
}

async function writeMeta(root: string): Promise<void> {
  const cameras = Object.keys(FRAME_CODED_CAMERAS);
  const total = FRAME_CODED_EPISODES * FRAME_CODED_EPISODE_FRAMES;
  const info = {
    codebase_version: 'v3.0',
    robot_type: 'frame_coded',
    total_episodes: FRAME_CODED_EPISODES,
    total_frames: total,
    total_tasks: 1,
    chunks_size: 1000,
    data_files_size_in_mb: 100,
    video_files_size_in_mb: 200,
    fps: FRAME_CODED_FPS,
    splits: { train: `0:${FRAME_CODED_EPISODES}` },
    data_path: 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet',
    video_path: 'videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4',
    features: {
      ...Object.fromEntries(
        Object.entries(FRAME_CODED_CAMERAS).map(([key, size]) => [
          key,
          {
            dtype: 'video',
            shape: [size.height, size.width, 3],
            names: ['height', 'width', 'channels'],
            info: {
              'video.fps': FRAME_CODED_FPS,
              'video.codec': 'h264',
              'video.height': size.height,
              'video.width': size.width,
              'video.pix_fmt': 'yuv420p',
              'video.channels': 3,
              'video.is_depth_map': false,
              has_audio: false,
            },
          },
        ]),
      ),
      timestamp: { dtype: 'float32', shape: [1], names: null },
      frame_index: { dtype: 'int64', shape: [1], names: null },
      episode_index: { dtype: 'int64', shape: [1], names: null },
      index: { dtype: 'int64', shape: [1], names: null },
      task_index: { dtype: 'int64', shape: [1], names: null },
      'observation.state': { dtype: 'float32', shape: [2], names: ['global', 'wave'] },
      action: { dtype: 'float32', shape: [2], names: ['global', 'wave'] },
    },
  };
  await fs.mkdir(path.join(root, 'meta'), { recursive: true });
  await fs.writeFile(path.join(root, 'meta/info.json'), JSON.stringify(info, null, 2));

  const episodes = Array.from({ length: FRAME_CODED_EPISODES }, (_, episode) => episode);
  const fileOf = (episode: number) => Math.floor(episode / 2);
  const offsetSec = (episode: number) =>
    ((episode % 2) * FRAME_CODED_EPISODE_FRAMES) / FRAME_CODED_FPS;
  const duration = FRAME_CODED_EPISODE_FRAMES / FRAME_CODED_FPS;
  const columns: Record<string, arrow.Vector> = {
    episode_index: arrow.vectorFromArray(episodes.map(BigInt), new arrow.Int64()),
    length: arrow.vectorFromArray(
      episodes.map(() => BigInt(FRAME_CODED_EPISODE_FRAMES)),
      new arrow.Int64(),
    ),
    tasks: arrow.vectorFromArray(
      episodes.map(() => ['look at the counter']),
      new arrow.List(new arrow.Field('item', new arrow.Utf8(), true)),
    ),
    'data/chunk_index': arrow.vectorFromArray(
      episodes.map(() => 0n),
      new arrow.Int64(),
    ),
    'data/file_index': arrow.vectorFromArray(
      episodes.map((episode) => BigInt(fileOf(episode))),
      new arrow.Int64(),
    ),
    dataset_from_index: arrow.vectorFromArray(
      episodes.map((episode) => BigInt(episode * FRAME_CODED_EPISODE_FRAMES)),
      new arrow.Int64(),
    ),
    dataset_to_index: arrow.vectorFromArray(
      episodes.map((episode) => BigInt((episode + 1) * FRAME_CODED_EPISODE_FRAMES)),
      new arrow.Int64(),
    ),
  };
  for (const camera of cameras) {
    columns[`videos/${camera}/chunk_index`] = arrow.vectorFromArray(
      episodes.map(() => 0n),
      new arrow.Int64(),
    );
    columns[`videos/${camera}/file_index`] = arrow.vectorFromArray(
      episodes.map((episode) => BigInt(fileOf(episode))),
      new arrow.Int64(),
    );
    columns[`videos/${camera}/from_timestamp`] = arrow.vectorFromArray(
      episodes.map(offsetSec),
      new arrow.Float64(),
    );
    columns[`videos/${camera}/to_timestamp`] = arrow.vectorFromArray(
      episodes.map((episode) => offsetSec(episode) + duration),
      new arrow.Float64(),
    );
  }
  await writeParquet(
    new arrow.Table(columns),
    path.join(root, 'meta/episodes/chunk-000/file-000.parquet'),
  );
  await writeParquet(
    new arrow.Table({
      task_index: arrow.vectorFromArray([0n], new arrow.Int64()),
      task: arrow.vectorFromArray(['look at the counter'], new arrow.Utf8()),
    }),
    path.join(root, 'meta/tasks.parquet'),
  );
}

async function writeVideos(root: string): Promise<void> {
  const jobs: Promise<void>[] = [];
  Object.entries(FRAME_CODED_CAMERAS).forEach(([camera, size], cameraIndex) => {
    for (const fileIndex of [0, 1]) {
      const first = fileIndex * 2 * FRAME_CODED_EPISODE_FRAMES;
      const count = 2 * FRAME_CODED_EPISODE_FRAMES;
      const name = `chunk-000/file-${String(fileIndex).padStart(3, '0')}.mp4`;
      const tint = cameraIndex * 40;
      jobs.push(
        encodeVideo(
          path.join(root, `videos/${camera}/${name}`),
          first,
          count,
          size.width,
          size.height,
          tint,
        ),
      );
      jobs.push(
        encodeVideo(
          path.join(root, `meta/preview/videos/${camera}/${name}`),
          first,
          count,
          size.width / 2,
          size.height / 2,
          tint,
        ),
      );
    }
  });
  await Promise.all(jobs);
}

/** Builds the dataset once (cached by version); null without ffmpeg/libx264. */
export async function materializeFrameCodedDataset(): Promise<string | null> {
  const root = frameCodedOutputDir();
  const marker = path.join(root, `.ready-${VERSION}`);
  if (existsSync(marker)) return root;
  if (!hasLibx264()) return null;
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  await writeMeta(root);
  await writeData(root);
  await writeVideos(root);
  await fs.writeFile(marker, new Date().toISOString());
  return root;
}
