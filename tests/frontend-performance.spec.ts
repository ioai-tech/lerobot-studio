import { describe, expect, it, vi } from 'vitest';
import type { EpisodeMetadata } from '../src/core';
import {
  deriveEffectiveEpisodes,
  selectEpisodesForExport,
} from '../src/react/contexts/useEpisodeView';
import { PlaybackEngine, type PlaybackEngineCallbacks } from '../src/react/services/PlaybackEngine';
import { PlaybackClock } from '../src/react/services/PlaybackClock';

function reportMetric(name: string, elapsedMs: number, operations: number, budgetMs: number) {
  process.stdout.write(
    `[performance] ${name}: ${elapsedMs.toFixed(2)}ms for ${operations.toLocaleString()} operations (budget ${budgetMs}ms)\n`,
  );
}

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
    const deleted = new Set(
      episodes.filter((_, index) => index % 11 === 0).map((ep) => ep.episode_index),
    );
    const modified = new Map(
      episodes
        .filter((_, index) => index % 13 === 0)
        .map((ep) => [ep.episode_index, { tasks: [`edited-${ep.episode_index}`] }]),
    );
    const selected = new Set(
      episodes.filter((_, index) => index % 7 === 0).map((ep) => ep.episode_index),
    );

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
    let wall = 0;
    const notifyFrame = vi.fn();
    let animationFrameId = 0;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => ++animationFrameId),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

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
    const engine = new PlaybackEngine(callbacks, new PlaybackClock(() => wall));
    engine.start();

    // One source frame of wall time per animation frame (240 fps at 8x).
    const frameMs = 1000 / (240 * 8);
    const startedAt = performance.now();
    for (let tick = 1; tick <= iterations; tick += 1) {
      wall = tick * frameMs + frameMs / 2;
      (engine as unknown as { tick: () => void }).tick();
    }
    const elapsedMs = performance.now() - startedAt;
    engine.dispose();

    reportMetric('playback frame advancement', elapsedMs, iterations, budgetMs);
    expect(notifyFrame.mock.calls.length).toBeGreaterThanOrEqual(iterations - 1);
    expect(elapsedMs).toBeLessThan(budgetMs);
  });

  it('cancels the animation frame on dispose', () => {
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 41),
    );
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);

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
    engine.dispose();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);
    expect(engine.clock.isPlaying).toBe(false);
  });
});
