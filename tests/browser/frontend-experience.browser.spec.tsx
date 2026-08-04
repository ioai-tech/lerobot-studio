import React, { useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EpisodeMetadata } from '@/core';
import { ErrorFallback } from '@/components/ErrorBoundary';
import { PanelErrorFallback } from '@/components/panels/Common/PanelErrorBoundary';
import {
  EpisodeList,
  type EpisodeListItem,
} from '@/components/Sidebar/episodes/EpisodeList';
import { I18nProvider, reportIntlError } from '@/i18n/core';
import { expectNoBlockingA11yViolations } from './a11y';

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

  beforeEach(() => {
    host = document.createElement('div');
    host.style.height = '240px';
    host.style.width = '320px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    host.remove();
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
    const sourceRows: EpisodeListItem[] = Array.from(
      { length: episodeCount },
      (_, index) => ({
        episode: { episode_index: index, length: 30 } as EpisodeMetadata,
        taskDescription: `Task ${index}`,
        formattedDuration: '00:01',
        isDeleted: false,
        isSelected: false,
        isChecked: false,
      }),
    );
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
    await waitFor(
      () =>
        host.querySelector(`[aria-label="Select episode ${remoteEpisodeIndex}"]`) !== null,
      5_000,
    );

    renderedRows = host.querySelectorAll('[role="listitem"]');
    expect(renderedRows.length).toBeLessThanOrEqual(20);
    expect(host.querySelector('[aria-label="Select episode 0"]')).toBeNull();

    const remoteButton = host.querySelector<HTMLElement>(
      `[aria-label="Select episode ${remoteEpisodeIndex}"]`,
    );
    expect(remoteButton).toBeTruthy();
    remoteButton!.focus();
    remoteButton!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => remoteButton!.getAttribute('aria-current') === 'true');
    expect(onRowClick).toHaveBeenLastCalledWith(sourceRows[remoteEpisodeIndex].episode);
    expect(document.activeElement).toBe(remoteButton);
    await expectNoBlockingA11yViolations(host);
  });
});
