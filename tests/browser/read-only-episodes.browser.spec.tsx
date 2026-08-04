import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { classifyLeRobotVersion, type EpisodeMetadata, type LeRobotInfo } from '@/core';
import { EpisodeSidebar } from '../../src/react/components/Sidebar/EpisodeSidebar';
import {
  LeRobotDataContext,
  LeRobotSelectionContext,
  type LeRobotDataContextType,
  type LeRobotSelectionContextType,
} from '../../src/react/contexts/LeRobotContext';
import {
  assertEpisodeMutationAllowed,
  createEpisodeTaskEdit,
} from '../../src/react/contexts/versionMutationPolicy';
import { I18nProvider } from '../../src/react/i18n/core';
import { expectNoBlockingA11yViolations } from './a11y';
import '../../src/react/index.css';

const roots: Array<ReturnType<typeof createRoot>> = [];
let stableStyle: HTMLStyleElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  await page.viewport(1_280, 720);
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = 'light';
  stableStyle = document.createElement('style');
  stableStyle.textContent = `
    *, *::before, *::after {
      animation-duration: 0s !important;
      transition-duration: 0s !important;
      caret-color: transparent !important;
    }
    body { margin: 0; font-family: "Geist Variable", sans-serif; }
  `;
  document.head.appendChild(stableStyle);
  await document.fonts.ready;
});

afterEach(async () => {
  await act(async () => {
    roots.splice(0).forEach((root) => root.unmount());
  });
  document.body.innerHTML = '';
  stableStyle.remove();
  document.documentElement.style.removeProperty('color-scheme');
});

describe('read-only future dataset episodes', () => {
  it('blocks mutations and renders no episode edit controls for v3.1', async () => {
    const capability = classifyLeRobotVersion('v3.1');
    expect(capability.status).toBe('read-only');
    expect(() => assertEpisodeMutationAllowed(capability)).toThrow(/mutations are disabled/);
    expect(() => assertEpisodeMutationAllowed(classifyLeRobotVersion('v3.0'))).not.toThrow();
    expect(createEpisodeTaskEdit('place')).toEqual({
      tasks: ['place'],
      task_index: undefined,
    });

    const episodes: EpisodeMetadata[] = Array.from({ length: 1_200 }, (_, index) => ({
      episode_index: index,
      length: 2,
      tasks: [`pick-${index}`],
      dataset_from_index: index * 2,
      dataset_to_index: index * 2 + 2,
    }));
    const dataValue = {
      info: { codebase_version: 'v3.1', fps: 30 } as unknown as LeRobotInfo,
      versionCapability: capability,
      isReadOnly: true,
      episodes,
      tasks: { 0: 'pick' },
      isLoading: false,
      error: null,
    } as unknown as LeRobotDataContextType;
    const selectionValue = {
      selectedEpisodeIndex: 0,
      selectedEpisodeIndices: new Set<number>(),
      deletedEpisodes: new Set<number>(),
      modifiedEpisodes: new Map(),
      getEffectiveEpisode: (value: EpisodeMetadata) => value,
      selectEpisode: vi.fn(),
      toggleEpisodeSelection: vi.fn(),
      selectAllInList: vi.fn(),
      clearEpisodeSelection: vi.fn(),
      editEpisodeTask: vi.fn(),
      deleteEpisode: vi.fn(),
      restoreEpisode: vi.fn(),
    } as unknown as LeRobotSelectionContextType;

    const container = document.createElement('div');
    container.style.width = '320px';
    container.style.height = '480px';
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <I18nProvider forcedLanguage="en">
          <LeRobotDataContext.Provider value={dataValue}>
            <LeRobotSelectionContext.Provider value={selectionValue}>
              <EpisodeSidebar />
            </LeRobotSelectionContext.Provider>
          </LeRobotDataContext.Provider>
        </I18nProvider>,
      );
    });

    expect(container.textContent).toContain('LeRobot v3.1 is opened read-only');
    expect(container.querySelector('[title="Edit episodes"]')).toBeNull();
    expect(container.querySelector('[title="Select"]')).toBeNull();
    expect(container.querySelector('[title="Edit task"]')).toBeNull();
    expect(container.querySelector('[title="Delete episode"]')).toBeNull();
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const renderedRows = container.querySelectorAll('[role="listitem"]');
    expect(container.querySelector('[role="list"]')).toBeTruthy();
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThanOrEqual(20);
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
    await expectNoBlockingA11yViolations(container);
  });
});
