import { LeRobotViewer, type DataSource } from '@ioai/lerobot-studio';

// A LeRobot v3 dataset served next to the page (the package's test fixture is
// copied to `dataset/` by scripts/verify-npm-consumer.mjs). Relative URLs keep
// the app working under any mount path.
const DATASET = new URL('dataset/', document.baseURI);
const FILES = [
  'meta/info.json',
  'meta/tasks.parquet',
  'meta/episodes/chunk-000/file-000.parquet',
  'data/chunk-000/file-000.parquet',
  'videos/observation.images.cam/chunk-000/file-000.mp4',
  'videos/observation.images.cam/chunk-000/file-001.mp4',
];

async function read(filePath: string): Promise<Response> {
  // Optional files the dataset does not have are missing, without a request.
  if (!FILES.includes(filePath)) throw new Error(`Not in the dataset: ${filePath}`);
  const response = await fetch(new URL(filePath, DATASET));
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${filePath}`);
  return response;
}

const dataSource: DataSource = {
  async exists(filePath) {
    return FILES.includes(filePath);
  },
  async readText(filePath) {
    if (filePath === 'meta/info.json') window.__LEROBOT_CONSUMER__.infoRead = true;
    return (await read(filePath)).text();
  },
  async readBytes(filePath) {
    return new Uint8Array(await (await read(filePath)).arrayBuffer());
  },
  async getObjectUrl(filePath) {
    return new URL(filePath, DATASET).href;
  },
  clear() {},
  async listPaths() {
    return FILES;
  },
};

export function App() {
  return (
    <main data-npm-consumer-mounted="true">
      <LeRobotViewer dataSource={dataSource} language="en" />
    </main>
  );
}
