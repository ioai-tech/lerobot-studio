import React from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { ProgressHandler } from '@/platform';
import { FetchDataSource } from './fixtures';
import { type HostLog, seg, selectWithKeys, waitForSegments } from './segmentHarness';
import { Host } from './SegmentHost';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const V2_FIXTURE = '/tests/fixtures/datasets/lerobotv2';
const CAMERAS = ['head_left', 'head_right', 'wrist_left', 'wrist_right'];
const SOURCE_CAMERA = 'observation.images.cam';

/**
 * The v2 fixture declared as four 640 × 480 cameras (every one plays the
 * fixture's video), like the four-camera recordings of the walk.
 */
class FourCameraSource extends FetchDataSource {
  constructor() {
    super(V2_FIXTURE);
  }

  private real(relativePath: string): string {
    return CAMERAS.reduce(
      (path, camera) => path.replace(`/observation.images.${camera}/`, `/${SOURCE_CAMERA}/`),
      relativePath,
    );
  }

  override async readText(relativePath: string, onProgress?: ProgressHandler): Promise<string> {
    const text = await super.readText(relativePath, onProgress);
    if (!relativePath.endsWith('meta/info.json')) return text;
    const info = JSON.parse(text) as { features: Record<string, unknown> };
    const camera = info.features[SOURCE_CAMERA] as Record<string, unknown>;
    delete info.features[SOURCE_CAMERA];
    for (const name of CAMERAS) {
      info.features[`observation.images.${name}`] = {
        ...camera,
        shape: [3, 480, 640],
        names: ['channels', 'height', 'width'],
      };
    }
    return JSON.stringify(info);
  }

  override exists(relativePath: string) {
    return super.exists(this.real(relativePath));
  }

  override readBytes(relativePath: string, onProgress?: ProgressHandler) {
    return super.readBytes(this.real(relativePath), onProgress);
  }

  override getObjectUrl(relativePath: string) {
    return super.getObjectUrl(this.real(relativePath));
  }
}

it('F-07: at 1024 × 768 with an episode selected the cameras, chart and one-row action bar all fit', async () => {
  await page.viewport(1024, 768);
  // The console's own chrome (a 68 px rail and a 56 px header) around the viewer.
  const host = document.createElement('div');
  host.style.cssText = 'width:956px;height:712px;margin:56px 0 0 68px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(
      <Host
        log={log}
        dataSource={new FourCameraSource()}
        fields={[
          {
            id: 'outcome',
            label: 'Outcome',
            kind: 'select',
            options: [
              { value: 'success', label: 'Success', key: '1' },
              { value: 'failure', label: 'Failure', key: '2' },
              { value: 'partial', label: 'Partial', key: '3' },
            ],
          },
          { id: 'tags', label: 'Tags', kind: 'tags' },
          { id: 'task_other', label: 'Task (中文)', kind: 'text' },
        ]}
        initial={{
          episodes: {
            0: {
              segments: [
                seg('a', 0, 1, { task: 'Fold the white towel and place it into the basket' }),
                seg('b', 2, 2),
              ],
            },
          },
        }}
      />,
    );
    await waitForSegments(host);
    await selectWithKeys(host, 1);

    const box = (element: Element | null | undefined) => element?.getBoundingClientRect();
    const cameras = () =>
      Array.from(host.querySelectorAll('.dv-groupview')).filter((group) =>
        group.querySelector('video, canvas[data-image-panel], img'),
      );
    await expect.poll(() => cameras().length, { timeout: 30_000 }).toBe(4);
    const inspector = host.querySelector<HTMLElement>('[data-testid="lerobot-segment-inspector"]')!;
    await new Promise((resolve) => setTimeout(resolve, 300));

    // The action bar is one row: every control on the same line.
    // The row that holds Previous / Next (its own test id since F-07).
    const actions = inspector.querySelector('button[title^="Next ("]')!.parentElement!;

    const controls = Array.from(actions.querySelectorAll<HTMLElement>('button')).filter(
      (button) => button.offsetParent !== null,
    );
    expect(controls.length).toBeGreaterThanOrEqual(8);
    const tops = new Set(controls.map((button) => Math.round(box(button)!.top / 4)));
    expect(tops.size, 'action rows').toBe(1);
    // The details stay short, so the panels keep their room.
    expect(box(inspector)!.height).toBeLessThan(180);

    // Each camera keeps a usable frame and the chart shows a plot, not just its header.
    await expect
      .poll(() => Math.min(...cameras().map((group) => box(group)!.height)), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(140);
    for (const group of cameras()) expect(box(group)!.width).toBeGreaterThanOrEqual(170);
    const chart = Array.from(host.querySelectorAll('.dv-groupview')).find((group) =>
      group.textContent?.includes('All Series'),
    );
    expect(box(chart)?.height ?? 0, 'chart panel').toBeGreaterThanOrEqual(150);
    expect(inspector.hasAttribute('data-compact')).toBe(true);

    // What folded into More is still there, each action with its key.
    await userEvent.click(page.getByRole('button', { name: 'More actions' }));
    for (const name of ['Set in', 'Set out', 'Edge −1 frame', 'Next uncovered', 'Undo', 'Keys']) {
      await expect.element(page.getByRole('menuitem', { name: new RegExp(name) })).toBeVisible();
    }
    await userEvent.click(page.getByRole('menuitem', { name: /Set out/ }));
    await expect.poll(() => log.changes.at(-1)?.op).toBe('update');
    await page.screenshot({ path: '../../temp/narrow-review-layout-1024.png' });
  } finally {
    root.unmount();
    host.remove();
  }
});

it('F-07: at 1440 × 900 the details keep every action with its label and key', async () => {
  await page.viewport(1440, 900);
  const host = document.createElement('div');
  host.style.cssText = 'width:1372px;height:844px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    const log: HostLog = { changes: [], value: () => ({ episodes: {} }) };
    root.render(<Host log={log} initial={{ episodes: { 0: { segments: [seg('a', 0, 1)] } } }} />);
    await waitForSegments(host);
    await selectWithKeys(host, 1);
    const inspector = host.querySelector<HTMLElement>('[data-testid="lerobot-segment-inspector"]')!;
    expect(inspector.hasAttribute('data-compact')).toBe(false);
    await expect.element(page.getByRole('button', { name: /Set in/ })).toBeVisible();
    expect(page.getByRole('button', { name: 'More actions' }).elements()).toHaveLength(0);
  } finally {
    root.unmount();
    host.remove();
  }
});
