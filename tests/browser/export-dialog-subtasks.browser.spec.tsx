import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { classifyLeRobotVersion, type EpisodeMetadata, type LeRobotInfo } from '@/core';
import { ExportDialog } from '../../src/react/components/dialogs/ExportDialog';
import {
  LeRobotDataContext,
  LeRobotSelectionContext,
  LeRobotSubtaskContext,
  type LeRobotDataContextType,
  type LeRobotSelectionContextType,
  type LeRobotSubtaskContextType,
} from '../../src/react/contexts/LeRobotContext';
import { I18nProvider } from '../../src/react/i18n/core';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
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

function renderExportDialog(language: 'en' | 'zh') {
  const capability = classifyLeRobotVersion('v3.0');
  const dataValue = {
    info: { codebase_version: 'v3.0', fps: 10 } as unknown as LeRobotInfo,
    versionCapability: capability,
    isReadOnly: false,
    dataLoader: {
      getVersionCapability: () => capability,
    },
    tasks: { 0: 'pick' },
    subtasks: {},
    isLoading: false,
    error: null,
  } as unknown as LeRobotDataContextType;
  const selectionValue = {
    episodesForExport: [
      { episode_index: 0, length: 3, tasks: ['pick'] },
      { episode_index: 1, length: 3, tasks: ['pick'] },
      { episode_index: 2, length: 57, tasks: ['pick'] },
    ] as EpisodeMetadata[],
    modifiedEpisodes: new Map(),
    deletedEpisodes: new Set<number>(),
  } as unknown as LeRobotSelectionContextType;
  const subtaskValue = {
    overlay: new Map(),
  } as unknown as LeRobotSubtaskContextType;

  return (
    <I18nProvider forcedLanguage={language}>
      <LeRobotDataContext.Provider value={dataValue}>
        <LeRobotSelectionContext.Provider value={selectionValue}>
          <LeRobotSubtaskContext.Provider value={subtaskValue}>
            <ExportDialog open onOpenChange={vi.fn()} />
          </LeRobotSubtaskContext.Provider>
        </LeRobotSelectionContext.Provider>
      </LeRobotDataContext.Provider>
    </I18nProvider>
  );
}

describe('browser: export dialog subtasks option', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await page.viewport(1_280, 720);
    host = document.createElement('div');
    host.id = 'lerobot-root';
    host.className = 'lerobot-root';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
    document.querySelectorAll('[data-slot="dialog-portal"]').forEach((node) => node.remove());
  });

  it('defaults include-subtasks off and only shows coverage hint when checked', async () => {
    await act(async () => {
      root.render(renderExportDialog('en'));
    });
    await waitFor(() => document.body.textContent?.includes('Include subtasks') ?? false);

    const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!;
    const checkbox = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(false);
    expect(dialog.textContent).not.toContain('Every exported episode must be fully labeled.');

    await act(async () => {
      checkbox.click();
    });
    await waitFor(
      () => dialog.textContent?.includes('Every exported episode must be fully labeled.') ?? false,
    );
    expect(checkbox.checked).toBe(true);

    const v21 = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent === 'v2.1',
    );
    expect(v21).toBeTruthy();
    await act(async () => {
      v21?.click();
    });
    await waitFor(() => dialog.querySelector('input[type="checkbox"]') == null);
    expect(dialog.textContent).not.toContain('Include subtasks');
  });

  it('shows the Chinese include-subtasks label', async () => {
    await act(async () => {
      root.render(renderExportDialog('zh'));
    });
    await waitFor(() => document.body.textContent?.includes('包含子任务') ?? false);
    const checkbox = document.querySelector<HTMLInputElement>(
      '[data-slot="dialog-content"] input[type="checkbox"]',
    );
    expect(checkbox?.checked).toBe(false);
  });
});
