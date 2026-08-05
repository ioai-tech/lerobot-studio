import { LeRobotViewer, type DataSource } from '@ioai/lerobot-studio';

const files = new Map([
  [
    'meta/info.json',
    JSON.stringify({
      codebase_version: 'v2.1',
      robot_type: 'docker-npm-consumer',
      total_episodes: 1,
      total_frames: 1,
      total_tasks: 1,
      total_videos: 0,
      chunks_size: 1000,
      fps: 30,
      features: {
        timestamp: { dtype: 'float32', shape: [1], names: null },
      },
    }),
  ],
  ['meta/episodes.jsonl', '{"episode_index":0,"length":1,"tasks":["docker smoke test"]}\n'],
  ['meta/tasks.jsonl', '{"task_index":0,"task":"docker smoke test"}\n'],
]);

const dataSource: DataSource = {
  async exists(filePath) {
    return files.has(filePath);
  },
  async readText(filePath) {
    const value = files.get(filePath);
    if (value === undefined) throw new Error(`Fixture path not found: ${filePath}`);
    return value;
  },
  async readBytes(filePath) {
    return new TextEncoder().encode(await this.readText(filePath));
  },
  async getObjectUrl(filePath, mimeType = 'application/octet-stream') {
    return URL.createObjectURL(new Blob([await this.readText(filePath)], { type: mimeType }));
  },
  clear() {},
  async listPaths() {
    return [...files.keys()];
  },
};

export function App() {
  return (
    <main data-docker-npm-consumer="vite">
      <LeRobotViewer
        dataSource={dataSource}
        language="en"
        showPlaybackBar={false}
        showSidebar={false}
      />
    </main>
  );
}
