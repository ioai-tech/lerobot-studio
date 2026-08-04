import React, { useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { EpisodeMetadata } from '@/core';
import { ErrorFallback } from '@/components/ErrorBoundary';
import { ErrorState } from '@/components/Commons/ErrorState';
import { PanelErrorFallback } from '@/components/panels/Common/PanelErrorBoundary';
import { EpisodeList, type EpisodeListItem } from '@/components/Sidebar/episodes/EpisodeList';
import { LeRobotDataContext, type LeRobotDataContextType } from '@/contexts/LeRobotContext';
import { I18nProvider, reportIntlError } from '@/i18n/core';
import { expectNoBlockingA11yViolations } from './a11y';
import '../../src/react/index.css';

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
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

describe('browser: frontend experience safeguards', () => {
  let host: HTMLDivElement;
  let root: Root;
  let stableStyle: HTMLStyleElement;

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
    host = document.createElement('div');
    host.style.height = '240px';
    host.style.width = '320px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    host.remove();
    stableStyle.remove();
    document.documentElement.style.removeProperty('color-scheme');
    vi.restoreAllMocks();
  });

  it('localizes reusable error fallbacks without claiming notification', async () => {
    root.render(
      <I18nProvider forcedLanguage="zh">
        <ErrorFallback error={new Error('boom')} onReset={() => undefined} />
        <PanelErrorFallback
          error={new Error('panel boom')}
          panelName="Video"
          onRetry={() => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() => host.textContent?.includes('应用出现错误') ?? false);
    expect(host.textContent).toContain('Video 加载失败');
    expect(host.textContent).not.toContain('已通知');
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(2);
    await expectNoBlockingA11yViolations(host);
  });

  it('keeps the viewer error state within a fixed narrow viewport contract', async () => {
    const reset = vi.fn(async () => undefined);
    const dataValue = { reset } as unknown as LeRobotDataContextType;

    root.render(
      <I18nProvider forcedLanguage="en">
        <LeRobotDataContext.Provider value={dataValue}>
          <ErrorState
            title="Dataset unavailable"
            message="The dataset could not be loaded."
            errorDetail="Request failed without exposing a local stack."
            onRetry={() => undefined}
          />
        </LeRobotDataContext.Provider>
      </I18nProvider>,
    );

    await waitFor(() => host.querySelector('[role="alert"]') !== null);
    const alert = host.querySelector<HTMLElement>('[role="alert"]')!;
    const details = alert.querySelector<HTMLElement>('pre')!;
    const hostRect = host.getBoundingClientRect();
    const alertRect = alert.getBoundingClientRect();

    expect(alertRect.width).toBeLessThanOrEqual(hostRect.width);
    expect(alert.scrollWidth).toBeLessThanOrEqual(alert.clientWidth);
    expect(details.scrollWidth).toBeLessThanOrEqual(details.clientWidth);
    expect(alert.querySelectorAll('button')).toHaveLength(3);
    expect(alert.querySelector('[aria-label="Copy"]')).toBeTruthy();
    await expectNoBlockingA11yViolations(host);
  });

  it('reports intl errors only in development mode', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('missing message');

    reportIntlError(error, false);
    expect(consoleError).not.toHaveBeenCalled();

    reportIntlError(error, true);
    expect(consoleError).toHaveBeenCalledWith('[i18n] react-intl formatting error:', error);
  });

  it('virtualizes 1000+ episodes and keeps remote rows interactive after scrolling', async () => {
    const episodeCount = 1_200;
    const remoteEpisodeIndex = 1_000;
    const sourceRows: EpisodeListItem[] = Array.from({ length: episodeCount }, (_, index) => ({
      episode: { episode_index: index, length: 30 } as EpisodeMetadata,
      taskDescription: `Task ${index}`,
      formattedDuration: '00:01',
      isDeleted: false,
      isSelected: false,
      isChecked: false,
    }));
    const onRowClick = vi.fn();

    function Harness() {
      const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
      const rows = useMemo(
        () =>
          sourceRows.map((row) => ({
            ...row,
            isSelected: row.episode.episode_index === selectedIndex,
          })),
        [selectedIndex],
      );

      return (
        <EpisodeList
          error={null}
          episodes={rows.map((row) => row.episode)}
          filteredEpisodes={rows}
          isLoading={false}
          multiSelectMode={false}
          editMode={false}
          onRowClick={(episode) => {
            onRowClick(episode);
            setSelectedIndex(episode.episode_index);
          }}
          onToggleSelection={() => undefined}
          onEdit={() => undefined}
          onDelete={() => undefined}
          onRestore={() => undefined}
        />
      );
    }

    root.render(
      <I18nProvider forcedLanguage="en">
        <Harness />
      </I18nProvider>,
    );

    await waitFor(() => host.querySelector('[role="list"]') !== null);
    let renderedRows = host.querySelectorAll('[role="listitem"]');
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThanOrEqual(20);
    expect(renderedRows.length).toBeLessThan(episodeCount / 10);

    const firstButton = host.querySelector<HTMLElement>('[role="listitem"] [role="button"]');
    expect(firstButton?.tabIndex).toBe(0);
    firstButton?.focus();
    expect(document.activeElement).toBe(firstButton);
    firstButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => firstButton?.getAttribute('aria-current') === 'true');
    expect(onRowClick).toHaveBeenCalledWith(sourceRows[0].episode);

    const virtualList = host.querySelector<HTMLElement>('[role="list"]')!;
    virtualList.scrollTop = remoteEpisodeIndex * 61;
    virtualList.dispatchEvent(new Event('scroll', { bubbles: true }));
    const findRemoteButton = () =>
      Array.from(host.querySelectorAll<HTMLElement>('[role="listitem"]'))
        .find((item) => item.textContent?.includes(`Task ${remoteEpisodeIndex}`))
        ?.querySelector<HTMLElement>('[role="button"]') ?? null;
    await waitFor(() => findRemoteButton() !== null, 5_000);

    renderedRows = host.querySelectorAll('[role="listitem"]');
    expect(renderedRows.length).toBeLessThanOrEqual(20);
    expect(host.querySelector('[aria-label="Select episode 0"]')).toBeNull();

    const remoteButton = findRemoteButton();
    expect(remoteButton).toBeTruthy();
    remoteButton!.focus();
    remoteButton!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => remoteButton!.getAttribute('aria-current') === 'true');
    expect(onRowClick).toHaveBeenLastCalledWith(sourceRows[remoteEpisodeIndex].episode);
    expect(document.activeElement).toBe(remoteButton);
    await expectNoBlockingA11yViolations(host);
  });
});
