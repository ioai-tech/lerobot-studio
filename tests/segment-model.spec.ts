import { describe, expect, it } from 'vitest';
import {
  annotationToExportSegments,
  clipSubtasksToRange,
  fieldOptionForKey,
  formatSegmentTime,
  frameToInTime,
  frameToOutTime,
  inTimeToFrame,
  nearerEdge,
  newSegmentRangeAt,
  nextUncoveredFrame,
  outTimeToFrame,
  parseSegmentTime,
  reviewProgress,
  uncoveredRanges,
  type AnnotationField,
  type EpisodeMetadata,
  type Segment,
} from '@/core';
import { buildSegmentExportPlan } from '../src/platform/export/SegmentExportPlan';
import {
  SEGMENT_SHORTCUTS,
  isSegmentShortcutTarget,
  matchFieldOptionKey,
  matchSegmentShortcut,
} from '../src/react/hooks/segmentShortcuts';
import { LEROBOT_MESSAGE_KEYS } from '../src/react/i18n/messageKeys';
import en from '../src/react/locales/en.json';
import zh from '../src/react/locales/zh.json';
import ja from '../src/react/locales/ja.json';

function seg(
  id: string,
  startFrame: number,
  endFrame: number,
  extra: Partial<Segment> = {},
): Segment {
  return {
    id,
    startFrame,
    endFrame,
    task: null,
    subtasks: [],
    values: {},
    review: 'confirmed',
    origin: { kind: 'manual' },
    ...extra,
  };
}

describe('segment time fields', () => {
  it.each([10, 15, 30, 50, 60])('In / Out round-trip every frame at %i fps', (fps) => {
    for (let frame = 0; frame < fps * 3; frame++) {
      expect(inTimeToFrame(frameToInTime(frame, fps), fps)).toBe(frame);
      expect(outTimeToFrame(frameToOutTime(frame, fps), fps)).toBe(frame);
    }
  });

  it('neighbouring segments share a boundary time', () => {
    expect(frameToOutTime(1424, 30)).toBe(frameToInTime(1425, 30));
    expect(frameToInTime(1410, 30)).toBe('0:47.00');
    expect(formatSegmentTime(3725.5)).toBe('1:02:05.50');
  });

  it('parses seconds, m:ss and h:mm:ss and refuses anything else', () => {
    expect(parseSegmentTime('47')).toBe(47);
    expect(parseSegmentTime('47.5')).toBe(47.5);
    expect(parseSegmentTime(' 1:14.50 ')).toBeCloseTo(74.5);
    expect(parseSegmentTime('1:02:05.5')).toBeCloseTo(3725.5);
    for (const bad of ['', 'abc', '1:75', '-3', '1::2', '1.2.3']) {
      expect(parseSegmentTime(bad)).toBeNull();
    }
  });
});

describe('segment queries', () => {
  const segments = [seg('a', 10, 19), seg('b', 40, 49, { review: 'to_review' })];

  it('new segment runs from the playhead to the next boundary', () => {
    expect(newSegmentRangeAt(segments, 0, 100)).toEqual({ startFrame: 0, endFrame: 9 });
    expect(newSegmentRangeAt(segments, 25, 100)).toEqual({ startFrame: 25, endFrame: 39 });
    expect(newSegmentRangeAt(segments, 60, 100)).toEqual({ startFrame: 60, endFrame: 99 });
    expect(newSegmentRangeAt(segments, 15, 100)).toBeNull();
  });

  it('G finds the next uncovered frame, wrapping', () => {
    expect(uncoveredRanges(segments, 100)).toEqual([
      { startFrame: 0, endFrame: 9 },
      { startFrame: 20, endFrame: 39 },
      { startFrame: 50, endFrame: 99 },
    ]);
    expect(nextUncoveredFrame(segments, 12, 100)).toBe(20);
    expect(nextUncoveredFrame(segments, 60, 100)).toBe(0);
    expect(nextUncoveredFrame([seg('all', 0, 99)], 5, 100)).toBeNull();
  });

  it('progress counts every segment of the document', () => {
    expect(
      reviewProgress({ episodes: { 0: { segments }, 3: { segments: [seg('c', 0, 1)] } } }),
    ).toEqual({ confirmed: 2, total: 3 });
  });

  it('nearer edge and subtask clipping', () => {
    expect(nearerEdge(seg('a', 10, 30), 12)).toBe('start');
    expect(nearerEdge(seg('a', 10, 30), 28)).toBe('end');
    expect(
      clipSubtasksToRange(
        [
          { startFrame: 0, endFrame: 5, label: 'a' },
          { startFrame: 6, endFrame: 20, label: 'b' },
        ],
        { startFrame: 3, endFrame: 10 },
      ),
    ).toEqual([
      { startFrame: 3, endFrame: 5, label: 'a' },
      { startFrame: 6, endFrame: 10, label: 'b' },
    ]);
  });
});

describe('field option keys', () => {
  const fields: AnnotationField[] = [
    { id: 'tags', label: 'Tags', kind: 'tags' },
    {
      id: 'outcome',
      label: 'Outcome',
      kind: 'select',
      options: [
        { value: 'success', label: 'Success', key: '1' },
        { value: 'failure', label: 'Failure', key: '2' },
        { value: 'partial', label: 'Partial', key: '3' },
      ],
    },
  ];

  it('maps digits to the declaring select option', () => {
    expect(fieldOptionForKey(fields, '2')).toEqual({ field: fields[1], value: 'failure' });
    expect(fieldOptionForKey(fields, '7')).toBeNull();
    expect(fieldOptionForKey(undefined, '1')).toBeNull();
  });

  it('reads digits from the physical key and ignores modified digits', () => {
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
    expect(matchFieldOptionKey(key({ key: '1', code: 'Digit1' }))).toBe('1');
    expect(matchFieldOptionKey(key({ key: '3', code: 'Numpad3' }))).toBe('3');
    expect(matchFieldOptionKey(key({ key: '1', code: 'Digit1', ctrlKey: true }))).toBeNull();
    expect(matchFieldOptionKey(key({ key: '!', code: 'Digit1', shiftKey: true }))).toBeNull();
    expect(matchFieldOptionKey(key({ key: '0', code: 'Digit0' }))).toBeNull();
  });
});

describe('segment keys', () => {
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

  it.each([
    [{ key: 'a', code: 'KeyA' }, 'confirm'],
    [{ key: 'A', code: 'KeyA', shiftKey: true }, 'confirmAll'],
    [{ key: 'r', code: 'KeyR' }, 'delete'],
    [{ key: 'Delete', code: 'Delete' }, 'delete'],
    [{ key: 's', code: 'KeyS' }, 'split'],
    [{ key: 'm', code: 'KeyM' }, 'merge'],
    [{ key: '[', code: 'BracketLeft' }, 'setIn'],
    [{ key: ']', code: 'BracketRight' }, 'setOut'],
    [{ key: '{', code: 'BracketLeft', shiftKey: true }, 'subtaskStart'],
    [{ key: '}', code: 'BracketRight', shiftKey: true }, 'subtaskEnd'],
    [{ key: ',', code: 'Comma' }, 'nudgeBack'],
    [{ key: '.', code: 'Period' }, 'nudgeForward'],
    [{ key: '≤', code: 'Comma', altKey: true }, 'nudgeBackSecond'],
    [{ key: '≥', code: 'Period', altKey: true }, 'nudgeForwardSecond'],
    [{ key: 'n', code: 'KeyN' }, 'new'],
    [{ key: 'g', code: 'KeyG' }, 'nextUncovered'],
    [{ key: 'j', code: 'KeyJ' }, 'next'],
    [{ key: 'k', code: 'KeyK' }, 'previous'],
    [{ key: 'l', code: 'KeyL' }, 'loop'],
    [{ key: 'z', code: 'KeyZ', ctrlKey: true }, 'undo'],
    [{ key: 'z', code: 'KeyZ', metaKey: true }, 'undo'],
    [{ key: 'Z', code: 'KeyZ', metaKey: true, shiftKey: true }, 'redo'],
    [{ key: '?', code: 'Slash', shiftKey: true }, 'help'],
  ] as const)('%o → %s', (init, id) => {
    expect(matchSegmentShortcut(key(init))).toBe(id);
  });

  it('never binds Ctrl/Cmd+K and ignores unrelated keys', () => {
    expect(matchSegmentShortcut(key({ key: 'k', code: 'KeyK', ctrlKey: true }))).toBeNull();
    expect(matchSegmentShortcut(key({ key: 'k', code: 'KeyK', metaKey: true }))).toBeNull();
    expect(matchSegmentShortcut(key({ key: 'x', code: 'KeyX' }))).toBeNull();
    expect(matchSegmentShortcut(key({ key: 'ArrowLeft', code: 'ArrowLeft' }))).toBeNull();
  });

  it('every key in the table has a label in every locale', () => {
    for (const shortcut of SEGMENT_SHORTCUTS) {
      for (const locale of [en, zh, ja]) {
        expect(
          (locale.segments.actions as Record<string, string>)[shortcut.id],
          `${shortcut.id}`,
        ).toBeTruthy();
      }
    }
  });

  it('acts only inside the viewer root and never while typing or in a dialog', () => {
    const element = (tagName: string, attrs: Record<string, string> = {}, inDialog = false) => ({
      nodeType: 1,
      tagName,
      isContentEditable: attrs.contenteditable === 'true',
      getAttribute: (name: string) => attrs[name] ?? null,
      closest: () => (inDialog ? {} : null),
    });
    const inside = new Set<unknown>();
    const root = { contains: (node: unknown) => inside.has(node) };
    const button = element('BUTTON');
    const slider = element('DIV', { role: 'slider' });
    const input = element('INPUT');
    const textbox = element('DIV', { role: 'textbox' });
    const editable = element('DIV', { contenteditable: 'true' });
    const dialogButton = element('BUTTON', {}, true);
    const outside = element('BUTTON');
    [button, slider, input, textbox, editable, dialogButton].forEach((item) => inside.add(item));
    expect(isSegmentShortcutTarget(button, root)).toBe(true);
    expect(isSegmentShortcutTarget(slider, root)).toBe(true);
    expect(isSegmentShortcutTarget(input, root)).toBe(false);
    expect(isSegmentShortcutTarget(textbox, root)).toBe(false);
    expect(isSegmentShortcutTarget(editable, root)).toBe(false);
    expect(isSegmentShortcutTarget(dialogButton, root)).toBe(false);
    expect(isSegmentShortcutTarget(outside, root)).toBe(false);
    expect(isSegmentShortcutTarget(null, root)).toBe(false);
    expect(isSegmentShortcutTarget(button, null)).toBe(false);
  });
});

describe('host messages', () => {
  function flatten(input: Record<string, unknown>, prefix: string): string[] {
    return Object.entries(input).flatMap(([key, value]) =>
      value && typeof value === 'object'
        ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
        : [`${prefix}${key}`],
    );
  }

  it('the overridable keys are exactly the segment messages, present in every locale', () => {
    expect([...LEROBOT_MESSAGE_KEYS].sort()).toEqual(flatten(en.segments, 'segments.').sort());
    expect(flatten(zh.segments, 'segments.').sort()).toEqual([...LEROBOT_MESSAGE_KEYS].sort());
    expect(flatten(ja.segments, 'segments.').sort()).toEqual([...LEROBOT_MESSAGE_KEYS].sort());
  });
});

describe('segment export plan', () => {
  const episodes: EpisodeMetadata[] = [
    { episode_index: 0, length: 100, tasks: ['long take'] },
    { episode_index: 1, length: 40, tasks: ['short'] },
  ];
  const fields: AnnotationField[] = [
    {
      id: 'outcome',
      label: 'Outcome',
      kind: 'select',
      options: [{ value: 'success', label: 'S' }],
    },
    { id: 'tags', label: 'Tags', kind: 'tags' },
    { id: 'note', label: 'Note', kind: 'text' },
  ];

  it('expands each kept segment into its own episode; episodes without segments stay whole', async () => {
    const segments = annotationToExportSegments(
      {
        episodes: {
          0: {
            segments: [
              seg('b', 60, 89, { values: { tags: [] } }),
              seg('a', 10, 29, {
                task: 'pick',
                values: { outcome: 'success', tags: ['clean'] },
                subtasks: [{ startFrame: 10, endFrame: 29, label: 'reach' }],
              }),
            ],
          },
          1: { segments: [] },
        },
      },
      fields,
    );
    const calls: Array<[string, number]> = [];
    const loader = {
      getEpisodeTableForExport: async (index: number) => {
        calls.push(['table', index]);
        return { table: {}, pathHint: '' };
      },
      getEpisodeVideoPath: (index: number) => {
        calls.push(['video', index]);
        return null;
      },
      readFileBytes: async () => new Uint8Array(),
      loadFeatureData: async (index: number) => {
        calls.push(['feature', index]);
        return {};
      },
      loadEpisodeSubtaskSource: async (index: number) => {
        calls.push(['subtasks', index]);
        return { indices: [], table: {} };
      },
      loadEpisodeSubtaskIndices: async () => [],
      getSubtasks: () => ({}),
    } as never;
    const plan = buildSegmentExportPlan(loader, episodes, segments);
    expect(plan.expanded).toBe(true);
    expect(plan.episodes.map((episode) => episode.episode_index)).toEqual([0, 2, 1]);
    expect(plan.episodes.map((episode) => plan.sourceIndexOf(episode.episode_index))).toEqual([
      0, 0, 1,
    ]);
    expect(plan.segmentIdOf(0)).toBe('a');
    expect(plan.segmentIdOf(2)).toBe('b');
    expect(plan.trimRanges.get(0)).toEqual({ startFrame: 10, endFrame: 29 });
    expect(plan.trimRanges.get(2)).toEqual({ startFrame: 60, endFrame: 89 });
    expect(plan.trimRanges.has(1)).toBe(false);
    expect(plan.subtasks.get(0)).toEqual([{ startFrame: 10, endFrame: 29, label: 'reach' }]);
    expect(plan.subtasks.get(2)).toEqual([]);
    // Task: the segment's own, or the source episode's when null.
    expect(plan.episodes[0].tasks).toEqual(['pick']);
    expect(plan.episodes[1].tasks).toEqual(['long take']);
    // Field columns only where a value exists anywhere; null elsewhere.
    expect(plan.episodes[0]).toMatchObject({ segment_outcome: 'success', segment_tags: ['clean'] });
    expect(plan.episodes[1]).toMatchObject({ segment_outcome: null, segment_tags: [] });
    expect(plan.episodes[2]).toMatchObject({ segment_outcome: null, segment_tags: null });
    expect(plan.episodes[0]).not.toHaveProperty('segment_note');
    // Reads go to the source episode.
    await plan.loader.getEpisodeTableForExport(2);
    plan.loader.getEpisodeVideoPath(2, 'cam');
    await plan.loader.loadFeatureData(2, ['x']);
    await plan.loader.loadEpisodeSubtaskSource(1);
    expect(calls).toEqual([
      ['table', 0],
      ['video', 0],
      ['feature', 0],
      ['subtasks', 1],
    ]);
  });

  it('zero segments export exactly as before', () => {
    const loader = {} as never;
    const plan = buildSegmentExportPlan(loader, episodes, new Map());
    expect(plan.expanded).toBe(false);
    expect(plan.loader).toBe(loader);
    expect(plan.episodes).toEqual(episodes);
  });

  it('refuses segments outside their episode or overlapping', () => {
    const one = (startFrame: number, endFrame: number) => ({
      id: `${startFrame}`,
      startFrame,
      endFrame,
      task: null,
      subtasks: [],
      columns: {},
    });
    expect(() =>
      buildSegmentExportPlan({} as never, episodes, new Map([[1, [one(30, 40)]]])),
    ).toThrow(/outside episode 1/);
    expect(() =>
      buildSegmentExportPlan({} as never, episodes, new Map([[0, [one(0, 10), one(10, 20)]]])),
    ).toThrow(/overlap/);
  });
});
