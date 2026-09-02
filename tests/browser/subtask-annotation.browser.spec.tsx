import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { ExportService, LeRobotDataLoader } from '@/platform';
import { InMemoryExportAdapter } from '../helpers/inMemoryExportAdapter';
import { FetchDataSource } from './fixtures';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function waitFor(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) resolve();
      else if (performance.now() - startedAt > timeoutMs) {
        reject(new Error('waitFor timeout'));
      } else requestAnimationFrame(tick);
    };
    tick();
  });
}

function segmentTitles(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('li button[title]')).map(
    (element) => element.getAttribute('title') ?? '',
  );
}

type DatasetStatus = {
  datasets?: Record<string, { available?: boolean; version?: string }>;
};

async function probeDatasets(): Promise<DatasetStatus> {
  try {
    const response = await fetch('/e2e-datasets/status');
    if (!response.ok) return {};
    return (await response.json()) as DatasetStatus;
  } catch {
    return {};
  }
}

describe('browser: subtask viewing and annotation', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await page.viewport(1_280, 800);
    host = document.createElement('div');
    host.style.width = '1280px';
    host.style.height = '800px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('annotates a v3 fixture with Start/End and saves a labeled segment', async () => {
    const source = new FetchDataSource('/tests/fixtures/datasets/lerobotv3');
    await act(async () => {
      root.render(<LeRobotViewer dataSource={source} language="en" showSidebar showPlaybackBar />);
    });

    await waitFor(() => (host.textContent ?? '').includes('Episodes'));
    await waitFor(() => host.querySelector('[aria-label="Start (Q)"]') !== null);

    const start = host.querySelector<HTMLButtonElement>('[aria-label="Start (Q)"]');
    const end = host.querySelector<HTMLButtonElement>('[aria-label="End (R)"]');
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();

    await act(async () => {
      start?.click();
    });
    const nextFrame = host.querySelector<HTMLButtonElement>('[aria-label="Next frame"]');
    await act(async () => {
      nextFrame?.click();
      end?.click();
    });

    await waitFor(() => (host.textContent ?? '').includes('Describe subtask'));
    const textarea = host.querySelector('textarea');
    expect(textarea).toBeTruthy();
    await userEvent.fill(textarea!, 'Grasp the apple');
    const save = Array.from(host.querySelectorAll('button')).find((button) =>
      (button.textContent ?? '').includes('Save subtask'),
    );
    expect(save).toBeTruthy();
    await act(async () => {
      save?.click();
    });

    await waitFor(() => (host.textContent ?? '').includes('Grasp the apple'));
    expect(host.textContent).toContain('Grasp the apple');
  }, 60_000);

  it('loads the optional local v2.1 dataset and shows source subtasks (view only)', async ({
    skip,
  }) => {
    const status = await probeDatasets();
    if (!status.datasets?.v2?.available) {
      skip();
      return;
    }

    const source = new FetchDataSource('/e2e-datasets/v2');
    await act(async () => {
      root.render(<LeRobotViewer dataSource={source} language="en" showSidebar showPlaybackBar />);
    });

    await waitFor(() => (host.textContent ?? '').includes('Subtasks'), 90_000);
    expect(host.querySelector('[aria-label="Start (Q)"]')).toBeNull();
    expect(host.querySelector('[aria-label="End (R)"]')).toBeNull();
    expect(host.textContent ?? '').toMatch(/\d+\/\d+/);
    expect(segmentTitles(host).length).toBeGreaterThan(0);
  }, 120_000);

  it('loads the optional local v3.0 dataset, shows subtasks, annotates, and exports official files', async ({
    skip,
  }) => {
    const status = await probeDatasets();
    if (!status.datasets?.v3?.available) {
      skip();
      return;
    }

    const source = new FetchDataSource('/e2e-datasets/v3');
    await act(async () => {
      root.render(<LeRobotViewer dataSource={source} language="en" showSidebar showPlaybackBar />);
    });

    await waitFor(() => segmentTitles(host).includes('Subtask 15'), 90_000);
    await waitFor(() => host.querySelector('[aria-label="Start (Q)"]') !== null);
    expect(segmentTitles(host)).toEqual(expect.arrayContaining(['Subtask 15', 'Subtask 4']));
    expect(host.querySelector('[aria-label="Start (Q)"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="End (R)"]')).toBeTruthy();
    expect(host.textContent ?? '').toMatch(/\d+\/\d+/);

    const deleteButton = Array.from(host.querySelectorAll('button')).find(
      (button) => (button.textContent ?? '').trim() === 'Delete',
    );
    expect(deleteButton).toBeTruthy();
    await act(async () => {
      deleteButton?.click();
    });

    const start = host.querySelector<HTMLButtonElement>('[aria-label="Start (Q)"]');
    const end = host.querySelector<HTMLButtonElement>('[aria-label="End (R)"]');
    await act(async () => {
      start?.click();
    });
    const nextFrame = host.querySelector<HTMLButtonElement>('[aria-label="Next frame"]');
    await act(async () => {
      nextFrame?.click();
      end?.click();
    });
    await waitFor(() => (host.textContent ?? '').includes('Describe subtask'));
    const textarea = host.querySelector('textarea');
    await userEvent.fill(textarea!, 'Reach the object');
    const save = Array.from(host.querySelectorAll('button')).find((button) =>
      (button.textContent ?? '').includes('Save subtask'),
    );
    await act(async () => {
      save?.click();
    });
    await waitFor(() => segmentTitles(host).includes('Reach the object'));
    expect(segmentTitles(host)).toContain('Reach the object');

    const loader = new LeRobotDataLoader(new FetchDataSource('/e2e-datasets/v3'));
    try {
      const info = await loader.initialize();
      const adapter = new InMemoryExportAdapter();
      await new ExportService(loader, adapter).exportWithData(
        info,
        loader.getEpisodes(),
        loader.getTasks(),
        {
          format: 'zip',
          targetVersion: 'v3.0',
          includeData: true,
          includeVideos: false,
          sourceSubtasks: loader.getSubtasks(),
        },
      );
      const files = adapter.listFiles();
      expect(files).toContain('meta/subtasks.parquet');
      expect(files.some((file) => file.startsWith('data/') && file.endsWith('.parquet'))).toBe(
        true,
      );
      const exportedInfo = JSON.parse(
        new TextDecoder().decode(await adapter.readFile('meta/info.json')),
      ) as { features: Record<string, { dtype?: string; shape?: number[]; names?: null }> };
      expect(exportedInfo.features.subtask_index).toEqual({
        dtype: 'int64',
        shape: [1],
        names: null,
      });
    } finally {
      await loader.dispose();
    }
  }, 180_000);

  it('loads official pusht-subtask labels, treats -1 as unlabeled, and exports a covered episode', async ({
    skip,
  }) => {
    const status = await probeDatasets();
    if (!status.datasets?.pusht?.available) {
      skip();
      return;
    }

    const source = new FetchDataSource('/e2e-datasets/pusht');
    await act(async () => {
      root.render(<LeRobotViewer dataSource={source} language="en" showSidebar showPlaybackBar />);
    });

    await waitFor(() => (host.textContent ?? '').includes('Push the T-shaped'), 90_000);
    await waitFor(() => host.querySelector('[aria-label="Start (Q)"]') !== null);
    expect(host.querySelector('[aria-label="Start (Q)"]')).toBeTruthy();
    expect(segmentTitles(host)).not.toEqual(
      expect.arrayContaining(['phase 1', 'phase 2', 'phase 3']),
    );
    expect(host.textContent ?? '').toMatch(/0\/\d+/);

    const episode1 = host.querySelector<HTMLButtonElement>('[aria-label="Select Episode 1"]');
    expect(episode1).toBeTruthy();
    await act(async () => {
      episode1?.click();
    });
    await waitFor(() => segmentTitles(host).includes('phase 1'));
    expect(segmentTitles(host)).toEqual(expect.arrayContaining(['phase 1', 'phase 2', 'phase 3']));

    const loader = new LeRobotDataLoader(new FetchDataSource('/e2e-datasets/pusht'));
    try {
      const info = await loader.initialize();
      const episode = loader.getEpisodes().find((item) => item.episode_index === 1);
      expect(episode).toBeTruthy();
      const adapter = new InMemoryExportAdapter();
      await new ExportService(loader, adapter).exportWithData(info, [episode!], loader.getTasks(), {
        format: 'zip',
        targetVersion: 'v3.0',
        includeData: true,
        includeVideos: false,
        sourceSubtasks: loader.getSubtasks(),
      });
      const files = adapter.listFiles();
      expect(files).toContain('meta/subtasks.parquet');
      const exportedInfo = JSON.parse(
        new TextDecoder().decode(await adapter.readFile('meta/info.json')),
      ) as { features: Record<string, { dtype?: string; shape?: number[] }> };
      expect(exportedInfo.features.subtask_index).toEqual({
        dtype: 'int64',
        shape: [1],
        names: null,
      });
      expect(exportedInfo.features.task_index_high_level).toMatchObject({
        dtype: 'int64',
        shape: [1],
      });
    } finally {
      await loader.dispose();
    }
  }, 180_000);
});
