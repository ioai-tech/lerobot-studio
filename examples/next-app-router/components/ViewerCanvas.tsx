'use client';

import { LeRobotViewer, setParquetWasmUrl, type DataSource } from '@ioai/lerobot-studio';

// A LeRobot v3 dataset under `public/dataset/` (the package's test fixture is
// copied there by scripts/verify-npm-consumer.mjs), under the app's basePath.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const DATASET = `${BASE_PATH}/dataset/`;
const FILES = [
  'meta/info.json',
  'meta/tasks.parquet',
  'meta/episodes/chunk-000/file-000.parquet',
  'data/chunk-000/file-000.parquet',
  'videos/observation.images.cam/chunk-000/file-000.mp4',
  'videos/observation.images.cam/chunk-000/file-001.mp4',
];

// `?wasm=self-hosted`: serve the parquet WASM yourself (a copy under
// `public/`) instead of the file Next emitted from the package.
if (new URLSearchParams(location.search).get('wasm') === 'self-hosted') {
  setParquetWasmUrl(`${BASE_PATH}/self-hosted/parquet.wasm`);
}

async function read(filePath: string): Promise<Response> {
  // Optional files the dataset does not have are missing, without a request.
  if (!FILES.includes(filePath)) throw new Error(`Not in the dataset: ${filePath}`);
  const response = await fetch(`${DATASET}${filePath}`);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${filePath}`);
  return response;
}

const dataSource: DataSource = {
  async exists(filePath) {
    return FILES.includes(filePath);
  },
  async readText(filePath) {
    return (await read(filePath)).text();
  },
  async readBytes(filePath) {
    return new Uint8Array(await (await read(filePath)).arrayBuffer());
  },
  async getObjectUrl(filePath) {
    return `${DATASET}${filePath}`;
  },
  clear() {},
  async listPaths() {
    return FILES;
  },
};

export default function ViewerCanvas() {
  return (
    <main>
      <LeRobotViewer dataSource={dataSource} language="en" />
    </main>
  );
}
