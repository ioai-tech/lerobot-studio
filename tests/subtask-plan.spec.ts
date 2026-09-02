import { describe, expect, it } from 'vitest';
import {
  SubtaskCoverageError,
  assertExportCoverage,
  buildSubtaskTable,
  collectSubtaskLabels,
  computeSubtaskCoverage,
  currentSubtaskLabel,
  findOverlappingSegment,
  frameIndicesFromSegments,
  indicesFromFrameLabels,
  insertSubtaskSegment,
  normalizeSubtaskIndex,
  parseSubtaskTableFromRows,
  replaceSubtaskSegment,
  resolveSubtaskIndexFeatureKey,
  resolveSubtaskLabelFeatureKey,
  segmentsFromFrameIndices,
  tableFromSubtaskIndices,
  assignNewSubtaskLabels,
} from '@/core';

describe('buildSubtaskTable', () => {
  it('assigns indices from unique labels in alphabetical order', () => {
    expect(buildSubtaskTable(['Grasp the apple', 'Approach the apple', 'Grasp the apple'])).toEqual(
      {
        0: 'Approach the apple',
        1: 'Grasp the apple',
      },
    );
  });

  it('drops blank labels', () => {
    expect(buildSubtaskTable(['  ', 'Lift', ''])).toEqual({ 0: 'Lift' });
  });
});

describe('parseSubtaskTableFromRows', () => {
  it('uses explicit subtask_index values', () => {
    expect(
      parseSubtaskTableFromRows([
        { subtaskIndex: 2, label: 'Lift the apple' },
        { subtaskIndex: 0, label: 'Approach the apple' },
      ]),
    ).toEqual({
      0: 'Approach the apple',
      2: 'Lift the apple',
    });
  });

  it('falls back to row order and pandas-style labels', () => {
    expect(
      parseSubtaskTableFromRows([
        { label: 'Approach the apple' },
        { label: '  Grasp the apple  ' },
        { label: '   ' },
      ]),
    ).toEqual({
      0: 'Approach the apple',
      1: 'Grasp the apple',
    });
  });
});

describe('normalizeSubtaskIndex', () => {
  it('treats missing, negative, and non-integer values as unlabeled', () => {
    expect(normalizeSubtaskIndex(-1)).toBeNull();
    expect(normalizeSubtaskIndex(1.5)).toBeNull();
    expect(normalizeSubtaskIndex(undefined)).toBeNull();
    expect(normalizeSubtaskIndex(BigInt(3))).toBe(3);
  });
});

describe('segmentsFromFrameIndices', () => {
  const table = {
    0: 'Approach the apple',
    1: 'Grasp the apple',
  };

  it('collapses consecutive labels and skips unlabeled frames', () => {
    expect(segmentsFromFrameIndices([0, 0, -1, 1, 1, 99], table)).toEqual([
      { startFrame: 0, endFrame: 1, label: 'Approach the apple' },
      { startFrame: 3, endFrame: 4, label: 'Grasp the apple' },
    ]);
  });
});

describe('frameIndicesFromSegments', () => {
  const table = buildSubtaskTable(['Approach', 'Grasp']);

  it('writes valid indices and leaves gaps as null', () => {
    expect(
      frameIndicesFromSegments(
        5,
        [
          { startFrame: 0, endFrame: 1, label: 'Approach' },
          { startFrame: 3, endFrame: 3, label: 'Grasp' },
        ],
        table,
      ),
    ).toEqual([0, 0, null, 1, null]);
  });

  it('rejects overlapping segments', () => {
    expect(() =>
      frameIndicesFromSegments(
        4,
        [
          { startFrame: 0, endFrame: 2, label: 'Approach' },
          { startFrame: 2, endFrame: 3, label: 'Grasp' },
        ],
        table,
      ),
    ).toThrow(/overlaps/);
  });
});

describe('insert and replace segments', () => {
  it('allows adjacent single-frame segments', () => {
    const first = insertSubtaskSegment([], { startFrame: 0, endFrame: 0, label: 'A' }, 3);
    const next = insertSubtaskSegment(first, { startFrame: 1, endFrame: 2, label: 'B' }, 3);
    expect(next).toEqual([
      { startFrame: 0, endFrame: 0, label: 'A' },
      { startFrame: 1, endFrame: 2, label: 'B' },
    ]);
  });

  it('rejects overlapping inserts and out-of-range frames', () => {
    const segments = [{ startFrame: 0, endFrame: 2, label: 'A' }];
    expect(() =>
      insertSubtaskSegment(segments, { startFrame: 2, endFrame: 3, label: 'B' }, 5),
    ).toThrow(/overlaps/);
    expect(() => insertSubtaskSegment([], { startFrame: 0, endFrame: 5, label: 'A' }, 5)).toThrow(
      /outside episode length/,
    );
  });

  it('replaces a segment without overlapping neighbors', () => {
    const segments = [
      { startFrame: 0, endFrame: 1, label: 'A' },
      { startFrame: 3, endFrame: 4, label: 'B' },
    ];
    expect(
      replaceSubtaskSegment(segments, 1, { startFrame: 2, endFrame: 4, label: 'C' }, 5),
    ).toEqual([
      { startFrame: 0, endFrame: 1, label: 'A' },
      { startFrame: 2, endFrame: 4, label: 'C' },
    ]);
    expect(findOverlappingSegment(segments, { startFrame: 1, endFrame: 3, label: 'X' })).toEqual(
      segments[0],
    );
  });
});

describe('coverage', () => {
  it('reports gaps and blocks incomplete export', () => {
    const segments = [{ startFrame: 0, endFrame: 1, label: 'A' }];
    const coverage = computeSubtaskCoverage(4, segments);
    expect(coverage).toEqual({
      labeledFrames: 2,
      totalFrames: 4,
      gaps: [{ startFrame: 2, endFrame: 3 }],
      complete: false,
    });
    expect(() => assertExportCoverage(7, 4, segments)).toThrow(SubtaskCoverageError);
  });

  it('treats a fully labeled episode as complete', () => {
    const segments = [
      { startFrame: 0, endFrame: 1, label: 'A' },
      { startFrame: 2, endFrame: 3, label: 'B' },
    ];
    expect(computeSubtaskCoverage(4, segments).complete).toBe(true);
    expect(() => assertExportCoverage(0, 4, segments)).not.toThrow();
  });
});

describe('feature key resolution', () => {
  it('prefers official subtask_index then metadata.subtask_index', () => {
    expect(resolveSubtaskIndexFeatureKey({})).toBeNull();
    expect(
      resolveSubtaskIndexFeatureKey({
        'metadata.subtask_index': { dtype: 'int64', shape: [1], names: null },
      }),
    ).toBe('metadata.subtask_index');
    expect(
      resolveSubtaskIndexFeatureKey({
        subtask_index: { dtype: 'int64', shape: [1], names: null },
        'metadata.subtask_index': { dtype: 'int64', shape: [1], names: null },
      }),
    ).toBe('subtask_index');
    expect(
      resolveSubtaskLabelFeatureKey({
        'metadata.subtask_label': { dtype: 'string', shape: [1], names: null },
      }),
    ).toBe('metadata.subtask_label');
  });

  it('maps inline labels onto a canonical table', () => {
    const labels = ['Grasp', 'Grasp', '', 'Approach'];
    const table = buildSubtaskTable(labels);
    expect(indicesFromFrameLabels(labels, table)).toEqual([1, 1, null, 0]);
  });

  it('preserves official source indices when synthesizing fallback labels', () => {
    expect(tableFromSubtaskIndices([15, 15, 4], {})).toEqual({
      4: 'Subtask 4',
      15: 'Subtask 15',
    });
    expect(assignNewSubtaskLabels({ 15: 'Subtask 15' }, ['Approach the apple'])).toEqual({
      15: 'Subtask 15',
      16: 'Approach the apple',
    });
  });
});

describe('helpers', () => {
  it('collects unique labels and reports the label at the current frame', () => {
    const source = { 0: 'Approach' };
    const overlays = [[{ startFrame: 0, endFrame: 1, label: 'Grasp' }]];
    expect(buildSubtaskTable(collectSubtaskLabels(overlays, source))).toEqual({
      0: 'Approach',
      1: 'Grasp',
    });
    expect(currentSubtaskLabel(overlays[0], 1)).toBe('Grasp');
    expect(currentSubtaskLabel(overlays[0], 2)).toBeNull();
  });
});
