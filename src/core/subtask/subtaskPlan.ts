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

export function computeSubtaskCoverage(
  episodeLength: number,
  segments: readonly SubtaskSegment[],
): SubtaskCoverage {
  if (!Number.isSafeInteger(episodeLength) || episodeLength < 0) {
    throw new Error(`Invalid episode length ${episodeLength}`);
  }
  const covered = new Array<boolean>(episodeLength).fill(false);
  for (const segment of segments) {
    const next = validateSubtaskSegment(segment, episodeLength);
    for (let frame = next.startFrame; frame <= next.endFrame; frame++) {
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
