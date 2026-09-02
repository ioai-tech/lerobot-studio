import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from '@/core';
import {
  detectPlatformCapabilities,
  RemoteManifestDataSource,
  resolveDroppedItem,
} from '@/platform';
import { LeRobotViewer, type LeRobotViewerError } from '@/components/LeRobotViewer';
import { expectNoBlockingA11yViolations } from './a11y';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
      } else if (performance.now() - startedAt > timeoutMs) {
        reject(new Error('waitFor timeout'));
      } else {
        requestAnimationFrame(tick);
      }
    };
    tick();
  });
}

function currentEngine(): 'chromium' | 'firefox' | 'webkit' {
  if (navigator.userAgent.includes('Firefox/')) return 'firefox';
  if (navigator.userAgent.includes('AppleWebKit/') && !navigator.userAgent.includes('Chrome/')) {
    return 'webkit';
  }
  return 'chromium';
}

describe('browser compatibility smoke', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.height = '480px';
    host.style.width = '720px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('reports unavailable browser capabilities as explicit fallbacks', () => {
    const capabilities = detectPlatformCapabilities();
    const hasFileSystemAccess = window.isSecureContext && 'showDirectoryPicker' in window;
    const hasWebCodecs = 'VideoDecoder' in window && 'VideoEncoder' in window;

    expect(capabilities.isReactNative).toBe(false);
    expect(capabilities.supportsFileSystemAccess).toBe(hasFileSystemAccess);
    expect(capabilities.supportsWebCodecs).toBe(hasWebCodecs);
    expect(capabilities.supportedExportFormats).toContain('zip');

    if (!hasFileSystemAccess) {
      expect(capabilities.supportedExportFormats).toEqual(['zip']);
      expect(capabilities.supportedExportFormats).not.toContain('directory');
    }
    if (!hasWebCodecs) {
      expect(capabilities.supportsWebCodecs).toBe(false);
    }

    if (currentEngine() !== 'chromium') {
      expect(hasFileSystemAccess).toBe(false);
      expect(capabilities.supportedExportFormats).toEqual(['zip']);
    }
  });

  it('reads same-origin remote manifest entries without Chromium-only APIs', async () => {
    const url = new URL(
      '/tests/fixtures/datasets/lerobotv3/meta/info.json',
      window.location.href,
    ).toString();
    const source = new RemoteManifestDataSource([
      { logicalPath: 'meta/info.json', presignedUrl: url },
    ]);

    expect(await source.exists('meta/info.json')).toBe(true);
    expect(await source.exists('meta/missing.json')).toBe(false);
    const info = JSON.parse(await source.readText('meta/info.json')) as {
      codebase_version?: string;
    };
    expect(info.codebase_version).toBe('v3.0');
    expect(await source.getObjectUrl('meta/info.json')).toBe(url);
  });

  it('resolves legacy dropped directory entries without File System Access API', async () => {
    const info = new File(['{}'], 'info.json');
    const root = {
      isFile: false,
      isDirectory: true,
      name: 'dataset',
      createReader: () => {
        let read = false;
        return {
          readEntries: (success: (entries: unknown[]) => void) => {
            if (read) success([]);
            else {
              read = true;
              success([
                {
                  isFile: true,
                  isDirectory: false,
                  name: 'info.json',
                  file: (resolve: (file: File) => void) => resolve(info),
                },
              ]);
            }
          },
        };
      },
    };
    const dataTransfer = {
      items: [
        {
          kind: 'file',
          webkitGetAsEntry: () => root,
          getAsFile: () => null,
        },
      ],
      files: [],
    } as unknown as DataTransfer;

    await expect(resolveDroppedItem(dataTransfer)).resolves.toMatchObject({
      kind: 'directory-files',
      files: [{ file: info, path: 'dataset/info.json' }],
    });
  });

  it('renders the Viewer contract and reports custom DataSource failures', async () => {
    const failure = new Error('compat custom source failure');
    const source: DataSource = {
      exists: async () => true,
      readText: async () => {
        throw failure;
      },
      readBytes: async () => {
        throw failure;
      },
      getObjectUrl: async () => {
        throw failure;
      },
      clear: () => undefined,
    };
    const errors: LeRobotViewerError[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await act(async () => {
      root.render(
        <LeRobotViewer
          dataSource={source}
          language="en"
          showSidebar={false}
          showPlaybackBar={false}
          onFatalError={(error) => errors.push(error)}
        />,
      );
    });
    expect(host.querySelector('.lerobot-root')).not.toBeNull();

    await waitFor(() => errors.length > 0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 'DATASET_LOAD_FAILED',
      recoverable: true,
    });
    expect(errors[0]?.message).toContain(failure.message);
  });

  it('renders an accessible fatal error state with assertive announcement', async () => {
    const failure = new Error('accessible viewer failure');
    const source: DataSource = {
      exists: async () => true,
      readText: async () => {
        throw failure;
      },
      readBytes: async () => {
        throw failure;
      },
      getObjectUrl: async () => {
        throw failure;
      },
      clear: () => undefined,
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await act(async () => {
      root.render(
        <LeRobotViewer
          dataSource={source}
          language="en"
          showSidebar={false}
          showPlaybackBar={false}
        />,
      );
    });

    await waitFor(() => Boolean(host.querySelector('[role="alert"]')));
    const alert = host.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(alert.textContent).toContain(failure.message);
    expect(alert.querySelector<HTMLElement>('[class*="motion-reduce:animate-none"]')).toBeNull();
    await expectNoBlockingA11yViolations(host);
  });

  it('announces loading politely and disables its spinner for reduced motion', async () => {
    const source: DataSource = {
      exists: () => new Promise<boolean>(() => undefined),
      readText: () => new Promise<string>(() => undefined),
      readBytes: () => new Promise<Uint8Array>(() => undefined),
      getObjectUrl: () => new Promise<string>(() => undefined),
      clear: () => undefined,
    };

    await act(async () => {
      root.render(
        <LeRobotViewer
          dataSource={source}
          language="en"
          showSidebar={false}
          showPlaybackBar={false}
        />,
      );
    });

    await waitFor(() => Boolean(host.querySelector('[role="status"]')));
    const status = host.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(
      status.querySelector<HTMLElement>('[class*="motion-reduce:animate-none"]'),
    ).not.toBeNull();
  });
});
