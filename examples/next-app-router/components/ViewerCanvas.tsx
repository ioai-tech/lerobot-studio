'use client';

import { LeRobotViewer, type DataSource } from '@ioai/lerobot-studio';

const files: Record<string, string> = {
  'meta/info.json': JSON.stringify({
    codebase_version: 'v2.1',
    robot_type: 'next-consumer-fixture',
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
  'meta/episodes.jsonl': '{"episode_index":0,"length":1,"tasks":["smoke test"]}\n',
  'meta/tasks.jsonl': '{"task_index":0,"task":"smoke test"}\n',
};

const dataSource: DataSource = {
  async exists(filePath) {
    return filePath in files;
  },
  async readText(filePath) {
    const value = files[filePath];
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
    return Object.keys(files);
  },
};

export default function ViewerCanvas() {
  return (
    <main>
      <LeRobotViewer
        dataSource={dataSource}
        language="en"
        showPlaybackBar={false}
        showSidebar={false}
      />
    </main>
  );
}
