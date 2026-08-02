#!/usr/bin/env node
/**
 * Generate minimal LeRobot v2/v3 fixtures for unit + browser export tests.
 *
 * Includes:
 * - lerobotv2: numeric features + one MP4 camera (byte-copy export path)
 * - lerobotv3: numeric features + one MP4 camera (Mediabunny v3→v2 path)
 * - lerobotv2-image: numeric features + dtype:image frames (image→MP4 export)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tableToIPC, vectorFromArray, Binary, Table } from 'apache-arrow';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = path.join(root, 'tests/fixtures/datasets');

const VIDEO_KEY = 'observation.images.cam';
const IMAGE_KEY = 'observation.images.cam';
const FPS = 10;
const FRAMES_PER_EP = 3;
const EPISODE_DURATION_SEC = FRAMES_PER_EP / FPS;

/** Minimal 64×64 PNG — Chromium's AVC encoder rejects tiny frames (e.g. 2×2). */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeElEQVR4nO3PQQkAMAzAwIqdfwuriD2OQSACLjPn/p0XNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWvDWAp47MUuty3rOAAAAAElFTkSuQmCC',
  'base64',
);

/**
 * Fallback H.264/AAC-free MP4 (64×64 blue, ~0.3s @ 10fps) generated with ffmpeg.
 * Used when ffmpeg is unavailable in the environment.
 */
const FALLBACK_MP4_B64 =
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAv5tZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTIgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEwIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAJmWIhAA///7mdfgU2PIeksQGIKnCsVcp5wFs500OH1UoDGdRcGNvAAAACkGaImxDf/6nj4gAAAAIAZ5BeQ3/B30AAANebW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAASwAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAoh0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAASwAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAEsAAAIAAABAAAAAAIAbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAADABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABq21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAWtzdGJsAAAAv3N0c2QAAAAAAAAAAQAAAK9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANWF2Y0MBZAAK/+EAGGdkAAqs2UQmwEQAAAMABAAAAwBQPEiWWAEABmjr48siwP34+AAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAABO9QAATvUAAAAYc3R0cwAAAAAAAAABAAAAAwAABAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAAChjdHRzAAAAAAAAAAMAAAABAAAIAAAAAAEAAAwAAAAAAQAABAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAMAAAABAAAAIHN0c3oAAAAAAAAAAAAAAAMAAALcAAAADgAAAAwAAAAUc3RjbwAAAAAAAAABAAAAMAAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjAuMTYuMTAw';

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function writeBytes(filePath, bytes) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
}

async function writeParquetFromColumns(filePath, columns) {
  const { default: init, writeParquet, Table: WasmTable } = await import('parquet-wasm/esm');
  const wasmPath = path.resolve(root, 'node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm');
  const wasmFile = await fs.readFile(wasmPath);
  await init({
    module_or_path: wasmFile.buffer.slice(
      wasmFile.byteOffset,
      wasmFile.byteOffset + wasmFile.byteLength,
    ),
  });

  // tableFromArrays treats Uint8Array rows as Struct<Float64…>; build Binary vectors explicitly.
  const vectors = {};
  for (const [name, values] of Object.entries(columns)) {
    const isBinary =
      Array.isArray(values) &&
      values.length > 0 &&
      values.every((v) => v instanceof Uint8Array || v instanceof Buffer);
    vectors[name] = isBinary
      ? vectorFromArray(
          values.map((v) => (v instanceof Uint8Array ? v : new Uint8Array(v))),
          new Binary(),
        )
      : vectorFromArray(values);
  }
  const table = new Table(vectors);
  const ipc = tableToIPC(table, 'stream');
  const wasmTable = WasmTable.fromIPCStream(ipc);
  const parquetBytes = writeParquet(wasmTable);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(parquetBytes));
}

function numericFrameColumns(ep, n, globalOffset = 0) {
  return {
    timestamp: Array.from({ length: n }, (_, i) => i / FPS),
    episode_index: Array.from({ length: n }, () => ep),
    frame_index: Array.from({ length: n }, (_, i) => i),
    index: Array.from({ length: n }, (_, i) => globalOffset + i),
    task_index: Array.from({ length: n }, () => 0),
    'observation.state': Array.from({ length: n }, (_, i) => i * 0.1),
    action: Array.from({ length: n }, (_, i) => i * 0.05),
  };
}

const baseNumericFeatures = {
  'observation.state': { dtype: 'float32', shape: [1], names: ['joint1'] },
  action: { dtype: 'float32', shape: [1], names: ['joint1'] },
  timestamp: { dtype: 'float32', shape: [1], names: null },
  episode_index: { dtype: 'int64', shape: [1], names: null },
  frame_index: { dtype: 'int64', shape: [1], names: null },
  index: { dtype: 'int64', shape: [1], names: null },
  task_index: { dtype: 'int64', shape: [1], names: null },
};

async function createTinyMp4() {
  const tmpPath = path.join(root, 'node_modules', '.tmp-fixture.mp4');
  await fs.mkdir(path.dirname(tmpPath), { recursive: true });
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=blue:s=64x64:d=${EPISODE_DURATION_SEC}`,
      '-r',
      String(FPS),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-t',
      String(EPISODE_DURATION_SEC),
      tmpPath,
    ],
    { encoding: 'utf8' },
  );
  if (result.status === 0) {
    const bytes = await fs.readFile(tmpPath);
    await fs.rm(tmpPath, { force: true });
    return bytes;
  }
  console.warn('ffmpeg unavailable or failed; using embedded fallback MP4');
  return Buffer.from(FALLBACK_MP4_B64, 'base64');
}

async function createV2(mp4Bytes) {
  const base = path.join(outRoot, 'lerobotv2');
  const info = {
    codebase_version: 'v2.1',
    robot_type: 'test_so100',
    total_episodes: 2,
    total_frames: 6,
    total_tasks: 1,
    total_videos: 2,
    chunks_size: 1000,
    fps: FPS,
    data_path: 'data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet',
    video_path: 'videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4',
    features: {
      ...baseNumericFeatures,
      [VIDEO_KEY]: {
        dtype: 'video',
        shape: [3, 64, 64],
        names: null,
        info: { 'video.fps': FPS, 'video.codec': 'h264' },
      },
    },
  };
  await writeJson(path.join(base, 'meta/info.json'), info);
  await writeText(
    path.join(base, 'meta/episodes.jsonl'),
    [
      JSON.stringify({ episode_index: 0, length: FRAMES_PER_EP, tasks: ['pick cube'] }),
      JSON.stringify({ episode_index: 1, length: FRAMES_PER_EP, tasks: ['pick cube'] }),
    ].join('\n') + '\n',
  );
  await writeText(
    path.join(base, 'meta/tasks.jsonl'),
    `${JSON.stringify({ task_index: 0, task: 'pick cube' })}\n`,
  );

  for (const ep of [0, 1]) {
    await writeParquetFromColumns(
      path.join(base, `data/chunk-000/episode_${String(ep).padStart(6, '0')}.parquet`),
      numericFrameColumns(ep, FRAMES_PER_EP, ep * FRAMES_PER_EP),
    );
    await writeBytes(
      path.join(base, `videos/chunk-000/${VIDEO_KEY}/episode_${String(ep).padStart(6, '0')}.mp4`),
      mp4Bytes,
    );
  }
}

async function createV3(mp4Bytes) {
  const base = path.join(outRoot, 'lerobotv3');
  const info = {
    codebase_version: 'v3.0',
    robot_type: 'test_so100',
    total_episodes: 2,
    total_frames: 6,
    total_tasks: 1,
    total_videos: 2,
    chunks_size: 1000,
    fps: FPS,
    splits: { train: '0:2' },
    data_path: 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet',
    video_path: 'videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4',
    features: {
      ...baseNumericFeatures,
      [VIDEO_KEY]: {
        dtype: 'video',
        shape: [3, 64, 64],
        names: null,
        info: { 'video.fps': FPS, 'video.codec': 'h264' },
      },
    },
  };
  await writeJson(path.join(base, 'meta/info.json'), info);

  await writeParquetFromColumns(path.join(base, 'meta/episodes/chunk-000/file-000.parquet'), {
    episode_index: [0, 1],
    length: [FRAMES_PER_EP, FRAMES_PER_EP],
    data_chunk_index: [0, 0],
    data_file_index: [0, 0],
    dataset_from_index: [0, FRAMES_PER_EP],
    dataset_to_index: [FRAMES_PER_EP, FRAMES_PER_EP * 2],
    [`videos/${VIDEO_KEY}/chunk_index`]: [0, 0],
    [`videos/${VIDEO_KEY}/file_index`]: [0, 1],
    [`videos/${VIDEO_KEY}/from_timestamp`]: [0, 0],
    [`videos/${VIDEO_KEY}/to_timestamp`]: [EPISODE_DURATION_SEC, EPISODE_DURATION_SEC],
  });

  await writeParquetFromColumns(path.join(base, 'meta/tasks.parquet'), {
    task_index: [0],
    task: ['pick cube'],
  });

  await writeParquetFromColumns(path.join(base, 'data/chunk-000/file-000.parquet'), {
    timestamp: Array.from({ length: 6 }, (_, i) => (i % FRAMES_PER_EP) / FPS),
    episode_index: [0, 0, 0, 1, 1, 1],
    frame_index: [0, 1, 2, 0, 1, 2],
    index: [0, 1, 2, 3, 4, 5],
    task_index: [0, 0, 0, 0, 0, 0],
    'observation.state': Array.from({ length: 6 }, (_, i) => i * 0.1),
    action: Array.from({ length: 6 }, (_, i) => i * 0.05),
  });

  for (const ep of [0, 1]) {
    await writeBytes(
      path.join(base, `videos/${VIDEO_KEY}/chunk-000/file-${String(ep).padStart(3, '0')}.mp4`),
      mp4Bytes,
    );
  }
}

async function createV2Image() {
  const base = path.join(outRoot, 'lerobotv2-image');
  const info = {
    codebase_version: 'v2.1',
    robot_type: 'test_so100',
    total_episodes: 2,
    total_frames: 6,
    total_tasks: 1,
    total_videos: 0,
    chunks_size: 1000,
    fps: FPS,
    data_path: 'data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet',
    video_path: 'videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4',
    features: {
      ...baseNumericFeatures,
      [IMAGE_KEY]: {
        dtype: 'image',
        shape: [64, 64, 3],
        names: ['height', 'width', 'channels'],
      },
    },
  };
  await writeJson(path.join(base, 'meta/info.json'), info);
  await writeText(
    path.join(base, 'meta/episodes.jsonl'),
    [
      JSON.stringify({ episode_index: 0, length: FRAMES_PER_EP, tasks: ['pick cube'] }),
      JSON.stringify({ episode_index: 1, length: FRAMES_PER_EP, tasks: ['pick cube'] }),
    ].join('\n') + '\n',
  );
  await writeText(
    path.join(base, 'meta/tasks.jsonl'),
    `${JSON.stringify({ task_index: 0, task: 'pick cube' })}\n`,
  );

  for (const ep of [0, 1]) {
    const frames = Array.from({ length: FRAMES_PER_EP }, () => new Uint8Array(TINY_PNG));
    await writeParquetFromColumns(
      path.join(base, `data/chunk-000/episode_${String(ep).padStart(6, '0')}.parquet`),
      {
        ...numericFrameColumns(ep, FRAMES_PER_EP, ep * FRAMES_PER_EP),
        [IMAGE_KEY]: frames,
      },
    );
  }
}

async function main() {
  await fs.rm(outRoot, { recursive: true, force: true });
  await fs.mkdir(outRoot, { recursive: true });
  const mp4Bytes = await createTinyMp4();
  if (mp4Bytes.length < 12 || mp4Bytes[4] !== 0x66) {
    throw new Error('Generated MP4 is missing ftyp magic bytes');
  }
  await createV2(mp4Bytes);
  await createV3(mp4Bytes);
  await createV2Image();
  console.log('Wrote fixtures to', outRoot);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
