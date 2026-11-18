/**
 * The segment inspector, list and dialogs load as their own chunk, only when
 * segments are in use (a plain viewer never downloads them).
 */
import { lazyChunk } from '../Commons/lazyChunk';

export const LazySegmentInspector = lazyChunk(
  async () => (await import('./SegmentInspector')).SegmentInspector,
);

export const LazySegmentList = lazyChunk(async () => (await import('./SegmentList')).SegmentList);

export const LazySegmentDialogs = lazyChunk(
  async () => (await import('./SegmentDialogs')).SegmentDialogs,
);
