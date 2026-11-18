import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyChange,
  classifyLeRobotVersion,
  getEpisodeSegments,
  type AnnotationChange,
  type AnnotationDocument,
  type EpisodeMetadata,
  type Segment,
} from '@/core';
import { useSegmentAnnotation, type SegmentAnnotationState } from '@/contexts/useSegmentAnnotation';
import type { LeRobotAnnotationSaveState } from '@/contexts/annotationTypes';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const episodes: EpisodeMetadata[] = [{ episode_index: 0, length: 100, tasks: ['pick'] }];
const versionCapability = classifyLeRobotVersion('v3.0');
const ctx = { episodeLength: (index: number) => (index === 0 ? 100 : undefined) };

function seg(id: string, startFrame: number, endFrame: number): Segment {
  return {
    id,
    startFrame,
    endFrame,
    task: null,
    subtasks: [],
    values: {},
    review: 'confirmed',
    origin: { kind: 'manual' },
  };
}

type Sent = { change: AnnotationChange; changeId: string };

/** A host driven by the test: it answers only when told to. */
type HostControl = {
  segments: SegmentAnnotationState;
  sent: Sent[];
  value: AnnotationDocument;
  /** Apply `changes` to the host value (the host accepted them). */
  accept: (...changes: AnnotationChange[]) => void;
  setValue: (value: AnnotationDocument) => void;
  setSaveState: (state: LeRobotAnnotationSaveState) => void;
  /** Called in a layout effect when the viewer's value changes (before its passive effects). */
  onValueCommitted: ((control: HostControl) => void) | null;
};

function Harness({ control, initial }: { control: HostControl; initial: AnnotationDocument }) {
  const [value, setValue] = useState(initial);
  const [saveState, setSaveState] = useState<LeRobotAnnotationSaveState>({ kind: 'idle' });
  const sent = useRef<Sent[]>([]);
  const ids = useRef(0);
  const segments = useSegmentAnnotation({
    episodes,
    selectedEpisodeIndex: 0,
    versionCapability,
    episodeEditMode: true,
    sourceSubtasks: [],
    getFrameIndex: () => 0,
    setFrameIndex: () => undefined,
    selectEpisode: async () => true,
  });
  const onChange = useCallback((change: AnnotationChange, meta?: { changeId: string }) => {
    sent.current.push({ change, changeId: meta?.changeId ?? `missing-${sent.current.length}` });
  }, []);
  const { configure } = segments;
  useLayoutEffect(() => {
    configure({
      annotation: { value, onChange, saveState, createSegmentId: () => `new-${++ids.current}` },
    });
  }, [configure, onChange, saveState, value]);
  Object.assign(control, {
    segments,
    sent: sent.current,
    value,
    setValue,
    setSaveState,
    accept: (...changes: AnnotationChange[]) =>
      setValue((current) =>
        changes.reduce((doc, change) => {
          const result = applyChange(doc, change, ctx);
          if (!result.ok) throw new Error(result.refusal.code);
          return result.doc;
        }, current),
      ),
  });
  // Runs right after the viewer's own value changed (its passive effects still pending).
  const viewerValue = segments.config.annotation?.value;
  useLayoutEffect(() => {
    if (viewerValue) control.onValueCommitted?.(control);
  }, [control, viewerValue]);
  return null;
}

const shown = (control: HostControl) => getEpisodeSegments(control.segments.doc, 0);
const task = (control: HostControl, id: string) =>
  shown(control).find((item) => item.id === id)?.task;
const update = (id: string, text: string): AnnotationChange => ({
  op: 'update',
  episodeIndex: 0,
  id,
  patch: { task: text },
});

describe('browser: host contract for changes in flight', () => {
  let host: HTMLDivElement;
  let root: Root;
  let control: HostControl;

  async function mount(initial: AnnotationDocument) {
    control = { onValueCommitted: null } as HostControl;
    root.render(<Harness control={control} initial={initial} />);
    await expect.poll(() => control.segments?.controlled).toBe(true);
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

  it('a reloaded value is authoritative: changes in flight it overrides are dropped', async () => {
    await mount({ episodes: { 0: { segments: [seg('a', 0, 9)] } } });
    expect(control.segments.dispatch([update('a', 'A')])).toBe(true);
    expect(
      control.segments.dispatch([{ op: 'create', episodeIndex: 0, segment: seg('c', 20, 29) }]),
    ).toBe(true);
    await expect.poll(() => shown(control).map((item) => item.id)).toEqual(['a', 'c']);
    // Another writer set task "B"; the host reloaded and could not keep the create.
    control.setValue({ episodes: { 0: { segments: [{ ...seg('a', 0, 9), task: 'B' }] } } });
    control.setSaveState({ kind: 'reloaded', message: 'Changed elsewhere' });
    await expect.poll(() => task(control, 'a')).toBe('B');
    expect(shown(control).map((item) => item.id)).toEqual(['a']);
    // The create's undo step (delete c) no longer applies: history was re-checked.
    expect(control.segments.canUndo).toBe(false);
    // Later edits are shown again (the reload applies once per value).
    expect(control.segments.dispatch([update('a', 'C')])).toBe(true);
    await expect.poll(() => task(control, 'a')).toBe('C');
  });

  it('a refusal names its change: one change of a multi-change step is refused', async () => {
    await mount({ episodes: { 0: { segments: [seg('a', 0, 9), seg('b', 10, 19)] } } });
    expect(control.segments.dispatch([update('a', 'x'), update('b', 'y')])).toBe(true);
    await expect.poll(() => task(control, 'b')).toBe('y');
    const [first, second] = control.sent;
    control.setSaveState({ kind: 'refused', message: 'no', changeIds: [second.changeId] });
    await expect.poll(() => task(control, 'b')).toBe(null);
    // The other change of the step is still in flight and shown.
    expect(task(control, 'a')).toBe('x');
    // The step cannot be undone partially: it left the history.
    expect(control.segments.canUndo).toBe(false);
    control.accept(first.change);
    await expect.poll(() => control.value.episodes[0].segments[0].task).toBe('x');
    expect(task(control, 'a')).toBe('x');
    // Re-rendering the same refusal (a new object, same ids) is harmless.
    expect(control.segments.dispatch([update('b', 'z')])).toBe(true);
    await expect.poll(() => task(control, 'b')).toBe('z');
    control.setSaveState({ kind: 'refused', message: 'no', changeIds: [second.changeId] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(task(control, 'b')).toBe('z');
  });

  it('a refusal for a change already dropped locally refuses nothing else', async () => {
    await mount({ episodes: { 0: { segments: [seg('a', 0, 9)] } } });
    expect(
      control.segments.dispatch([{ op: 'create', episodeIndex: 0, segment: seg('c', 20, 29) }]),
    ).toBe(true);
    const created = control.sent[0];
    // Another writer took that range: the create no longer applies and is dropped locally.
    control.setValue({ episodes: { 0: { segments: [seg('a', 0, 9), seg('w', 15, 35)] } } });
    await expect.poll(() => shown(control).map((item) => item.id)).toEqual(['a', 'w']);
    expect(control.segments.dispatch([update('a', 'later')])).toBe(true);
    await expect.poll(() => task(control, 'a')).toBe('later');
    control.setSaveState({ kind: 'refused', message: 'overlap', changeIds: [created.changeId] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The later change is untouched, and its undo step is the only one left.
    expect(task(control, 'a')).toBe('later');
    expect(control.segments.canUndo).toBe(true);
    expect(control.segments.undo()).toBe(true);
    await expect.poll(() => task(control, 'a')).toBe(null);
    expect(control.segments.canUndo).toBe(false);
  });

  it('a refusal that arrives before an earlier change is answered refuses only itself', async () => {
    await mount({ episodes: { 0: { segments: [seg('a', 0, 9), seg('b', 10, 19)] } } });
    expect(control.segments.dispatch([update('a', 'A')])).toBe(true);
    expect(control.segments.dispatch([update('b', 'B')])).toBe(true);
    await expect.poll(() => task(control, 'b')).toBe('B');
    const [first, second] = control.sent;
    control.setSaveState({ kind: 'refused', message: 'no', changeIds: [second.changeId] });
    await expect.poll(() => task(control, 'b')).toBe(null);
    expect(task(control, 'a')).toBe('A');
    control.accept(first.change);
    control.setSaveState({ kind: 'saved' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(task(control, 'a')).toBe('A');
    expect(control.segments.canUndo).toBe(true);
  });

  it('without ids a refusal still refuses the oldest change in flight', async () => {
    await mount({ episodes: { 0: { segments: [seg('a', 0, 9), seg('b', 10, 19)] } } });
    expect(control.segments.dispatch([update('a', 'A')])).toBe(true);
    expect(control.segments.dispatch([update('b', 'B')])).toBe(true);
    await expect.poll(() => task(control, 'b')).toBe('B');
    control.setSaveState({ kind: 'refused', message: 'no' });
    await expect.poll(() => task(control, 'a')).toBe(null);
    expect(task(control, 'b')).toBe('B');
  });

  it('a change sent between a host answer and its effects stays in flight', async () => {
    await mount({ episodes: { 0: { segments: [seg('a', 0, 9), seg('b', 10, 19)] } } });
    expect(control.segments.dispatch([update('a', 'A')])).toBe(true);
    // Right after the answer commits (before passive effects), another key press sends a change.
    control.onValueCommitted = (current) => {
      current.onValueCommitted = null;
      current.segments.dispatch([update('b', 'B')]);
    };
    control.accept(control.sent[0].change);
    await expect.poll(() => control.sent.length).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(task(control, 'a')).toBe('A');
    expect(task(control, 'b')).toBe('B');
  });
});
