#!/usr/bin/env node
/**
 * Generate a synthetic, frame-coded LeRobot v3 dataset for playback checks.
 *
 * Every camera frame shows its frame index as a large number and as a 16-bit
 * barcode (white box = 1, box k at x = 8 + 39k, y = 400..472), so a browser
 * test can decode which frame each camera presents. One episode, one data
 * parquet, one video per camera.
 *
 *   node scripts/bench/generate-frame-coded-dataset.mjs --out <dir> \
 *     [--minutes 22] [--cameras 4] [--fps 30] [--codec h264|av1] [--keep-videos]
 *
 * H.264 uses the settings of a typical LeRobot re-encode: libx264 CRF 17,
 * preset slow, GOP = fps, no B-frames, +faststart. AV1 uses libsvtav1 (g=2 as
 * LeRobot's default encoder does).
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Field,
  Float32,
  FixedSizeList,
  Int64,
  List,
  Table,
  Utf8,
  tableToIPC,
  vectorFromArray,
} from 'apache-arrow';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) {
      const next = all[i + 1];
      pairs.push([arg.slice(2), next && !next.startsWith('--') ? next : 'true']);
    }
    return pairs;
  }, []),
);
const out = path.resolve(args.out ?? 'frame-coded-dataset');
const minutes = Number(args.minutes ?? 22);
const cameras = Number(args.cameras ?? 4);
const fps = Number(args.fps ?? 30);
const codec = args.codec ?? 'h264';
const frames = Math.round(minutes * 60 * fps);
const tints = ['red', 'green', 'blue', 'yellow', 'magenta', 'cyan'];
const STATE_DIMS = 6;

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}

function encodeArgs(file, tint) {
  const boxes = Array.from(
    { length: 16 },
    (_, k) =>
      `drawbox=x=${8 + k * 39}:y=400:w=33:h=72:color=white:t=fill:enable='mod(floor(n/pow(2\\,${k}))\\,2)'`,
  ).join(',');
  const filter = `drawbox=x=0:y=0:w=640:h=24:color=${tint}:t=fill,drawtext=text='%{frame_num}':fontcolor=white:fontsize=150:x=(w-text_w)/2:y=120,${boxes}`;
  const enc =
    codec === 'av1'
      ? ['-c:v', 'libsvtav1', '-preset', '8', '-crf', '30', '-g', '2', '-pix_fmt', 'yuv420p']
      : [
          ...['-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p'],
          ...['-g', String(fps), '-keyint_min', String(fps), '-sc_threshold', '0', '-bf', '0'],
        ];
  return [
    ...['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'],
    ...['-f', 'lavfi', '-i', `color=c=black:s=640x480:r=${fps}:d=${frames / fps}`],
    ...['-vf', filter, '-frames:v', String(frames), ...enc, '-movflags', '+faststart', file],
  ];
}

async function writeParquet(file, vectors) {
  const { default: init, writeParquet: write, Table: WasmTable } = await import('parquet-wasm/esm');
  const wasm = await fs.readFile(
    path.join(root, 'node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm'),
  );
  await init({
    module_or_path: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
  });
  const ipc = tableToIPC(new Table(vectors), 'stream');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(write(WasmTable.fromIPCStream(ipc))));
}

const bigints = (n, f) =>
  vectorFromArray(
    Array.from({ length: n }, (_, i) => BigInt(f(i))),
    new Int64(),
  );
const floats = (n, f) => vectorFromArray(Float32Array.from({ length: n }, (_, i) => f(i)));
const vec = (n, f) =>
  vectorFromArray(
    Array.from({ length: n }, (_, i) => Array.from({ length: STATE_DIMS }, (_, d) => f(i, d))),
    new FixedSizeList(STATE_DIMS, new Field('item', new Float32(), false)),
  );

const videoKeys = Array.from({ length: cameras }, (_, c) => `observation.images.cam${c}`);
const videoPath = (key) => path.join(out, 'videos', key, 'chunk-000', 'file-000.mp4');
const jointNames = Array.from({ length: STATE_DIMS }, (_, d) => `joint_${d}`);

await Promise.all(
  videoKeys.map(async (key, c) => {
    const file = videoPath(key);
    if (args['keep-videos'] && (await fs.stat(file).catch(() => null))) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await run('ffmpeg', encodeArgs(file, tints[c % tints.length]));
  }),
);

await writeParquet(path.join(out, 'data/chunk-000/file-000.parquet'), {
  timestamp: floats(frames, (i) => i / fps),
  frame_index: bigints(frames, (i) => i),
  index: bigints(frames, (i) => i),
  episode_index: bigints(frames, () => 0),
  task_index: bigints(frames, () => 0),
  'observation.state': vec(frames, (i, d) => Math.sin((i / fps) * (0.2 + d * 0.05)) * (d + 1)),
  action: vec(frames, (i, d) => Math.sin((i / fps) * (0.2 + d * 0.05) + 0.1) * (d + 1)),
});

const episodeColumns = {
  episode_index: bigints(1, () => 0),
  tasks: vectorFromArray(
    [['frame-coded playback check']],
    new List(new Field('item', new Utf8(), true)),
  ),
  length: bigints(1, () => frames),
  dataset_from_index: bigints(1, () => 0),
  dataset_to_index: bigints(1, () => frames),
  'data/chunk_index': bigints(1, () => 0),
  'data/file_index': bigints(1, () => 0),
};
for (const key of videoKeys) {
  episodeColumns[`videos/${key}/chunk_index`] = bigints(1, () => 0);
  episodeColumns[`videos/${key}/file_index`] = bigints(1, () => 0);
  episodeColumns[`videos/${key}/from_timestamp`] = vectorFromArray([0]);
  episodeColumns[`videos/${key}/to_timestamp`] = vectorFromArray([frames / fps]);
}
await writeParquet(path.join(out, 'meta/episodes/chunk-000/file-000.parquet'), episodeColumns);
await writeParquet(path.join(out, 'meta/tasks.parquet'), {
  task_index: bigints(1, () => 0),
  task: vectorFromArray(['frame-coded playback check']),
});

const features = {
  'observation.state': { dtype: 'float32', shape: [STATE_DIMS], names: jointNames },
  action: { dtype: 'float32', shape: [STATE_DIMS], names: jointNames },
  timestamp: { dtype: 'float32', shape: [1], names: null },
  frame_index: { dtype: 'int64', shape: [1], names: null },
  index: { dtype: 'int64', shape: [1], names: null },
  episode_index: { dtype: 'int64', shape: [1], names: null },
  task_index: { dtype: 'int64', shape: [1], names: null },
};
for (const key of videoKeys) {
  features[key] = {
    dtype: 'video',
    shape: [480, 640, 3],
    names: ['height', 'width', 'channels'],
    info: {
      'video.height': 480,
      'video.width': 640,
      'video.codec': codec === 'av1' ? 'av1' : 'h264',
      'video.pix_fmt': 'yuv420p',
      'video.is_depth_map': false,
      'video.fps': fps,
      'video.channels': 3,
      has_audio: false,
    },
  };
}
await fs.writeFile(
  path.join(out, 'meta/info.json'),
  JSON.stringify(
    {
      codebase_version: 'v3.0',
      robot_type: 'frame_coded_bench',
      total_episodes: 1,
      total_frames: frames,
      total_tasks: 1,
      chunks_size: 1000,
      data_files_size_in_mb: 100,
      video_files_size_in_mb: 500,
      fps,
      splits: { train: '0:1' },
      data_path: 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet',
      video_path: 'videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4',
      features,
    },
    null,
    2,
  ),
);
console.log(`Wrote ${frames} frames x ${cameras} cameras (${codec}) to ${out}`);
