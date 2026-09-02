import {
  SubtaskCoverageError,
  type SubtaskCoverage,
  type SubtaskSegment,
  type SubtaskTable,
} from './types';

export function normalizeSubtaskLabel(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

export function normalizeSubtaskIndex(value: unknown): number | null {
  if (value == null) return null;
  const number = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) return null;
  return number;
}

export function fallbackSubtaskLabel(index: number): string {
  return `Subtask ${index}`;
}

export function tableFromSubtaskIndices(
  indices: readonly (number | null | undefined)[],
  base: SubtaskTable = {},
): SubtaskTable {
  const table: SubtaskTable = { ...base };
  for (const index of indices) {
    if (index == null) continue;
    if (table[index] == null || table[index] === '') {
      table[index] = fallbackSubtaskLabel(index);
    }
  }
  return table;
}

export function assignNewSubtaskLabels(
  table: SubtaskTable,
  labels: readonly string[],
): SubtaskTable {
  const next: SubtaskTable = { ...table };
  const known = new Map(
    Object.entries(next).map(([index, label]) => [label, Number(index)] as const),
  );
  const used = Object.keys(next)
    .map(Number)
    .filter((index) => Number.isSafeInteger(index));
  let cursor = used.length > 0 ? Math.max(...used) + 1 : 0;
  const unique = Array.from(
    new Set(
      labels.map((label) => normalizeSubtaskLabel(label)).filter((label) => label.length > 0),
    ),
  ).sort();
  for (const label of unique) {
    if (known.has(label)) continue;
    next[cursor] = label;
    known.set(label, cursor);
    cursor += 1;
  }
  return next;
}

export function buildSubtaskTable(labels: readonly string[]): SubtaskTable {
  const unique = Array.from(
    new Set(
      labels.map((label) => normalizeSubtaskLabel(label)).filter((label) => label.length > 0),
    ),
  ).sort();
  const table: SubtaskTable = {};
  unique.forEach((label, index) => {
    table[index] = label;
  });
  return table;
}

export function collectSubtaskLabels(
  overlays: Iterable<readonly SubtaskSegment[] | undefined>,
  sourceTable?: SubtaskTable,
): string[] {
  const labels: string[] = [];
  if (sourceTable) {
    for (const label of Object.values(sourceTable)) {
      const normalized = normalizeSubtaskLabel(label);
      if (normalized) labels.push(normalized);
    }
  }
  for (const segments of overlays) {
    if (!segments) continue;
    for (const segment of segments) {
      const normalized = normalizeSubtaskLabel(segment.label);
      if (normalized) labels.push(normalized);
    }
  }
  return labels;
}

export function labelForSubtaskIndex(table: SubtaskTable, index: number | null): string | null {
  if (index == null) return null;
  const label = table[index];
  return label != null && label !== '' ? label : null;
}

export function indexForSubtaskLabel(table: SubtaskTable, label: string): number | undefined {
  const normalized = normalizeSubtaskLabel(label);
  if (!normalized) return undefined;
  for (const [rawIndex, value] of Object.entries(table)) {
    if (value === normalized) return Number(rawIndex);
  }
  return undefined;
}

export function validateSubtaskSegment(
  segment: SubtaskSegment,
  episodeLength: number,
): SubtaskSegment {
  if (!Number.isSafeInteger(episodeLength) || episodeLength < 0) {
    throw new Error(`Invalid episode length ${episodeLength}`);
  }
  if (!Number.isSafeInteger(segment.startFrame) || !Number.isSafeInteger(segment.endFrame)) {
    throw new Error('Subtask segment frames must be integers');
  }
  const label = normalizeSubtaskLabel(segment.label);
  if (!label) {
    throw new Error('Subtask label is required');
  }
  if (segment.startFrame < 0 || segment.endFrame < 0) {
    throw new Error('Subtask segment frames must be non-negative');
  }
  if (segment.startFrame > segment.endFrame) {
    throw new Error('Subtask segment start must be at or before end');
  }
  if (episodeLength === 0 || segment.endFrame >= episodeLength) {
    throw new Error(
      `Subtask segment ${segment.startFrame}-${segment.endFrame} is outside episode length ${episodeLength}`,
    );
  }
  return { startFrame: segment.startFrame, endFrame: segment.endFrame, label };
}

export function segmentsOverlap(left: SubtaskSegment, right: SubtaskSegment): boolean {
  return left.startFrame <= right.endFrame && right.startFrame <= left.endFrame;
}

export function findOverlappingSegment(
  segments: readonly SubtaskSegment[],
  candidate: SubtaskSegment,
  ignoreIndex?: number,
): SubtaskSegment | undefined {
  return segments.find((segment, index) => {
    if (index === ignoreIndex) return false;
    return segmentsOverlap(segment, candidate);
  });
}

export function sortSubtaskSegments(segments: readonly SubtaskSegment[]): SubtaskSegment[] {
  return [...segments].sort((left, right) => left.startFrame - right.startFrame);
}

export function insertSubtaskSegment(
  segments: readonly SubtaskSegment[],
  candidate: SubtaskSegment,
  episodeLength: number,
): SubtaskSegment[] {
  const next = validateSubtaskSegment(candidate, episodeLength);
  const overlap = findOverlappingSegment(segments, next);
  if (overlap) {
    throw new Error(
      `Subtask "${next.label}" overlaps "${overlap.label}" (${overlap.startFrame}-${overlap.endFrame})`,
    );
  }
  return sortSubtaskSegments([...segments, next]);
}

export function replaceSubtaskSegment(
  segments: readonly SubtaskSegment[],
  index: number,
  candidate: SubtaskSegment,
  episodeLength: number,
): SubtaskSegment[] {
  if (!Number.isSafeInteger(index) || index < 0 || index >= segments.length) {
    throw new Error(`Subtask segment index ${index} is out of range`);
  }
  const next = validateSubtaskSegment(candidate, episodeLength);
  const overlap = findOverlappingSegment(segments, next, index);
  if (overlap) {
    throw new Error(
      `Subtask "${next.label}" overlaps "${overlap.label}" (${overlap.startFrame}-${overlap.endFrame})`,
    );
  }
  const copy = [...segments];
  copy[index] = next;
  return sortSubtaskSegments(copy);
}

export function segmentsFromFrameIndices(
  indices: readonly (number | null | undefined)[],
  table: SubtaskTable,
): SubtaskSegment[] {
  const segments: SubtaskSegment[] = [];
  let current: SubtaskSegment | null = null;

  indices.forEach((rawIndex, frame) => {
    const index = normalizeSubtaskIndex(rawIndex);
    const label = labelForSubtaskIndex(table, index);
    if (label == null) {
      if (current) {
        segments.push(current);
        current = null;
      }
      return;
    }
    if (current && current.label === label && current.endFrame === frame - 1) {
      current = { ...current, endFrame: frame };
      return;
    }
    if (current) segments.push(current);
    current = { startFrame: frame, endFrame: frame, label };
  });

  if (current) segments.push(current);
  return segments;
}

export function frameIndicesFromSegments(
  episodeLength: number,
  segments: readonly SubtaskSegment[],
  table: SubtaskTable,
): Array<number | null> {
  if (!Number.isSafeInteger(episodeLength) || episodeLength < 0) {
    throw new Error(`Invalid episode length ${episodeLength}`);
  }
  const frames = Array.from({ length: episodeLength }, (): number | null => null);
  const sorted = sortSubtaskSegments(segments);
  for (let i = 0; i < sorted.length; i++) {
    const segment = validateSubtaskSegment(sorted[i], episodeLength);
    const overlap = findOverlappingSegment(sorted, segment, i);
    if (overlap) {
      throw new Error(
        `Subtask "${segment.label}" overlaps "${overlap.label}" (${overlap.startFrame}-${overlap.endFrame})`,
      );
    }
    const index = indexForSubtaskLabel(table, segment.label);
    if (index == null) {
      throw new Error(`Subtask label "${segment.label}" is missing from the subtask table`);
    }
    for (let frame = segment.startFrame; frame <= segment.endFrame; frame++) {
      frames[frame] = index;
    }
  }
  return frames;
}

export function isSegmentInsideEpisode(
  segment: Pick<SubtaskSegment, 'startFrame' | 'endFrame'>,
  episodeLength: number,
): boolean {
  return (
    Number.isSafeInteger(episodeLength) &&
    episodeLength > 0 &&
    Number.isSafeInteger(segment.startFrame) &&
    Number.isSafeInteger(segment.endFrame) &&
    segment.startFrame >= 0 &&
    segment.endFrame >= segment.startFrame &&
    segment.endFrame < episodeLength
  );
}

export function segmentsInsideEpisode(
  segments: readonly SubtaskSegment[],
  episodeLength: number,
): SubtaskSegment[] {
  return segments.filter((segment) => isSegmentInsideEpisode(segment, episodeLength));
}

function clampFrame(frame: number, episodeLength: number): number {
  if (episodeLength <= 0) return 0;
  return Math.max(0, Math.min(episodeLength - 1, frame));
}

export function resizeSubtaskSegment(
  segments: readonly SubtaskSegment[],
  index: number,
  edge: 'start' | 'end',
  frame: number,
  episodeLength: number,
): SubtaskSegment[] {
  if (!Number.isSafeInteger(index) || index < 0 || index >= segments.length) {
    throw new Error(`Subtask segment index ${index} is out of range`);
  }
  const current = segments[index];
  const nextFrame = clampFrame(frame, episodeLength);
  const startFrame = edge === 'start' ? Math.min(nextFrame, current.endFrame) : current.startFrame;
  const endFrame = edge === 'end' ? Math.max(nextFrame, current.startFrame) : current.endFrame;
  return replaceSubtaskSegment(
    segments,
    index,
    { ...current, startFrame, endFrame },
    episodeLength,
  );
}

export type SubtaskLaneItem =
  | {
      kind: 'segment';
      index: number;
      startFrame: number;
      endFrame: number;
      label: string;
    }
  | {
      kind: 'gap';
      startFrame: number;
      endFrame: number;
    };

export function buildSubtaskLane(
  segments: readonly SubtaskSegment[],
  episodeLength: number,
): SubtaskLaneItem[] {
  if (!Number.isSafeInteger(episodeLength) || episodeLength <= 0) return [];
  const sorted = sortSubtaskSegments(segmentsInsideEpisode(segments, episodeLength));
  const items: SubtaskLaneItem[] = [];
  let cursor = 0;
  sorted.forEach((segment, index) => {
    if (segment.startFrame > cursor) {
      items.push({ kind: 'gap', startFrame: cursor, endFrame: segment.startFrame - 1 });
    }
    items.push({
      kind: 'segment',
      index,
      startFrame: segment.startFrame,
      endFrame: segment.endFrame,
      label: segment.label,
    });
    cursor = segment.endFrame + 1;
  });
  if (cursor < episodeLength) {
    items.push({ kind: 'gap', startFrame: cursor, endFrame: episodeLength - 1 });
  }
  return items;
}

/** Last unlabeled gap in episode order, or null when every frame is labeled. */
export function lastUnlabeledGap(
  segments: readonly SubtaskSegment[],
  episodeLength: number,
): { startFrame: number; endFrame: number } | null {
  const lane = buildSubtaskLane(segments, episodeLength);
  for (let index = lane.length - 1; index >= 0; index--) {
    const item = lane[index];
    if (item.kind === 'gap') return { startFrame: item.startFrame, endFrame: item.endFrame };
  }
  return null;
}

/** Unlabeled run ending at the playhead: from the previous clip's end (or 0) to `playhead`. */
export function subtaskRangeToPlayhead(
  segments: readonly SubtaskSegment[],
  playhead: number,
  episodeLength: number,
): { startFrame: number; endFrame: number } | null {
  if (!Number.isSafeInteger(playhead) || !Number.isSafeInteger(episodeLength)) return null;
  if (playhead < 0 || playhead >= episodeLength || episodeLength <= 0) return null;
  const sorted = sortSubtaskSegments(segmentsInsideEpisode(segments, episodeLength));
  if (sorted.some((segment) => playhead >= segment.startFrame && playhead <= segment.endFrame)) {
    return null;
  }
  let startFrame = 0;
  for (const segment of sorted) {
    if (segment.endFrame < playhead) startFrame = segment.endFrame + 1;
    else break;
  }
  if (startFrame > playhead) return null;
  return { startFrame, endFrame: playhead };
}

/** Shrink/grow the first clip's start or the last clip's end, leaving unlabeled frames. */
export function resizeOuterSubtaskEdge(
  segments: readonly SubtaskSegment[],
  edge: 'start' | 'end',
  frame: number,
  episodeLength: number,
): SubtaskSegment[] {
  const sorted = sortSubtaskSegments(segmentsInsideEpisode(segments, episodeLength));
  if (sorted.length === 0) return [];
  return resizeSubtaskClipEdge(
    sorted,
    edge === 'start' ? 0 : sorted.length - 1,
    edge,
    frame,
    episodeLength,
  );
}

/**
 * Resize one clip edge. Shrinking leaves a gap; growing fills a gap or steals
 * from a flush neighbor (neighbor keeps at least one frame).
 */
export function resizeSubtaskClipEdge(
  segments: readonly SubtaskSegment[],
  index: number,
  edge: 'start' | 'end',
  frame: number,
  episodeLength: number,
): SubtaskSegment[] {
  const sorted = sortSubtaskSegments(segmentsInsideEpisode(segments, episodeLength));
  if (!Number.isSafeInteger(index) || index < 0 || index >= sorted.length) {
    throw new Error(`Subtask segment index ${index} is out of range`);
  }
  const current = sorted[index];
  const next = sorted.map((segment) => ({ ...segment }));

  if (edge === 'end') {
    const neighbor = next[index + 1];
    const minEnd = current.startFrame;
    const maxEnd = neighbor ? neighbor.endFrame : episodeLength - 1;
    const endFrame = clampFrame(Math.max(minEnd, Math.min(maxEnd, frame)), episodeLength);
    next[index] = { ...current, endFrame };
    if (neighbor && endFrame >= neighbor.startFrame) {
      next[index + 1] = {
        ...neighbor,
        startFrame: Math.min(endFrame + 1, neighbor.endFrame),
      };
    }
  } else {
    const neighbor = next[index - 1];
    const maxStart = current.endFrame;
    const minStart = neighbor ? neighbor.startFrame : 0;
    const startFrame = clampFrame(Math.max(minStart, Math.min(maxStart, frame)), episodeLength);
    next[index] = { ...current, startFrame };
    if (neighbor && startFrame <= neighbor.endFrame) {
      next[index - 1] = {
        ...neighbor,
        endFrame: Math.max(neighbor.startFrame, startFrame - 1),
      };
    }
  }

  return next.map((segment) => validateSubtaskSegment(segment, episodeLength));
}

/**
 * Drag the shared boundary between two adjacent lane items.
 * `rightStartFrame` is the first frame of the item to the right of the handle.
 * Adjacent labeled clips stay flush (no gap, no overlap). Gaps can shrink to empty.
 */
export function dragSubtaskLaneBoundary(
  segments: readonly SubtaskSegment[],
  boundaryIndex: number,
  rightStartFrame: number,
  episodeLength: number,
): SubtaskSegment[] {
  const lane = buildSubtaskLane(segments, episodeLength);
  if (boundaryIndex < 0 || boundaryIndex >= lane.length - 1) {
    throw new Error(`Invalid subtask boundary ${boundaryIndex}`);
  }
  const left = lane[boundaryIndex];
  const right = lane[boundaryIndex + 1];
  const minStart = left.startFrame + (left.kind === 'segment' ? 1 : 0);
  const maxStart = right.kind === 'segment' ? right.endFrame : right.endFrame + 1;
  const nextStart = Math.max(minStart, Math.min(maxStart, rightStartFrame));
  const sorted = sortSubtaskSegments(segmentsInsideEpisode(segments, episodeLength));
  const next = sorted.map((segment) => ({ ...segment }));
  if (left.kind === 'segment') {
    next[left.index] = { ...next[left.index], endFrame: nextStart - 1 };
  }
  if (right.kind === 'segment') {
    next[right.index] = { ...next[right.index], startFrame: nextStart };
  }
  return sortSubtaskSegments(next.map((segment) => validateSubtaskSegment(segment, episodeLength)));
}

export function translateSubtaskSegment(
  segments: readonly SubtaskSegment[],
  index: number,
  deltaFrames: number,
  episodeLength: number,
): SubtaskSegment[] {
  if (!Number.isSafeInteger(index) || index < 0 || index >= segments.length) {
    throw new Error(`Subtask segment index ${index} is out of range`);
  }
  if (!Number.isSafeInteger(deltaFrames)) {
    throw new Error(`Invalid subtask translation ${deltaFrames}`);
  }
  const current = segments[index];
  const span = current.endFrame - current.startFrame;
  let startFrame = current.startFrame + deltaFrames;
  let endFrame = current.endFrame + deltaFrames;
  if (startFrame < 0) {
    startFrame = 0;
    endFrame = span;
  }
  if (endFrame >= episodeLength) {
    endFrame = episodeLength - 1;
    startFrame = endFrame - span;
  }
  startFrame = clampFrame(startFrame, episodeLength);
  endFrame = Math.max(startFrame, clampFrame(endFrame, episodeLength));
  return replaceSubtaskSegment(
    segments,
    index,
    { ...current, startFrame, endFrame },
    episodeLength,
  );
}

export function computeSubtaskCoverage(
  episodeLength: number,
  segments: readonly SubtaskSegment[],
): SubtaskCoverage {
  if (!Number.isSafeInteger(episodeLength) || episodeLength < 0) {
    throw new Error(`Invalid episode length ${episodeLength}`);
  }
  if (episodeLength === 0) {
    return { labeledFrames: 0, totalFrames: 0, gaps: [], complete: false };
  }
  const covered = new Array<boolean>(episodeLength).fill(false);
  for (const segment of segmentsInsideEpisode(segments, episodeLength)) {
    for (let frame = segment.startFrame; frame <= segment.endFrame; frame++) {
      covered[frame] = true;
    }
  }

  const gaps: SubtaskCoverage['gaps'] = [];
  let gapStart: number | null = null;
  let labeledFrames = 0;
  for (let frame = 0; frame < episodeLength; frame++) {
    if (covered[frame]) {
      labeledFrames += 1;
      if (gapStart != null) {
        gaps.push({ startFrame: gapStart, endFrame: frame - 1 });
        gapStart = null;
      }
    } else if (gapStart == null) {
      gapStart = frame;
    }
  }
  if (gapStart != null) {
    gaps.push({ startFrame: gapStart, endFrame: episodeLength - 1 });
  }

  return {
    labeledFrames,
    totalFrames: episodeLength,
    gaps,
    complete: episodeLength > 0 && gaps.length === 0,
  };
}

export function currentSubtaskLabel(
  segments: readonly SubtaskSegment[],
  frameIndex: number,
): string | null {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) return null;
  const match = segments.find(
    (segment) => frameIndex >= segment.startFrame && frameIndex <= segment.endFrame,
  );
  return match ? match.label : null;
}

export function assertExportCoverage(
  episodeIndex: number,
  episodeLength: number,
  segments: readonly SubtaskSegment[],
): void {
  const coverage = computeSubtaskCoverage(episodeLength, segments);
  if (!coverage.complete) {
    throw new SubtaskCoverageError(episodeIndex, coverage);
  }
}

export function indicesFromFrameLabels(
  labels: readonly (string | null | undefined)[],
  table: SubtaskTable,
): Array<number | null> {
  return labels.map((label) => {
    const normalized = normalizeSubtaskLabel(label);
    if (!normalized) return null;
    return indexForSubtaskLabel(table, normalized) ?? null;
  });
}

export function parseSubtaskTableFromRows(
  rows: ReadonlyArray<{ subtaskIndex?: unknown; label: unknown }>,
): SubtaskTable {
  const table: SubtaskTable = {};
  rows.forEach((row, rowIndex) => {
    const label = normalizeSubtaskLabel(row.label);
    if (!label) return;
    const index = normalizeSubtaskIndex(row.subtaskIndex) ?? rowIndex;
    table[index] = label;
  });
  return table;
}
