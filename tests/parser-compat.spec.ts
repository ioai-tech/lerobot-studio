import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EpisodeMetadata, LeRobotFeature, LeRobotInfo } from '@ioai/lerobot-studio-core';
import {
  getAdapterForVersion,
  getValidatorForVersion,
  type MetadataLoadingHelpers,
} from '@ioai/lerobot-studio-core';
import { LocalFsDataSource } from './helpers/localFsDataSource';
import { readParquetToIPC } from './helpers/parquet';

interface ParserSummary {
  version: string;
  validator: {
    warningCodes: string[];
    infoCodes: string[];
  };
  infoTotals: {
    totalEpisodes: number;
    totalFrames: number;
    totalTasks: number;
  };
  episodeCount: number;
  episodeIndexRange: {
    min: number;
    max: number;
  } | null;
  totalEpisodeLength: number;
  taskCount: number;
  taskValues: string[];
  firstEpisode: {
    episode_index: number;
    length: number;
    tasks: string[];
  } | null;
  lastEpisode: {
    episode_index: number;
    length: number;
    tasks: string[];
  } | null;
  firstDataPath: string | null;
  lastDataPath: string | null;
  firstVideoPath: string | null;
  lastVideoPath: string | null;
}

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testFileDir, '..');

function getFirstVideoFeatureKey(features: Record<string, LeRobotFeature>): string | null {
  const feature = Object.entries(features).find(([, value]) => value?.dtype === 'video');
  return feature ? feature[0] : null;
}

async function loadExpected(name: string): Promise<ParserSummary> {
  const p = path.resolve(repoRoot, `tests/fixtures/expected/${name}.expected.json`);
  const text = await fs.readFile(p, 'utf-8');
  return JSON.parse(text) as ParserSummary;
}

async function listExampleDatasets(): Promise<Array<{ name: string; dir: string }>> {
  const examplesDir = path.resolve(repoRoot, 'tests/fixtures/datasets');
  const entries = await fs.readdir(examplesDir, { withFileTypes: true });
  const datasets: Array<{ name: string; dir: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.resolve(examplesDir, entry.name);
    try {
      await fs.access(path.join(dir, 'meta', 'info.json'));
      datasets.push({ name: entry.name, dir });
    } catch {
      throw new Error(`Example dataset is missing meta/info.json: ${entry.name}`);
    }
  }

  if (datasets.length === 0) {
    throw new Error('No example datasets found under tests/fixtures/datasets');
  }

  return datasets.sort((left, right) => left.name.localeCompare(right.name));
}

async function listGoldenDatasets(): Promise<Array<{ name: string; dir: string }>> {
  const expectedDir = path.resolve(repoRoot, 'tests/fixtures/expected');
  const expectedFiles = await fs.readdir(expectedDir);
  const expectedNames = new Set(
    expectedFiles
      .filter((file) => file.endsWith('.expected.json'))
      .map((file) => file.replace(/\.expected\.json$/, '')),
  );

  const datasets = await listExampleDatasets();
  return datasets.filter(({ name }) => expectedNames.has(name));
}

async function summarizeDataset(datasetDir: string): Promise<ParserSummary> {
  const dataSource = new LocalFsDataSource(datasetDir);
  const infoText = await dataSource.readText('meta/info.json');
  const info = JSON.parse(infoText) as LeRobotInfo;
  const adapter = getAdapterForVersion(info.codebase_version);
  const validator = getValidatorForVersion(info.codebase_version);

  const helpers: MetadataLoadingHelpers = {
    readParquetToIPC: async (datasetPath: string) => {
      const bytes = await dataSource.readBytes(datasetPath);
      return readParquetToIPC(bytes);
    },
  };

  const report = await validator.validate(dataSource, info, helpers);
  const errorMessages = report.items
    .filter((item) => item.level === 'error')
    .map((item) => item.message);
  if (report.hasError) {
    throw new Error(`Dataset format validation failed: ${errorMessages.join('; ')}`);
  }

  const episodes = await adapter.loadEpisodes(dataSource, helpers);
  const tasks = await adapter.loadTasks(dataSource, helpers);

  // Keep behavior consistent with LeRobotDataLoader for v3 task display.
  if (adapter.version.startsWith('v3')) {
    episodes.forEach((ep) => {
      const idx = ep.task_index ?? 0;
      if (tasks[idx] !== undefined) {
        ep.tasks = [tasks[idx]];
      }
    });
  }

  const sortedEpisodes = [...episodes].sort((a, b) => a.episode_index - b.episode_index);
  const episodeIndices = sortedEpisodes.map((ep) => ep.episode_index);
  const totalEpisodeLength = sortedEpisodes.reduce((acc, ep) => acc + ep.length, 0);
  const firstEpisode = sortedEpisodes[0] as EpisodeMetadata | undefined;
  const lastEpisode = sortedEpisodes[sortedEpisodes.length - 1] as EpisodeMetadata | undefined;
  const firstVideoKey = getFirstVideoFeatureKey(info.features);
  const firstDataPath = adapter.getEpisodeDataPath(info, episodes, 0)?.path ?? null;
  const lastDataPath = lastEpisode
    ? (adapter.getEpisodeDataPath(info, episodes, lastEpisode.episode_index)?.path ?? null)
    : null;
  const firstVideoPath = firstVideoKey
    ? (adapter.getEpisodeVideoPath(info, episodes, 0, firstVideoKey)?.path ?? null)
    : null;
  const lastVideoPath =
    firstVideoKey && lastEpisode
      ? (adapter.getEpisodeVideoPath(info, episodes, lastEpisode.episode_index, firstVideoKey)
          ?.path ?? null)
      : null;
  const taskValues = Object.entries(tasks)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, value]) => value);
  const warningCodes = report.items
    .filter((item) => item.level === 'warning')
    .map((item) => item.code ?? 'UNKNOWN_WARNING');
  const infoCodes = report.items
    .filter((item) => item.level === 'info')
    .map((item) => item.code ?? 'UNKNOWN_INFO');

  if (sortedEpisodes.length > 0) {
    for (let i = 0; i < sortedEpisodes.length; i += 1) {
      if (sortedEpisodes[i].episode_index !== i) {
        throw new Error(`Episode index is not contiguous at position ${i}`);
      }
    }
  }

  if (firstDataPath && !(await dataSource.exists(firstDataPath))) {
    throw new Error(`Resolved first data path does not exist: ${firstDataPath}`);
  }
  if (lastDataPath && !(await dataSource.exists(lastDataPath))) {
    throw new Error(`Resolved last data path does not exist: ${lastDataPath}`);
  }
  if (firstVideoPath && !(await dataSource.exists(firstVideoPath))) {
    throw new Error(`Resolved first video path does not exist: ${firstVideoPath}`);
  }
  if (lastVideoPath && !(await dataSource.exists(lastVideoPath))) {
    throw new Error(`Resolved last video path does not exist: ${lastVideoPath}`);
  }

  return {
    version: info.codebase_version,
    validator: {
      warningCodes,
      infoCodes,
    },
    infoTotals: {
      totalEpisodes: info.total_episodes,
      totalFrames: info.total_frames,
      totalTasks: info.total_tasks,
    },
    episodeCount: episodes.length,
    episodeIndexRange:
      episodeIndices.length > 0
        ? {
            min: episodeIndices[0],
            max: episodeIndices[episodeIndices.length - 1],
          }
        : null,
    totalEpisodeLength,
    taskCount: Object.keys(tasks).length,
    taskValues,
    firstEpisode: firstEpisode
      ? {
          episode_index: firstEpisode.episode_index,
          length: firstEpisode.length,
          tasks: firstEpisode.tasks,
        }
      : null,
    lastEpisode: lastEpisode
      ? {
          episode_index: lastEpisode.episode_index,
          length: lastEpisode.length,
          tasks: lastEpisode.tasks,
        }
      : null,
    firstDataPath,
    lastDataPath,
    firstVideoPath,
    lastVideoPath,
  };
}

describe('parser compatibility regression (single command suite)', () => {
  it('smoke parses every dataset under tests/fixtures/datasets/', async () => {
    const datasets = await listExampleDatasets();

    for (const { name, dir } of datasets) {
      const actual = await summarizeDataset(dir);
      expect(actual.episodeCount, `${name} episode count`).toBe(actual.infoTotals.totalEpisodes);
      expect(actual.totalEpisodeLength, `${name} total frames`).toBe(actual.infoTotals.totalFrames);
      expect(actual.taskCount, `${name} task count`).toBe(actual.infoTotals.totalTasks);
    }
  });

  it('matches golden results for representative example datasets', async () => {
    const goldenDatasets = await listGoldenDatasets();
    expect(goldenDatasets.length).toBeGreaterThan(0);

    for (const { name, dir } of goldenDatasets) {
      const actual = await summarizeDataset(dir);
      const expected = await loadExpected(name);
      // Validator info-level noise depends on optional metadata keys; compare structural fields.
      const { validator: _a, ...actualCore } = actual;
      const { validator: _e, ...expectedCore } = expected;
      expect(actualCore).toEqual(expectedCore);
      expect(actual.validator.warningCodes).toEqual(expected.validator.warningCodes);
    }
  });

  const invalidDatasets = [
    {
      name: 'v2-missing-episodes',
      dir: path.resolve(repoRoot, 'tests/fixtures/invalid/v2-missing-episodes'),
      expectedErrorCode: 'EPISODES_MISSING',
    },
    {
      name: 'v3-missing-episodes-parquet',
      dir: path.resolve(repoRoot, 'tests/fixtures/invalid/v3-missing-episodes-parquet'),
      expectedErrorCode: 'EPISODES_PARQUET_MISSING',
    },
  ];

  it.each(invalidDatasets)(
    'flags invalid fixture $name with expected error code',
    async ({ dir, expectedErrorCode }) => {
      const dataSource = new LocalFsDataSource(dir);
      const infoText = await dataSource.readText('meta/info.json');
      const info = JSON.parse(infoText) as LeRobotInfo;
      const validator = getValidatorForVersion(info.codebase_version);
      const report = await validator.validate(dataSource, info, undefined);
      const errorCodes = report.items
        .filter((item) => item.level === 'error')
        .map((item) => item.code)
        .filter(Boolean);
      expect(report.hasError).toBe(true);
      expect(errorCodes).toContain(expectedErrorCode);
      // 允许有其他 error（如 FEATURES_EMPTY），允许有 warning
    },
  );
});
