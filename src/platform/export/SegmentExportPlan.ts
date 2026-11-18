import type { EpisodeMetadata, EpisodeTrimRange, ExportSegment, SubtaskSegment } from '@/core';
import type { LeRobotDataLoader } from '../services/LeRobotDataLoader';

/** What the exporters read from a dataset. */
export type ExportDataLoader = Pick<
  LeRobotDataLoader,
  | 'getEpisodeTableForExport'
  | 'getEpisodeVideoPath'
  | 'readFileBytes'
  | 'loadFeatureData'
  | 'loadEpisodeSubtaskSource'
  | 'loadEpisodeSubtaskIndices'
  | 'getSubtasks'
>;

/**
 * Every output episode of an export. A source episode without segments is
 * one unit (the whole episode); each segment is one unit. Units get unique
 * keys that the exporters use as `episode_index` while they work; the
 * exported dataset is renumbered 0..n-1 as always.
 */
export interface SegmentExportPlan {
  /** Output episodes in export order; `episode_index` is the unit key. */
  episodes: EpisodeMetadata[];
  /** Reads a unit key from its source episode. */
  loader: ExportDataLoader;
  /** Unit key → source range, for segment units. */
  trimRanges: Map<number, EpisodeTrimRange>;
  /** Unit key → subtasks (source frames), for segment units. */
  subtasks: Map<number, SubtaskSegment[]>;
  sourceIndexOf: (key: number) => number;
  segmentIdOf: (key: number) => string | undefined;
  /** True when at least one source episode has segments. */
  expanded: boolean;
}

function hasTypedValue(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value != null;
}

function checkSegments(episode: EpisodeMetadata, segments: readonly ExportSegment[]): void {
  let previousEnd = -1;
  for (const segment of segments) {
    if (
      !Number.isSafeInteger(segment.startFrame) ||
      !Number.isSafeInteger(segment.endFrame) ||
      segment.startFrame < 0 ||
      segment.endFrame < segment.startFrame ||
      segment.endFrame >= episode.length
    ) {
      throw new Error(
        `Segment ${segment.startFrame}–${segment.endFrame} is outside episode ${episode.episode_index} (${episode.length} frames)`,
      );
    }
    if (segment.startFrame <= previousEnd) {
      throw new Error(`Segments of episode ${episode.episode_index} overlap or are out of order`);
    }
    previousEnd = segment.endFrame;
  }
}

export function buildSegmentExportPlan(
  loader: ExportDataLoader,
  episodes: readonly EpisodeMetadata[],
  segments?: ReadonlyMap<number, readonly ExportSegment[]>,
): SegmentExportPlan {
  const sourceByKey = new Map<number, number>();
  const segmentByKey = new Map<number, string>();
  const trimRanges = new Map<number, EpisodeTrimRange>();
  const subtasks = new Map<number, SubtaskSegment[]>();
  const units: Array<{ key: number; episode: EpisodeMetadata; segment?: ExportSegment }> = [];
  let nextKey = episodes.reduce((max, episode) => Math.max(max, episode.episode_index), -1) + 1;
  let expanded = false;

  for (const episode of episodes) {
    const list = segments?.get(episode.episode_index) ?? [];
    if (list.length === 0) {
      sourceByKey.set(episode.episode_index, episode.episode_index);
      units.push({ key: episode.episode_index, episode });
      continue;
    }
    checkSegments(episode, list);
    expanded = true;
    list.forEach((segment, position) => {
      const key = position === 0 ? episode.episode_index : nextKey++;
      sourceByKey.set(key, episode.episode_index);
      segmentByKey.set(key, segment.id);
      trimRanges.set(key, { startFrame: segment.startFrame, endFrame: segment.endFrame });
      subtasks.set(
        key,
        segment.subtasks.map((subtask) => ({ ...subtask })),
      );
      units.push({ key, episode, segment });
    });
  }

  const columns = new Set<string>();
  for (const unit of units) {
    for (const [column, value] of Object.entries(unit.segment?.columns ?? {})) {
      if (hasTypedValue(value)) columns.add(column);
    }
  }

  const output = units.map(({ key, episode, segment }): EpisodeMetadata => {
    const extra: Record<string, unknown> = {};
    for (const column of columns) extra[column] = segment?.columns[column] ?? null;
    return {
      ...episode,
      episode_index: key,
      ...(segment?.task != null ? { tasks: [segment.task], task_index: undefined } : {}),
      ...extra,
    } as EpisodeMetadata;
  });

  const sourceIndexOf = (key: number): number => {
    const source = sourceByKey.get(key);
    if (source === undefined) throw new Error(`Unknown export episode ${key}`);
    return source;
  };

  const mapped: ExportDataLoader = {
    getEpisodeTableForExport: (key) => loader.getEpisodeTableForExport(sourceIndexOf(key)),
    getEpisodeVideoPath: (key, feature) => loader.getEpisodeVideoPath(sourceIndexOf(key), feature),
    readFileBytes: (path) => loader.readFileBytes(path),
    loadFeatureData: (key, features) => loader.loadFeatureData(sourceIndexOf(key), features),
    loadEpisodeSubtaskSource: (key) => loader.loadEpisodeSubtaskSource(sourceIndexOf(key)),
    loadEpisodeSubtaskIndices: (key) => loader.loadEpisodeSubtaskIndices(sourceIndexOf(key)),
    getSubtasks: () => loader.getSubtasks(),
  };

  return {
    episodes: output,
    loader: expanded ? mapped : loader,
    trimRanges,
    subtasks,
    sourceIndexOf,
    segmentIdOf: (key) => segmentByKey.get(key),
    expanded,
  };
}
