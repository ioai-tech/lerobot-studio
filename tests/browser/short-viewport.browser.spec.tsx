import React from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { CAMERA_SHARE } from '@/core';
import { type HostLog, seg, selectWithKeys, waitForSegments } from './segmentHarness';
import { Host } from './SegmentHost';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

it('at 1024 × 768 with the segment inspector open the cameras keep their share of the panels (s10 F-31)', async () => {
  await page.viewport(1024, 768);
  const host = document.createElement('div');
  host.style.cssText = 'width:1024px;height:768px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        initial={{ episodes: { 0: { segments: [seg('a', 0, 1), seg('b', 2, 2)] } } }}
      />,
    );
    await waitForSegments(host);
    await selectWithKeys(host, 1);
    const dock = () => host.querySelector<HTMLElement>('.dv-dockview')!.getBoundingClientRect();
    const camera = () =>
      host
        .querySelector('video, canvas[data-image-panel], img')
        ?.closest('.dv-groupview')
        ?.getBoundingClientRect();
    await expect.poll(() => camera()?.height ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    // The compact inspector (F-07) leaves the panels most of the height; in that
    // still-short area the camera row takes its share.
    await expect.poll(() => dock().height, { timeout: 10_000 }).toBeLessThan(560);
    await expect
      .poll(() => (camera()?.height ?? 0) / dock().height, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(CAMERA_SHARE - 0.02);
  } finally {
    root.unmount();
    host.remove();
  }
});
