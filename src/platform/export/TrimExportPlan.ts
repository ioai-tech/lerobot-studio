import * as arrow from 'apache-arrow';
import { validateEpisodeTrim, type EpisodeTrimRange, type EpisodeMetadata } from '@/core';
import type { LeRobotDataLoader } from '../services/LeRobotDataLoader';

export interface ExportTrim extends EpisodeTrimRange {
  fromSec: number;
  toSec: number;
  sourceLength: number;
}

export async function buildTrimExportPlan(
  loader: LeRobotDataLoader,
  episodes: EpisodeMetadata[],
  requested: ReadonlyMap<number, EpisodeTrimRange> | undefined,
  fps: number,
  signal?: AbortSignal,
) {
  const ranges = new Map<number, ExportTrim>();
  for (const episode of episodes) {
    signal?.throwIfAborted();
    const range = requested?.get(episode.episode_index);
    if (!range) continue;
    validateEpisodeTrim(range, episode.length);
    if (range.startFrame === 0 && range.endFrame === episode.length - 1) continue;
    if (!Number.isFinite(fps) || fps <= 0)
      throw new Error('Trimming requires a positive dataset FPS');
    const { table } = await loader.getEpisodeTableForExport(episode.episode_index);
    if (table.numRows !== episode.length)
      throw new Error(`Episode ${episode.episode_index} row count does not match metadata`);
    const timestamps = table.getChild('timestamp');
    if (!timestamps || !table.getChild('frame_index'))
      throw new Error('Trimming requires timestamp and frame_index columns');
    // Playback and image encoding use a fixed frame rate. Reject incompatible
    // timelines instead of exporting silently misaligned video and actions.
    for (let row = range.startFrame; row <= range.endFrame; row++) {
      const raw = timestamps.get(row);
      const time = Number(raw);
      if (raw == null || !Number.isFinite(time) || Math.abs(time - row / fps) > 1e-4) {
        throw new Error(
          `Episode ${episode.episode_index} timestamp at frame ${row} does not match its FPS`,
        );
      }
    }
    ranges.set(episode.episode_index, {
      ...range,
      sourceLength: episode.length,
      fromSec: range.startFrame / fps,
      toSec: (range.endFrame + 1) / fps,
    });
  }
  const outputEpisodes =
    ranges.size === 0
      ? episodes
      : episodes.map((episode) => ({
          ...episode,
          length: ranges.has(episode.episode_index)
            ? ranges.get(episode.episode_index)!.endFrame -
              ranges.get(episode.episode_index)!.startFrame +
              1
            : episode.length,
        }));
  const dataLoader =
    ranges.size === 0
      ? loader
      : {
          async getEpisodeTableForExport(index: number) {
            const source = await loader.getEpisodeTableForExport(index);
            const range = ranges.get(index);
            if (!range) return source;
            if (source.table.numRows !== range.sourceLength)
              throw new Error(`Episode ${index} changed during export`);
            const table = source.table.slice(range.startFrame, range.endFrame + 1);
            const timestamps = table.getChild('timestamp')!;
            const first = Number(timestamps.get(0));
            return {
              ...source,
              table: table.assign(
                new arrow.Table({
                  frame_index: arrow.vectorFromArray(
                    Array.from({ length: table.numRows }, (_, row) => BigInt(row)),
                    new arrow.Int64(),
                  ),
                  timestamp: arrow.vectorFromArray(
                    Array.from(
                      { length: table.numRows },
                      (_, row) => Number(timestamps.get(row)) - first,
                    ),
                    timestamps.type,
                  ),
                }),
              ),
            };
          },
        };
  return { ranges, episodes: outputEpisodes, dataLoader };
}
