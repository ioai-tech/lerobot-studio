import React from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { tableFromIPC } from 'apache-arrow';
import { Input, BlobSource, ALL_FORMATS, CanvasSink } from 'mediabunny';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { ExportService, LeRobotDataLoader } from '@/platform';
import { getParquetWasm } from '../../src/platform/export/parquetWasmLoader';
import { InMemoryExportAdapter } from '../helpers/inMemoryExportAdapter';
import { FetchDataSource } from './fixtures';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

async function pixel(bytes: Uint8Array, time: number) {
  const input = new Input({
    source: new BlobSource(new Blob([new Uint8Array(bytes)])),
    formats: ALL_FORMATS,
  });
  try {
    const track = (await input.getPrimaryVideoTrack())!;
    const wrapped = await new CanvasSink(track).getCanvas(time);
    expect(wrapped).not.toBeNull();
    const canvas = wrapped!.canvas;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  } finally {
    input.dispose();
  }
}

describe('browser: episode trim export', () => {
  it.each([
    ['lerobotv2', 'v2.1', false, 1, 2],
    ['lerobotv2', 'v3.0', false, 1, 2],
    ['lerobotv3', 'v2.1', false, 1, 2],
    ['lerobotv3', 'v3.0', false, 1, 2],
    ['lerobotv3', 'v3.0', true, 1, 2],
    ['lerobotv3', 'v3.0', true, 1, 1],
    ['lerobotv3', 'v3.0', false, 0, 1],
    ['lerobotv2', 'v2.1', false, 1, 1],
  ] as const)(
    'roundtrips %s → %s, compact=%s',
    async (fixture, targetVersion, compactVideos, startFrame, endFrame) => {
      const loader = new LeRobotDataLoader(
        new FetchDataSource(`/tests/fixtures/datasets/${fixture}`),
      );
      try {
        const sourceInfo = await loader.initialize();
        const camera = 'observation.images.cam';
        const secondCamera = 'observation.images.wrist';
        const info = {
          ...sourceInfo,
          features: { ...sourceInfo.features, [secondCamera]: sourceInfo.features[camera] },
        };
        const getPath = loader.getEpisodeVideoPath.bind(loader);
        const spy = vi
          .spyOn(loader, 'getEpisodeVideoPath')
          .mockImplementation((index, key) => getPath(index, key === secondCamera ? camera : key));
        const sourceEpisode = loader.getEpisodes()[1];
        const range = { startFrame, endFrame };
        const sourceLocation = getPath(sourceEpisode.episode_index, camera)!;
        const originalVideo = await loader.readFileBytes(sourceLocation.path);
        const originalTable = (await loader.getEpisodeTableForExport(sourceEpisode.episode_index))
          .table;
        const adapter = new InMemoryExportAdapter();
        await new ExportService(loader, adapter).exportWithData(
          info,
          [sourceEpisode],
          loader.getTasks(),
          {
            format: 'zip',
            targetVersion,
            includeData: true,
            includeVideos: true,
            compactVideos,
            trimRanges: new Map([[sourceEpisode.episode_index, range]]),
            includeSubtasks: true,
            subtaskOverlay: new Map([[sourceEpisode.episode_index, [{ ...range, label: 'move' }]]]),
          },
        );
        const wasm = await getParquetWasm();
        const readTable = async (path: string) =>
          tableFromIPC(wasm.readParquet(await adapter.readFile(path)).intoIPCStream());
        const data = await readTable(
          targetVersion === 'v3.0'
            ? 'data/chunk-000/file-000.parquet'
            : 'data/chunk-000/episode_000000.parquet',
        );
        const n = range.endFrame - range.startFrame + 1;
        expect(data.numRows).toBe(n);
        expect(Array.from(data.getChild('frame_index')!.toArray(), Number)).toEqual(
          Array.from({ length: n }, (_, i) => i),
        );
        expect(Array.from(data.getChild('index')!.toArray(), Number)).toEqual(
          Array.from({ length: n }, (_, i) => i),
        );
        expect(Array.from(data.getChild('episode_index')!.toArray(), Number)).toEqual(
          Array(n).fill(0),
        );
        expect(Number(data.getChild('timestamp')!.get(0))).toBe(0);
        for (const key of ['action', 'observation.state']) {
          expect(data.getChild(key)!.toJSON()).toEqual(
            originalTable
              .slice(range.startFrame, range.endFrame + 1)
              .getChild(key)!
              .toJSON(),
          );
        }
        const outputInfo = JSON.parse(
          new TextDecoder().decode(await adapter.readFile('meta/info.json')),
        );
        expect(outputInfo.total_frames).toBe(n);
        expect(outputInfo.total_episodes).toBe(1);
        const stats = JSON.parse(
          new TextDecoder().decode(await adapter.readFile('meta/stats.json')),
        );
        expect(stats.frame_index).toMatchObject({ min: [0], max: [n - 1], count: [n] });
        expect(stats[camera].count).toEqual([n]);
        const sourcePixels = await Promise.all(
          Array.from({ length: n }, (_, i) =>
            pixel(
              originalVideo,
              (sourceLocation.fromSec ?? 0) + (range.startFrame + i + 0.25) / info.fps,
            ),
          ),
        );
        const expectedMean = sourcePixels.flatMap((values) =>
          values.filter((_, index) => index % 4 === 0),
        );
        expect(stats[camera].mean[0][0][0]).toBeCloseTo(
          expectedMean.reduce((sum, value) => sum + value, 0) / expectedMean.length / 255,
          5,
        );
        const meta =
          targetVersion === 'v3.0'
            ? await readTable('meta/episodes/chunk-000/file-000.parquet')
            : null;
        if (meta) {
          expect(Number(meta.getChild('stats/frame_index/max')!.get(0).get(0))).toBe(n - 1);
          expect(Array.from(data.getChild('subtask_index')!.toArray(), Number)).toEqual(
            Array(n).fill(0),
          );
        } else {
          const epStats = JSON.parse(
            new TextDecoder().decode(await adapter.readFile('meta/episodes_stats.jsonl')),
          );
          expect(epStats.stats[camera].count).toEqual([n]);
        }
        for (const key of [camera, secondCamera]) {
          const path =
            targetVersion === 'v3.0'
              ? `videos/${key}/chunk-000/file-000.mp4`
              : `videos/chunk-000/${key}/episode_000000.mp4`;
          const video = await adapter.readFile(path);
          const fast = fixture === 'lerobotv3' && targetVersion === 'v3.0' && !compactVideos;
          const from = fast ? (sourceLocation.fromSec ?? 0) + range.startFrame / info.fps : 0;
          if (fast) expect(video).toEqual(originalVideo);
          if (meta)
            expect(Number(meta.getChild(`videos/${key}/from_timestamp`)!.get(0))).toBeCloseTo(from);
          for (const i of [0, n - 1]) {
            const actual = await pixel(video, from + (i + 0.25) / info.fps);
            const expected = await pixel(
              originalVideo,
              (sourceLocation.fromSec ?? 0) + (range.startFrame + i + 0.25) / info.fps,
            );
            const error =
              actual.reduce((sum, value, index) => sum + Math.abs(value - expected[index]), 0) /
              actual.length;
            expect(error).toBeLessThan(8);
          }
        }
        expect(sourceEpisode.length).toBe(originalTable.numRows);
        spy.mockRestore();
        // Exercise the real Studio reader on the resulting files too.
        const outputLoader = new LeRobotDataLoader({
          exists: async (path) => adapter.hasFile(path),
          readBytes: (path) => adapter.readFile(path),
          readText: async (path) => new TextDecoder().decode(await adapter.readFile(path)),
          listPaths: async () => adapter.listFiles(),
        });
        try {
          const readInfo = await outputLoader.initialize();
          expect(readInfo.total_frames).toBe(n);
          expect((await outputLoader.getEpisodeTableForExport(0)).table.numRows).toBe(n);
        } finally {
          await outputLoader.dispose();
        }
      } finally {
        vi.restoreAllMocks();
        await loader.dispose();
      }
    },
  );

  it('trims embedded images before converting them to video', async () => {
    const loader = new LeRobotDataLoader(
      new FetchDataSource('/tests/fixtures/datasets/lerobotv2-image'),
    );
    try {
      const info = await loader.initialize();
      const episode = loader.getEpisodes()[0];
      const adapter = new InMemoryExportAdapter();
      await new ExportService(loader, adapter).exportWithData(info, [episode], loader.getTasks(), {
        format: 'zip',
        targetVersion: 'v3.0',
        includeData: true,
        includeVideos: true,
        trimRanges: new Map([[episode.episode_index, { startFrame: 1, endFrame: 1 }]]),
      });
      const result = JSON.parse(new TextDecoder().decode(await adapter.readFile('meta/info.json')));
      expect(result.total_frames).toBe(1);
      const path = adapter.listFiles().find((path) => path.endsWith('.mp4'))!;
      const input = new Input({
        source: new BlobSource(new Blob([new Uint8Array(await adapter.readFile(path))])),
        formats: ALL_FORMATS,
      });
      try {
        expect((await (await input.getPrimaryVideoTrack())!.computePacketStats()).packetCount).toBe(
          1,
        );
      } finally {
        input.dispose();
      }
    } finally {
      await loader.dispose();
    }
  });
});

describe('browser: episode trim controls', () => {
  it('edits, previews, preserves across episodes and resets a trim', async () => {
    await page.viewport(1280, 900);
    const host = document.createElement('div');
    host.style.cssText = 'width:1280px;height:900px';
    document.body.append(host);
    const root = createRoot(host);
    try {
      root.render(
        <LeRobotViewer
          dataSource={new FetchDataSource('/tests/fixtures/datasets/lerobotv3')}
          language="en"
          showSidebar
          showPlaybackBar
        />,
      );
      await expect.poll(() => host.querySelector('[title="Edit episodes"]')).not.toBeNull();
      await expect
        .poll(() => host.querySelector<HTMLButtonElement>('[title="Edit episodes"]')?.disabled)
        .toBe(false);
      host.querySelector<HTMLButtonElement>('[title="Edit episodes"]')!.click();
      await userEvent.click(page.getByRole('button', { name: 'Trim episode', exact: true }));
      const start = page.getByRole('spinbutton', { name: 'Start frame', exact: true });
      await start.fill('1');
      await expect
        .element(page.getByText('3 → 2 frames · keep 0.10–0.30 s', { exact: true }))
        .toBeVisible();
      await page.screenshot({ path: '../../temp/trim-controls.png' });
      await userEvent.click(page.getByRole('checkbox', { name: 'Play retained range only' }));
      await userEvent.click(page.getByRole('button', { name: 'Play/Pause' }));
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(host.querySelector('[data-slot="dialog-content"]')).toBeNull();
      await userEvent.click(page.getByRole('button', { name: 'Select Episode 1', exact: true }));
      await expect.element(start).toHaveValue(0);
      await userEvent.click(page.getByRole('button', { name: 'Select Episode 0', exact: true }));
      await expect.element(start).toHaveValue(1);
      await userEvent.click(page.getByRole('button', { name: 'Reset trim', exact: true }));
      await expect.element(start).toHaveValue(0);
    } finally {
      root.unmount();
      host.remove();
    }
  });
});
