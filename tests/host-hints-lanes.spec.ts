import { describe, expect, it } from 'vitest';
import {
  annotationToExportSegments,
  applyChange,
  concatSubtasks,
  SubtaskCoverageError,
  buildSubtaskLane,
  cameraDisplayName,
  laneMarkerAt,
  markerRowsOf,
  segmentTaskHint,
  stepLaneMarker,
  subtaskLabelHint,
  validateSubtaskSegment,
  withoutDisplayHints,
  type AnnotationChange,
  type AnnotationContext,
  type Segment,
  type TimelineMarker,
} from '@/core';
import { matchMarkerStepKey, matchSegmentShortcut } from '../src/react/hooks/segmentShortcuts';
import { buildExportSubtaskPlan } from '../src/platform/export/SubtaskExportPlan';
import type { LeRobotDataLoader } from '@/platform';

function marker(id: string, startFrame: number, lane?: string): TimelineMarker {
  return {
    id,
    episodeIndex: 0,
    startFrame,
    endFrame: startFrame,
    severity: 'warn',
    label: id,
    ...(lane ? { lane } : {}),
  };
}

function seg(id: string, startFrame: number, endFrame: number, extra: Partial<Segment> = {}) {
  return {
    id,
    startFrame,
    endFrame,
    task: null,
    subtasks: [],
    values: {},
    review: 'to_review',
    origin: { kind: 'manual' },
    ...extra,
  } as Segment;
}

const ctx: AnnotationContext = { episodeLength: () => 100 };

describe('marker rows (markerLanes)', () => {
  const lanes = [
    { id: 'faces', label: 'Possible faces', navigable: true },
    { id: 'empty', label: 'Nothing here' },
    { id: 'checks', label: 'Checks' },
  ];

  it('declared lanes top to bottom, then the default row; empty rows are left out', () => {
    const rows = markerRowsOf(
      [
        marker('a', 1),
        marker('f1', 2, 'faces'),
        marker('c', 3, 'checks'),
        marker('f2', 4, 'faces'),
      ],
      lanes,
    );
    expect(rows.map((row) => [row.lane?.id ?? null, row.markers.map((m) => m.id)])).toEqual([
      ['faces', ['f1', 'f2']],
      ['checks', ['c']],
      [null, ['a']],
    ]);
  });

  it('without lanes, or with a lane no row declares, markers stay in the default row', () => {
    const markers = [marker('a', 1), marker('b', 2, 'unknown'), marker('f', 3, 'faces')];
    expect(markerRowsOf(markers, undefined)).toEqual([{ lane: null, markers }]);
    expect(markerRowsOf(markers, [lanes[0]]).map((row) => row.markers.map((m) => m.id))).toEqual([
      ['f'],
      ['a', 'b'],
    ]);
  });

  it('a lane declared twice counts once (its first declaration)', () => {
    const rows = markerRowsOf(
      [marker('f', 1, 'faces')],
      [lanes[0], { id: 'faces', label: 'Again' }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lane?.label).toBe('Possible faces');
  });
});

describe('stepping a navigable row', () => {
  // Two markers start on frame 20 (two cameras on one frame).
  const markers = [marker('m10', 10), marker('m20a', 20), marker('m20b', 20), marker('m30', 30)];

  it('from a frame between markers: the next one after it, the previous one before it', () => {
    expect(stepLaneMarker(markers, null, 15, 1)).toBe(1);
    expect(stepLaneMarker(markers, null, 15, -1)).toBe(0);
    expect(stepLaneMarker(markers, null, 0, 1)).toBe(0);
    expect(stepLaneMarker(markers, null, 0, -1)).toBeNull();
    expect(stepLaneMarker(markers, null, 99, 1)).toBeNull();
    expect(stepLaneMarker(markers, null, 99, -1)).toBe(3);
  });

  it('markers that start on the same frame are each visited', () => {
    expect(stepLaneMarker(markers, 'm20a', 20, 1)).toBe(2);
    expect(stepLaneMarker(markers, 'm20b', 20, 1)).toBe(3);
    expect(stepLaneMarker(markers, 'm20b', 20, -1)).toBe(1);
  });

  it('the playhead resting on a marker start counts as on it, even without a last step', () => {
    expect(laneMarkerAt(markers, null, 10)).toBe(0);
    expect(stepLaneMarker(markers, null, 10, 1)).toBe(1);
    expect(stepLaneMarker(markers, null, 10, -1)).toBeNull();
  });

  it('a last step the playhead has left no longer counts', () => {
    expect(laneMarkerAt(markers, 'm20b', 25)).toBe(-1);
    expect(stepLaneMarker(markers, 'm20b', 25, 1)).toBe(3);
    expect(stepLaneMarker(markers, 'm20b', 25, -1)).toBe(2);
  });
});

describe('marker step keys', () => {
  const key = (init: Partial<KeyboardEvent>) =>
    ({
      key: '',
      code: '',
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      ...init,
    }) as KeyboardEvent;

  it('Shift+. / Shift+, step; they are no segment key', () => {
    const next = key({ key: '>', code: 'Period', shiftKey: true });
    const previous = key({ key: '<', code: 'Comma', shiftKey: true });
    expect(matchMarkerStepKey(next)).toBe(1);
    expect(matchMarkerStepKey(previous)).toBe(-1);
    // The period key's printed character depends on the layout (German: ':').
    expect(matchMarkerStepKey(key({ key: ':', code: 'Period', shiftKey: true }))).toBe(1);
    expect(matchSegmentShortcut(next)).toBeNull();
    expect(matchSegmentShortcut(previous)).toBeNull();
  });

  it('the nudge keys and modified keys are not steps', () => {
    expect(matchMarkerStepKey(key({ key: '.', code: 'Period' }))).toBeNull();
    expect(matchMarkerStepKey(key({ key: '≥', code: 'Period', altKey: true }))).toBeNull();
    expect(
      matchMarkerStepKey(key({ key: '>', code: 'Period', shiftKey: true, ctrlKey: true })),
    ).toBeNull();
    expect(
      matchMarkerStepKey(key({ key: '>', code: 'Period', shiftKey: true, metaKey: true })),
    ).toBeNull();
  });
});

describe('display hints (taskHint, labelHint)', () => {
  it('a task hint shows only while the segment has no task', () => {
    expect(segmentTaskHint({ task: null, taskHint: 'Fold the towel' })).toBe('Fold the towel');
    expect(segmentTaskHint({ task: '', taskHint: 'Fold the towel' })).toBe('Fold the towel');
    expect(segmentTaskHint({ task: '叠毛巾', taskHint: 'Fold the towel' })).toBeNull();
    expect(segmentTaskHint({ task: null, taskHint: '  ' })).toBeNull();
    expect(segmentTaskHint({ task: null })).toBeNull();
    expect(subtaskLabelHint({ label: '', labelHint: 'grasp' })).toBe('grasp');
    expect(subtaskLabelHint({ label: '抓取', labelHint: 'grasp' })).toBeNull();
  });

  it('an empty subtask label with a hint is valid; without one it is refused', () => {
    const hinted = seg('a', 0, 49, {
      subtasks: [{ startFrame: 0, endFrame: 9, label: '', labelHint: 'grasp' }],
    });
    const created = applyChange(
      { episodes: {} },
      { op: 'create', episodeIndex: 0, segment: hinted },
      ctx,
    );
    expect(created.ok).toBe(true);
    const bare = seg('b', 0, 49, { subtasks: [{ startFrame: 0, endFrame: 9, label: '' }] });
    const refused = applyChange(
      { episodes: {} },
      { op: 'create', episodeIndex: 0, segment: bare },
      ctx,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.refusal.code).toBe('SUBTASK_INVALID');

    // The subtask lane keeps the hint through an edit and shows it, never as the label.
    const kept = validateSubtaskSegment(
      { startFrame: 2, endFrame: 9, label: '', labelHint: 'grasp' },
      100,
    );
    expect(kept).toEqual({ startFrame: 2, endFrame: 9, label: '', labelHint: 'grasp' });
    expect(
      validateSubtaskSegment(
        { startFrame: 2, endFrame: 9, label: '抓取', labelHint: 'grasp' },
        100,
      ),
    ).toEqual({
      startFrame: 2,
      endFrame: 9,
      label: '抓取',
    });
    expect(() => validateSubtaskSegment({ startFrame: 2, endFrame: 9, label: '' }, 100)).toThrow();
    expect(buildSubtaskLane([kept], 20)[1]).toMatchObject({
      kind: 'segment',
      label: '',
      labelHint: 'grasp',
    });
  });

  it('no emitted change carries a hint, whatever op copies a segment', () => {
    const hinted = seg('a', 0, 49, {
      taskHint: 'Fold the towel',
      subtasks: [{ startFrame: 0, endFrame: 9, label: '', labelHint: 'grasp' }],
    });
    const other = seg('b', 50, 99, { task: '叠', taskHint: 'Fold' });
    const changes: AnnotationChange[] = [
      { op: 'create', episodeIndex: 0, segment: hinted },
      { op: 'restore', episodeIndex: 0, segment: hinted },
      { op: 'unmerge', episodeIndex: 0, id: 'a', restored: other, before: hinted },
      { op: 'update', episodeIndex: 0, id: 'a', patch: { subtasks: hinted.subtasks } },
      { op: 'update', episodeIndex: 0, id: 'a', patch: { task: '叠毛巾' } },
      { op: 'delete', episodeIndex: 0, id: 'a' },
      { op: 'confirm', episodeIndex: 0, ids: ['a'] },
    ];
    for (const change of changes) {
      const sent = JSON.stringify(withoutDisplayHints(change));
      expect(sent).not.toContain('Hint');
      expect(sent).not.toContain('Fold');
      expect(sent).not.toContain('grasp');
    }
    // The viewer's own copy keeps them (they are display text for this host).
    expect(hinted.taskHint).toBe('Fold the towel');
    expect(withoutDisplayHints(changes[0])).toEqual({
      op: 'create',
      episodeIndex: 0,
      segment: {
        ...hinted,
        taskHint: undefined,
        subtasks: [{ startFrame: 0, endFrame: 9, label: '' }],
      },
    });
  });

  it('exports never carry a hint', () => {
    const exported = annotationToExportSegments({
      episodes: {
        0: {
          segments: [
            seg('a', 0, 49, {
              taskHint: 'Fold the towel',
              subtasks: [{ startFrame: 0, endFrame: 9, label: 'reach', labelHint: 'grasp' }],
            }),
          ],
        },
      },
    });
    const text = JSON.stringify([...exported.values()]);
    expect(text).not.toContain('Fold');
    expect(text).not.toContain('grasp');
    expect(exported.get(0)?.[0]).toMatchObject({
      task: null,
      subtasks: [{ startFrame: 0, endFrame: 9, label: 'reach' }],
    });
  });
});

describe('an empty subtask label is no label in data', () => {
  it('exports leave a subtask with an empty label out: its frames are unlabeled, never the hint', async () => {
    const exported = annotationToExportSegments({
      episodes: {
        0: {
          segments: [
            seg('a', 0, 9, {
              subtasks: [
                { startFrame: 0, endFrame: 4, label: 'reach' },
                { startFrame: 5, endFrame: 9, label: '', labelHint: 'grasp' },
              ],
            }),
          ],
        },
      },
    });
    expect(exported.get(0)?.[0].subtasks).toEqual([{ startFrame: 0, endFrame: 4, label: 'reach' }]);

    // A v3.0 export with subtasks refuses the uncovered frames by name (the
    // dialog offers to fill them), not with a generic "label is required".
    const error = await buildExportSubtaskPlan({
      dataLoader: {} as LeRobotDataLoader,
      info: { codebase_version: 'v3.0', features: {} } as never,
      episodes: [{ episode_index: 0, length: 10, tasks: ['pick'] }],
      overlay: new Map([[0, exported.get(0)![0].subtasks]]),
      sourceTable: {},
      targetVersion: 'v3.0',
    }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(SubtaskCoverageError);
    expect(error).toMatchObject({
      coverage: expect.objectContaining({ labeledFrames: 5, totalFrames: 10 }),
    });
  });

  it('a merge joins two empty labels only when their hints match (a split piece)', () => {
    const left = [{ startFrame: 0, endFrame: 4, label: '', labelHint: 'grasp' }];
    expect(
      concatSubtasks(left, [{ startFrame: 5, endFrame: 9, label: '', labelHint: 'grasp' }]),
    ).toEqual([{ startFrame: 0, endFrame: 9, label: '', labelHint: 'grasp' }]);
    // Two different subtasks, both still unnamed in this language, stay two.
    expect(
      concatSubtasks(left, [{ startFrame: 5, endFrame: 9, label: '', labelHint: 'place' }]),
    ).toHaveLength(2);
    // A named label joins as before, whatever its (unshown) hint.
    expect(
      concatSubtasks(
        [{ startFrame: 0, endFrame: 4, label: 'reach', labelHint: 'a' }],
        [{ startFrame: 5, endFrame: 9, label: 'reach', labelHint: 'b' }],
      ),
    ).toHaveLength(1);
  });
});

describe('camera display names (cameraLabels)', () => {
  it("the host's label, else the key's last part", () => {
    const labels = { 'observation.images.head_left': 'Head, left', 'observation.images.x': '  ' };
    expect(cameraDisplayName('observation.images.head_left', labels)).toBe('Head, left');
    expect(cameraDisplayName('observation.images.wrist', labels)).toBe('wrist');
    expect(cameraDisplayName('observation.images.x', labels)).toBe('x');
    expect(cameraDisplayName('observation.images.wrist')).toBe('wrist');
    // A key such as "toString" is never read from the prototype.
    expect(cameraDisplayName('toString', {})).toBe('toString');
  });
});
