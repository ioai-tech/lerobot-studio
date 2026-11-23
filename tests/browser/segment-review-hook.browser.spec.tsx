import React, { useLayoutEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyChange,
  classifyLeRobotVersion,
  getEpisodeSegments,
  type AnnotationChange,
  type AnnotationDocument,
  type AnnotationField,
  type EpisodeMetadata,
  type Segment,
} from '@/core';
import { useSegmentAnnotation, type SegmentAnnotationState } from '@/contexts/useSegmentAnnotation';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const episodes: EpisodeMetadata[] = [{ episode_index: 0, length: 100, tasks: ['pick'] }];
const versionCapability = classifyLeRobotVersion('v3.0');
const ctx = { episodeLength: (index: number) => (index === 0 ? 100 : undefined) };

const fields: AnnotationField[] = [
  { id: 'outcome', label: 'Outcome', kind: 'select', options: [{ value: 'success', label: 'S' }] },
  { id: 'task_other', label: 'Task (other language)', kind: 'text', inherit: true },
];

function seg(id: string, startFrame: number, endFrame: number, extra: Partial<Segment> = {}) {
  return {
    id,
    startFrame,
    endFrame,
    task: null,
    subtasks: [],
    values: {},
    review: 'to_review',
    origin: { kind: 'suggested', confidence: 0.5 },
    ...extra,
  } satisfies Segment;
}

type Control = {
  segments: SegmentAnnotationState;
  frame: number;
  paused: number;
  sent: AnnotationChange[];
};

function Harness({ control, initial }: { control: Control; initial: AnnotationDocument }) {
  const [value, setValue] = useState(initial);
  const segments = useSegmentAnnotation({
    episodes,
    selectedEpisodeIndex: 0,
    versionCapability,
    episodeEditMode: true,
    sourceSubtasks: [],
    getFrameIndex: () => control.frame,
    setFrameIndex: (frame) => {
      control.frame = frame;
    },
    selectEpisode: async () => true,
    pausePlayback: () => {
      control.paused += 1;
    },
  });
  const { configure } = segments;
  useLayoutEffect(() => {
    configure({
      fields,
      annotation: {
        value,
        createSegmentId: () => `new-${control.sent.length}`,
        onChange: (change) => {
          control.sent.push(change);
          setValue((current) => {
            const result = applyChange(current, change, { ...ctx, fields });
            return result.ok ? result.doc : current;
          });
        },
      },
    });
  }, [configure, control, value]);
  control.segments = segments;
  return null;
}

describe('browser: segment review hook (walk 2026-11-23)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let control: Control;

  async function mount(initial: AnnotationDocument) {
    control = { frame: 0, paused: 0, sent: [] } as unknown as Control;
    root.render(<Harness control={control} initial={initial} />);
    await expect.poll(() => control.segments?.canEdit).toBe(true);
  }

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    host.remove();
  });

  it('F-18: Confirm pauses playback and seeks to the start of the next segment to review', async () => {
    await mount({
      episodes: {
        0: {
          segments: [
            seg('a', 0, 9),
            seg('b', 10, 19, { review: 'confirmed' }),
            seg('c', 20, 29, { readOnly: true }),
            seg('d', 30, 39),
          ],
        },
      },
    });
    control.segments.selectSegment('a');
    await expect.poll(() => control.segments.selectedSegmentId).toBe('a');
    control.frame = 5;
    expect(control.segments.confirmSelected()).toBe(true);
    // b is confirmed and c read-only: review goes on at d, paused at its first frame.
    await expect.poll(() => control.segments.selectedSegmentId).toBe('d');
    expect(control.frame).toBe(30);
    expect(control.paused).toBe(1);
    expect(control.segments.notice).toMatchObject({
      key: 'segments.notice.confirmed',
      detail: { key: 'segments.notice.nextToReview', values: { n: 4 } },
    });
    // The last one: nothing is left, the selection stays, nothing seeks.
    control.frame = 33;
    expect(control.segments.confirmSelected()).toBe(true);
    await expect
      .poll(() => control.segments.notice?.detail?.key)
      .toBe('segments.notice.noneToReview');
    expect(control.segments.selectedSegmentId).toBe('d');
    expect(control.frame).toBe(33);
    expect(control.paused).toBe(1);
  });

  it('F-02: N starts with the task and inherited fields of the segment it continues, as Split keeps them', async () => {
    const values = { outcome: 'success', task_other: 'Plier la serviette' };
    await mount({
      episodes: {
        0: {
          segments: [
            seg('a', 0, 9, { task: 'Fold the towel', values }),
            seg('b', 50, 59, { task: 'Stack the cups' }),
          ],
        },
      },
    });
    control.frame = 20;
    expect(control.segments.createAtPlayhead()).toBe(true);
    const created = control.sent.find((change) => change.op === 'create');
    expect(created).toMatchObject({
      op: 'create',
      segment: { startFrame: 20, endFrame: 49, task: 'Fold the towel' },
    });
    // Only fields marked `inherit` carry over; the outcome is a judgement of its own.
    expect(created?.op === 'create' && created.segment.values).toEqual({
      task_other: 'Plier la serviette',
    });

    // After the last segment: the one before it is the nearest that ends before the range.
    control.frame = 60;
    await expect.poll(() => getEpisodeSegments(control.segments.doc, 0).length).toBe(3);
    expect(control.segments.createAtPlayhead()).toBe(true);
    await expect
      .poll(() => control.sent.filter((change) => change.op === 'create').at(-1))
      .toMatchObject({ segment: { startFrame: 60, task: 'Stack the cups' } });
  });

  it('F-02: in an episode with no segment, N keeps the episode task (null)', async () => {
    await mount({ episodes: { 0: { segments: [] } } });
    control.frame = 0;
    expect(control.segments.createAtPlayhead()).toBe(true);
    expect(control.sent[0]).toMatchObject({ op: 'create', segment: { task: null, values: {} } });
  });
});
