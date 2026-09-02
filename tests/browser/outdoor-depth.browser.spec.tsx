import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer } from '@/components/LeRobotViewer';
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

describe('browser: official outdoor-depth playback', () => {
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

  it('loads lerobot/outdoor-depth, renders the depth map, and plays frames', async ({ skip }) => {
    const status = await probeDatasets();
    if (!status.datasets?.depth?.available) {
      skip();
      return;
    }

    const source = new FetchDataSource('/e2e-datasets/depth');
    await act(async () => {
      root.render(<LeRobotViewer dataSource={source} language="en" showSidebar showPlaybackBar />);
    });

    await waitFor(() => (host.textContent ?? '').includes('Episodes'), 90_000);
    await waitFor(() => host.querySelector('canvas[data-depth-map="true"]') !== null, 90_000);

    const canvas = host.querySelector<HTMLCanvasElement>('canvas[data-depth-map="true"]');
    expect(canvas).toBeTruthy();
    expect(canvas?.getAttribute('data-feature-key')).toBe('observation.images.depth');
    await waitFor(() => (canvas?.width ?? 0) >= 1280 && (canvas?.height ?? 0) >= 720, 90_000);
    expect(canvas?.width).toBe(1280);
    expect(canvas?.height).toBe(720);

    await waitFor(() => host.querySelector('[aria-label="Next frame"]') !== null);
    const nextFrame = host.querySelector<HTMLButtonElement>('[aria-label="Next frame"]');
    expect(nextFrame).toBeTruthy();
    await act(async () => {
      nextFrame?.click();
    });
    await waitFor(() => (canvas?.width ?? 0) >= 1280, 10_000);
    expect(host.textContent ?? '').not.toContain('Subtasks');
  }, 180_000);
});
