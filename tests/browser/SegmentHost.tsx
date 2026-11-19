import React, { useCallback, useMemo, useRef, useState } from 'react';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { applyChange, type AnnotationChange, type AnnotationDocument } from '@/core';
import type { LeRobotAnnotationSaveState } from '@/contexts/annotationTypes';
import type { LeRobotMessages } from '@/i18n/messageKeys';
import { FetchDataSource } from './fixtures';
import { FIXTURE, ctx, fields, type HostLog } from './segmentHarness';

/**
 * A host that persists changes after `delayMs` (late answers) or refuses
 * every change when `refuse` is set.
 */
export function Host({
  initial,
  log,
  delayMs = 0,
  refuse = false,
  readOnly = false,
  editable = true,
  dataset = FIXTURE,
}: {
  initial: AnnotationDocument;
  log: HostLog;
  delayMs?: number;
  refuse?: boolean;
  readOnly?: boolean;
  editable?: boolean;
  /** Dataset path served to the viewer (default: the 2 × 3-frame v3 fixture). */
  dataset?: string;
}) {
  const [value, setValue] = useState(initial);
  const [saveState, setSaveState] = useState<LeRobotAnnotationSaveState>({ kind: 'idle' });
  const valueRef = useRef(value);
  const next = useRef(0);
  log.value = () => valueRef.current;
  log.setValue = (doc) => {
    valueRef.current = doc;
    setValue(doc);
  };
  const onChange = useCallback(
    (change: AnnotationChange, meta: { changeId: string }) => {
      log.changes.push(change);
      if (refuse) {
        setSaveState({ kind: 'refused', message: 'Server says no', changeIds: [meta.changeId] });
        return;
      }
      setSaveState({ kind: 'saving' });
      const answer = () => {
        const result = applyChange(valueRef.current, change, ctx);
        if (!result.ok) {
          setSaveState({
            kind: 'refused',
            message: result.refusal.code,
            changeIds: [meta.changeId],
          });
          return;
        }
        valueRef.current = result.doc;
        setValue(result.doc);
        setSaveState({ kind: 'saved' });
      };
      if (delayMs > 0) setTimeout(answer, delayMs);
      else answer();
    },
    [delayMs, log, refuse],
  );
  const annotation = useMemo(
    () =>
      editable
        ? {
            value,
            onChange,
            saveState,
            createSegmentId: () => `new-${++next.current}`,
          }
        : { value },
    [editable, onChange, saveState, value],
  );
  return (
    <LeRobotViewer
      dataSource={useMemo(() => new FetchDataSource(dataset), [dataset])}
      language="en"
      annotation={annotation}
      readOnly={readOnly}
      fields={fields}
      messages={
        {
          'segments.progress': '{{confirmed}} of {{total}} reviewed',
          // Copy outside segments is the host's to rename too.
          'sidebar.episodesCount': '{count, plural, one {# take} other {# takes}}',
          // Standalone-app copy is not a host key: ignored.
          'seo.title': 'INTERNAL COPY',
        } as LeRobotMessages
      }
    />
  );
}
