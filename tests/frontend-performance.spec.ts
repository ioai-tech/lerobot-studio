import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EpisodeMetadata } from '../src/core';
import {
  deriveEffectiveEpisodes,
  selectEpisodesForExport,
} from '../src/react/contexts/useEpisodeView';
import {
  PlaybackEngine,
  type PlaybackEngineCallbacks,
} from '../src/react/services/PlaybackEngine';

function reportMetric(name: string, elapsedMs: number, operations: number, budgetMs: number) {
  console.info(
    `[performance] ${name}: ${elapsedMs.toFixed(2)}ms for ${operations.toLocaleString()} operations (budget ${budgetMs}ms)`,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('frontend performance budgets', () => {
  it('derives and filters 1000 episodes without order-of-magnitude regression', () => {
    const episodeCount = 1_000;
    const rounds = 100;
    const budgetMs = 500;
    const episodes: EpisodeMetadata[] = Array.from({ length: episodeCount }, (_, index) => ({
      episode_index: index,
      length: 30 + (index % 300),
      tasks: [`task-${index % 20}`],
    }));
    const deleted = new Set(episodes.filter((_, index) => index % 11 === 0).map((ep) => ep.episode_index));
    const modified = new Map(
      episodes
        .filter((_, index) => index % 13 === 0)
        .map((ep) => [ep.episode_index, { tasks: [`edited-${ep.episode_index}`] }]),
    );
    const selected = new Set(episodes.filter((_, index) => index % 7 === 0).map((ep) => ep.episode_index));

    for (let index = 0; index < 5; index += 1) {
      deriveEffectiveEpisodes(episodes, deleted, modified);
    }

    const startedAt = performance.now();
    let result: EpisodeMetadata[] = [];
    for (let index = 0; index < rounds; index += 1) {
      const effective = deriveEffectiveEpisodes(episodes, deleted, modified);
      result = selectEpisodesForExport(
        effective.filter((episode) => episode.tasks?.[0]?.includes('1')),
        selected,
      );
    }
    const elapsedMs = performance.now() - startedAt;

    reportMetric('episode derivation/filtering', elapsedMs, episodeCount * rounds, budgetMs);
    expect(result.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(budgetMs);
  });

  it('advances high-frequency playback frames within a broad regression budget', () => {
    const iterations = 20_000;
    const budgetMs = 750;
    let frameIndex = 0;
    const notifyFrame = vi.fn();
    let animationFrameId = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => ++animationFrameId));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('window', globalThis);

    const callbacks: PlaybackEngineCallbacks = {
      getFrameIndex: () => frameIndex,
      setFrameIndexSilent: (index) => {
        frameIndex = index;
      },
      notifyFrame,
      getFrameCount: () => 1_000,
      getFps: () => 240,
      getPlaybackSpeed: () => 8,
      getPlaybackMode: () => 'loop',
      getEpisodes: () => [],
      getSelectedEpisodeIndex: () => null,
      getDeletedEpisodes: () => new Set(),
      onStop: vi.fn(),
      onAdvanceEpisode: vi.fn(async () => false),
      onResumeAfterEpisode: vi.fn(),
    };
    const engine = new PlaybackEngine(callbacks);
    engine.start();

    const startedAt = performance.now();
    for (let timestamp = 1; timestamp <= iterations; timestamp += 1) {
      (engine as unknown as { tick: (time: number) => void }).tick(timestamp);
    }
    const elapsedMs = performance.now() - startedAt;
    engine.dispose();

    reportMetric('playback frame advancement', elapsedMs, iterations, budgetMs);
    expect(notifyFrame).toHaveBeenCalledTimes(iterations - 1);
    expect(elapsedMs).toBeLessThan(budgetMs);
  });

  it('cancels both animation and timer resources on dispose', () => {
    const cancelAnimationFrame = vi.fn();
    const clearTimeout = vi.fn();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 41));
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    vi.stubGlobal('clearTimeout', clearTimeout);
    vi.stubGlobal('window', {
      setTimeout: vi.fn(() => 73),
    });

    const engine = new PlaybackEngine({
      getFrameIndex: () => 0,
      setFrameIndexSilent: vi.fn(),
      notifyFrame: vi.fn(),
      getFrameCount: () => 10,
      getFps: () => 1,
      getPlaybackSpeed: () => 1,
      getPlaybackMode: () => 'loop',
      getEpisodes: () => [],
      getSelectedEpisodeIndex: () => null,
      getDeletedEpisodes: () => new Set(),
      onStop: vi.fn(),
      onAdvanceEpisode: vi.fn(async () => false),
      onResumeAfterEpisode: vi.fn(),
    });

    engine.start();
    (engine as unknown as { tick: (time: number) => void }).tick(1);
    engine.dispose();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);
    expect(clearTimeout).toHaveBeenCalledWith(73);
  });
});
