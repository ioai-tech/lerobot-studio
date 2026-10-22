import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { useStackedLayout } from '../../src/react/hooks/useStackedLayout';
import { FetchDataSource } from './fixtures';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function waitFor(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) resolve();
      else if (performance.now() - startedAt > timeoutMs) reject(new Error('waitFor timeout'));
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

const HOST_HEIGHT = 600;

describe('browser: embedded layout follows the host container', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await page.viewport(1_280, 800);
    host = document.createElement('div');
    host.style.height = `${HOST_HEIGHT}px`;
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function mount(width: number) {
    host.style.width = `${width}px`;
    await act(async () => {
      root.render(
        <LeRobotViewer
          dataSource={new FetchDataSource('/tests/fixtures/datasets/lerobotv3')}
          language="en"
          showSidebar
          showPlaybackBar
        />,
      );
    });
    await waitFor(() => host.querySelector('[data-testid="lerobot-viewer-layout"]') !== null);
    await waitFor(() => host.querySelector('[role="separator"]') !== null);
    return host.querySelector<HTMLElement>('[data-testid="lerobot-viewer-layout"]')!;
  }

  function separator() {
    return host.querySelector<HTMLElement>('[aria-label="Resize episode list"]')!;
  }

  function sidebar() {
    return host.querySelector<HTMLElement>('[data-testid="lerobot-resizable-sidebar"]')!;
  }

  it('fills the host and keeps the sidebar beside the player at 900px', async () => {
    const layout = await mount(900);
    await waitFor(() => layout.getAttribute('data-layout') === 'split');

    const rootEl = host.firstElementChild as HTMLElement;
    const hostBox = host.getBoundingClientRect();
    const rootBox = rootEl.getBoundingClientRect();
    expect(Math.round(rootBox.width)).toBe(Math.round(hostBox.width));
    expect(Math.round(rootBox.height)).toBe(HOST_HEIGHT);

    expect(sidebar().getAttribute('data-orientation')).toBe('horizontal');
    const sideBox = sidebar().getBoundingClientRect();
    expect(sideBox.height).toBeGreaterThan(HOST_HEIGHT / 2);
    expect(separator().getAttribute('aria-label')).toBe('Resize episode list');
    expect(separator().getAttribute('aria-orientation')).toBe('vertical');
  }, 60_000);

  it('stacks the sidebar below the player under 640px, in DOM order', async () => {
    const layout = await mount(500);
    await waitFor(() => layout.getAttribute('data-layout') === 'stacked');

    const rootEl = host.firstElementChild as HTMLElement;
    expect(Math.round(rootEl.getBoundingClientRect().height)).toBe(HOST_HEIGHT);

    const side = sidebar();
    expect(side.getAttribute('data-orientation')).toBe('vertical');
    const row = side.parentElement!;
    const children = Array.from(row.children);
    const main = children[0] as HTMLElement;
    // Main first, then the handle, then the sidebar: visual and focus order agree.
    expect(children.indexOf(side)).toBe(children.length - 1);
    expect(children.indexOf(separator())).toBe(children.length - 2);
    expect(side.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      main.getBoundingClientRect().bottom - 1,
    );
    expect(Math.round(side.getBoundingClientRect().width)).toBe(500);
    expect(separator().getAttribute('aria-label')).toBe('Resize episode list');
    expect(separator().getAttribute('aria-orientation')).toBe('horizontal');
  }, 60_000);

  it('moves the sidebar without remounting it when the host crosses 640px', async () => {
    const layout = await mount(900);
    await waitFor(() => layout.getAttribute('data-layout') === 'split');
    const before = sidebar();
    before.setAttribute('data-probe', 'kept');

    host.style.width = '390px';
    await waitFor(() => layout.getAttribute('data-layout') === 'stacked');
    expect(sidebar()).toBe(before);
    expect(sidebar().getAttribute('data-probe')).toBe('kept');

    host.style.width = '900px';
    await waitFor(() => layout.getAttribute('data-layout') === 'split');
    expect(sidebar()).toBe(before);
  }, 60_000);

  it('restores the width the user chose after the host narrows and widens again', async () => {
    const layout = await mount(900);
    await waitFor(() => layout.getAttribute('data-layout') === 'split');
    const width = () => Math.round(sidebar().getBoundingClientRect().width);
    await waitFor(() => width() === 256, 5_000);

    // Choose 400px with the keyboard (256 + 9 x 16), waiting out the width transition per step.
    for (let step = 1; step <= 9; step++) {
      await act(async () => {
        separator().focus();
        separator().dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        );
      });
      await waitFor(() => width() === 256 + step * 16, 5_000);
    }
    expect(separator().getAttribute('aria-valuenow')).toBe('400');
    expect(separator().getAttribute('aria-valuemin')).toBe('200');
    expect(separator().getAttribute('aria-valuemax')).toBe('580');

    // A narrower host caps the rendered width (700 - 320) without forgetting the choice.
    host.style.width = '700px';
    await waitFor(() => width() === 380, 5_000);
    expect(separator().getAttribute('aria-valuenow')).toBe('380');

    // Through the stacked layout and back: the chosen 400px returns.
    host.style.width = '390px';
    await waitFor(() => layout.getAttribute('data-layout') === 'stacked');
    host.style.width = '900px';
    await waitFor(() => layout.getAttribute('data-layout') === 'split');
    await waitFor(() => width() === 400, 5_000);
    expect(separator().getAttribute('aria-valuenow')).toBe('400');
  }, 60_000);

  it('stacks dockview panels in one column at 390px and keeps the desktop grid at 1100px', async () => {
    const layout = await mount(390);
    await waitFor(() => layout.getAttribute('data-layout') === 'stacked');
    const dock = () =>
      host.querySelector<HTMLElement>(
        '[data-testid="lerobot-viewer-layout"] [data-layout]:not([data-testid])',
      );
    await waitFor(() => (dock()?.querySelectorAll('.dv-groupview').length ?? 0) >= 3);
    await waitFor(() => dock()?.getAttribute('data-layout') === 'stacked');
    const groups = Array.from(dock()!.querySelectorAll<HTMLElement>('.dv-groupview'));
    const boxes = groups.map((g) => g.getBoundingClientRect());
    // One column: same left edge and width, each group strictly below the previous.
    for (const box of boxes) {
      expect(Math.round(box.left)).toBe(Math.round(boxes[0].left));
      expect(Math.round(box.width)).toBe(Math.round(boxes[0].width));
    }
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].top).toBeGreaterThanOrEqual(boxes[i - 1].bottom - 1);
    }
    expect(boxes[0].width).toBeGreaterThan(300);

    host.style.width = '1100px';
    await waitFor(() => dock()?.getAttribute('data-layout') === 'split');
    await waitFor(() => {
      const tops = Array.from(dock()!.querySelectorAll<HTMLElement>('.dv-groupview')).map((g) =>
        Math.round(g.getBoundingClientRect().top),
      );
      return tops.length >= 3 && new Set(tops).size < tops.length;
    });
  }, 60_000);

  it('loads every video element with crossOrigin="anonymous"', async () => {
    await mount(1100);
    await waitFor(() => host.querySelectorAll('video').length > 0);
    const videos = Array.from(host.querySelectorAll('video'));
    for (const video of videos) {
      expect(video.getAttribute('crossorigin')).toBe('anonymous');
      expect(video.crossOrigin).toBe('anonymous');
    }
  }, 60_000);

  it('resizes the stacked sidebar with the keyboard', async () => {
    const layout = await mount(500);
    await waitFor(() => layout.getAttribute('data-layout') === 'stacked');
    const start = sidebar().getBoundingClientRect().height;
    await act(async () => {
      separator().focus();
      separator().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    await waitFor(() => sidebar().getBoundingClientRect().height > start);
    expect(sidebar().getBoundingClientRect().height).toBeGreaterThan(start);
  }, 60_000);
});

describe('browser: useStackedLayout', () => {
  function Probe() {
    const ref = useRef<HTMLDivElement | null>(null);
    const stacked = useStackedLayout(ref);
    return <div ref={ref} data-layout={stacked ? 'stacked' : 'split'} />;
  }

  it('measures before paint, follows resizes, and disconnects on unmount', async () => {
    const observe = vi.spyOn(ResizeObserver.prototype, 'observe');
    const disconnect = vi.spyOn(ResizeObserver.prototype, 'disconnect');
    const host = document.createElement('div');
    host.style.width = '500px';
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Probe />));
      const probe = host.querySelector('[data-layout]')!;
      expect(probe.getAttribute('data-layout')).toBe('stacked');
      expect(observe).toHaveBeenCalledWith(probe);

      host.style.width = '800px';
      await waitFor(() => probe.getAttribute('data-layout') === 'split');

      const before = disconnect.mock.calls.length;
      await act(async () => root.unmount());
      expect(disconnect.mock.calls.length).toBe(before + 1);
    } finally {
      host.remove();
      observe.mockRestore();
      disconnect.mockRestore();
    }
  });
});
