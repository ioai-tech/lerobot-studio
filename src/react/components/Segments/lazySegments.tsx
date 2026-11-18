/**
 * The segment inspector, list and dialogs load as their own chunk, only when
 * segments are in use (a plain viewer never downloads them).
 */
import React, { Suspense } from 'react';

const SegmentInspectorChunk = React.lazy(async () => ({
  default: (await import('./SegmentInspector')).SegmentInspector,
}));
const SegmentListChunk = React.lazy(async () => ({
  default: (await import('./SegmentList')).SegmentList,
}));
const SegmentDialogsChunk = React.lazy(async () => ({
  default: (await import('./SegmentDialogs')).SegmentDialogs,
}));

export function LazySegmentInspector() {
  return (
    <Suspense fallback={null}>
      <SegmentInspectorChunk />
    </Suspense>
  );
}

export function LazySegmentList(props: { episodeIndex: number; showTitle?: boolean }) {
  return (
    <Suspense fallback={null}>
      <SegmentListChunk {...props} />
    </Suspense>
  );
}

export function LazySegmentDialogs() {
  return (
    <Suspense fallback={null}>
      <SegmentDialogsChunk />
    </Suspense>
  );
}
