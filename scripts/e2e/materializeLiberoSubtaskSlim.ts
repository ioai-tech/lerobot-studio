import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as arrow from 'apache-arrow';
import { tableFromIPC } from 'apache-arrow';
import { getParquetWasmNode } from '../../tests/helpers/parquetWasmNode.ts';

export const DEFAULT_V3_SUBTASK_DATASET = '/data/lerobot/libero_10_subtask';

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

export function slimV3OutputDir(): string {
  return path.join(repoRoot(), 'tests/fixtures/generated/libero_10_subtask');
}

export function isV3SubtaskSourceAvailable(
  root = process.env.LEROBOT_V3_SUBTASK_DATASET?.trim() || DEFAULT_V3_SUBTASK_DATASET,
): boolean {
  return existsSync(path.join(root, 'data/chunk-000/file-000.parquet'));
}

async function writeParquet(table: arrow.Table, dest: string): Promise<void> {
  const wasm = await getParquetWasmNode();
  const ipcBytes = arrow.tableToIPC(table, 'stream');
  const copy = new Uint8Array(ipcBytes.length);
  copy.set(ipcBytes);
  const wasmTable = wasm.Table.fromIPCStream(copy);
  await fs.writeFile(dest, wasm.writeParquet(wasmTable));
}

function pandasIndexedMetadata(indexName: string, valueCol: string): string {
  return JSON.stringify({
    index_columns: [indexName],
    column_indexes: [
      {
        name: null,
        field_name: null,
        pandas_type: 'unicode',
        numpy_type: 'object',
        metadata: { encoding: 'UTF-8' },
      },
    ],
    columns: [
      {
        name: valueCol,
        field_name: valueCol,
        pandas_type: 'int64',
        numpy_type: 'int64',
        metadata: null,
      },
      {
        name: indexName,
        field_name: indexName,
        pandas_type: 'unicode',
        numpy_type: 'object',
        metadata: null,
      },
    ],
    attributes: {},
    creator: { library: 'lerobot-studio', version: '1.0.0' },
    pandas_version: '2.3.3',
  });
}

async function writeIndexedStringTable(
  dest: string,
  indexName: string,
  valueCol: string,
  rows: Array<{ index: number; label: string }>,
): Promise<void> {
  const sorted = [...rows].sort((a, b) => a.index - b.index);
  const value = arrow.vectorFromArray(
    sorted.map((row) => BigInt(row.index)),
    new arrow.Int64(),
  );
  const label = sorted.map((row) => row.label);
  const base = new arrow.Table({
    [valueCol]: value,
    [indexName]: arrow.vectorFromArray(label),
  });
  const schema = new arrow.Schema(
    base.schema.fields,
    new Map([...base.schema.metadata, ['pandas', pandasIndexedMetadata(indexName, valueCol)]]),
  );
  await writeParquet(new arrow.Table(schema, base.batches), dest);
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function readOfficialTaskMap(sourceRoot: string): Promise<Record<number, string>> {
  const parquetPath = path.join(sourceRoot, 'meta/tasks.parquet');
  try {
    await fs.access(parquetPath);
  } catch {
    return {};
  }
  const wasm = await getParquetWasmNode();
  const table = tableFromIPC(wasm.readParquet(await fs.readFile(parquetPath)).intoIPCStream());
  const indexVector = table.getChild('task_index');
  const labelVector = table.getChild('__index_level_0__') ?? table.getChild('task');
  const tasks: Record<number, string> = {};
  for (let row = 0; row < table.numRows; row++) {
    const index = indexVector ? Number(indexVector.get(row)) : row;
    const label = String(labelVector?.get(row) ?? '').trim();
    if (Number.isSafeInteger(index) && label) tasks[index] = label;
  }
  return tasks;
}

function slimInfoFromOfficial(
  official: Record<string, unknown> | null,
  episodeCount: number,
  frameCount: number,
  taskCount: number,
): Record<string, unknown> {
  const features: Record<string, unknown> = {
    ...((official?.features as Record<string, unknown> | undefined) ?? {}),
  };
  for (const [key, spec] of Object.entries(features)) {
    if (spec && typeof spec === 'object' && (spec as { dtype?: string }).dtype === 'video') {
      delete features[key];
    }
  }
  if (!features.subtask_index) {
    features.subtask_index = { dtype: 'int64', shape: [1], names: null };
  }
  return {
    robot_type: 'libero_panda',
    chunks_size: 1000,
    data_files_size_in_mb: 100,
    video_files_size_in_mb: 500,
    fps: 10,
    data_path: 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet',
    ...(official ?? {}),
    codebase_version: 'v3.0',
    total_episodes: episodeCount,
    total_frames: frameCount,
    total_tasks: taskCount,
    splits: { train: `0:${episodeCount}` },
    video_path: null,
    features,
  };
}

/**
 * Build a tiny, loadable v3 slice from `/data/lerobot/libero_10_subtask`.
 * Browser e2e cannot serve the full snapshot (500 episodes, ~786MB videos);
 * this first-parquet slice keeps official `subtask_index` / `info.json` / tasks.
 */
export async function materializeLiberoSubtaskSlim(
  sourceRoot = process.env.LEROBOT_V3_SUBTASK_DATASET?.trim() || DEFAULT_V3_SUBTASK_DATASET,
): Promise<string | null> {
  const sourceParquet = path.join(sourceRoot, 'data/chunk-000/file-000.parquet');
  try {
    await fs.access(sourceParquet);
  } catch {
    return null;
  }

  const outRoot = slimV3OutputDir();
  await fs.mkdir(path.join(outRoot, 'meta/episodes/chunk-000'), { recursive: true });
  await fs.mkdir(path.join(outRoot, 'data/chunk-000'), { recursive: true });
  await fs.copyFile(sourceParquet, path.join(outRoot, 'data/chunk-000/file-000.parquet'));

  const wasm = await getParquetWasmNode();
  const parquetBytes = await fs.readFile(sourceParquet);
  const table = tableFromIPC(wasm.readParquet(parquetBytes).intoIPCStream());
  const episodeVector = table.getChild('episode_index');
  const subtaskVector = table.getChild('subtask_index');
  const taskVector = table.getChild('task_index');
  if (!episodeVector) throw new Error('libero slim parquet missing episode_index');

  const lengths = new Map<number, number>();
  const episodeTaskIndex = new Map<number, number>();
  const subtaskIds = new Set<number>();
  for (let row = 0; row < table.numRows; row++) {
    const episodeIndex = Number(episodeVector.get(row));
    lengths.set(episodeIndex, (lengths.get(episodeIndex) ?? 0) + 1);
    if (!episodeTaskIndex.has(episodeIndex) && taskVector) {
      const taskIndex = Number(taskVector.get(row));
      if (Number.isSafeInteger(taskIndex) && taskIndex >= 0) {
        episodeTaskIndex.set(episodeIndex, taskIndex);
      }
    }
    if (subtaskVector) {
      const subtaskIndex = Number(subtaskVector.get(row));
      if (Number.isSafeInteger(subtaskIndex) && subtaskIndex >= 0) subtaskIds.add(subtaskIndex);
    }
  }

  const officialTasks = await readOfficialTaskMap(sourceRoot);
  const officialInfo = await readJsonObject(path.join(sourceRoot, 'meta/info.json'));
  const fallbackTaskLabel = 'libero subtask';
  const episodeIndices = [...lengths.keys()].sort((a, b) => a - b);
  let cursor = 0;
  const episodeRows = episodeIndices.map((episodeIndex) => {
    const length = lengths.get(episodeIndex) ?? 0;
    const from = cursor;
    cursor += length;
    const taskIndex = episodeTaskIndex.get(episodeIndex) ?? 0;
    const label = officialTasks[taskIndex] ?? fallbackTaskLabel;
    return {
      episode_index: episodeIndex,
      length,
      dataset_from_index: from,
      dataset_to_index: cursor,
      taskLabel: label,
    };
  });

  const episodeTable = new arrow.Table({
    episode_index: arrow.vectorFromArray(
      episodeRows.map((row) => BigInt(row.episode_index)),
      new arrow.Int64(),
    ),
    length: arrow.vectorFromArray(
      episodeRows.map((row) => BigInt(row.length)),
      new arrow.Int64(),
    ),
    dataset_from_index: arrow.vectorFromArray(
      episodeRows.map((row) => BigInt(row.dataset_from_index)),
      new arrow.Int64(),
    ),
    dataset_to_index: arrow.vectorFromArray(
      episodeRows.map((row) => BigInt(row.dataset_to_index)),
      new arrow.Int64(),
    ),
    'data/chunk_index': arrow.vectorFromArray(
      episodeRows.map(() => 0n),
      new arrow.Int64(),
    ),
    'data/file_index': arrow.vectorFromArray(
      episodeRows.map(() => 0n),
      new arrow.Int64(),
    ),
    tasks: arrow.vectorFromArray(episodeRows.map((row) => JSON.stringify([row.taskLabel]))),
  });
  await writeParquet(episodeTable, path.join(outRoot, 'meta/episodes/chunk-000/file-000.parquet'));

  const officialTasksParquet = path.join(sourceRoot, 'meta/tasks.parquet');
  try {
    await fs.copyFile(officialTasksParquet, path.join(outRoot, 'meta/tasks.parquet'));
  } catch {
    const uniqueLabels = [...new Set(episodeRows.map((row) => row.taskLabel))];
    await writeIndexedStringTable(path.join(outRoot, 'meta/tasks.parquet'), 'task', 'task_index', [
      ...uniqueLabels.map((label, index) => ({ index, label })),
    ]);
  }
  await writeIndexedStringTable(
    path.join(outRoot, 'meta/subtasks.parquet'),
    'subtask',
    'subtask_index',
    [...subtaskIds].sort((a, b) => a - b).map((index) => ({ index, label: `Subtask ${index}` })),
  );

  const taskCount = Object.keys(officialTasks).length > 0 ? Object.keys(officialTasks).length : 1;
  const info = slimInfoFromOfficial(officialInfo, episodeRows.length, table.numRows, taskCount);
  await fs.writeFile(path.join(outRoot, 'meta/info.json'), JSON.stringify(info, null, 2));
  const jsonlTasks =
    Object.keys(officialTasks).length > 0
      ? Object.entries(officialTasks)
          .sort(([left], [right]) => Number(left) - Number(right))
          .map(([index, task]) => JSON.stringify({ task_index: Number(index), task }))
          .join('\n')
      : `{"task_index":0,"task":${JSON.stringify(fallbackTaskLabel)}}`;
  await fs.writeFile(path.join(outRoot, 'meta/tasks.jsonl'), `${jsonlTasks}\n`);
  return outRoot;
}
