import { getEpisodeSegments } from './reducer';
import type { AnnotationDocument, AnnotationField } from './types';
import type { ExportSegment } from '../export/types';

/** Column prefix of host field values in exported `meta/episodes`. */
export const SEGMENT_FIELD_COLUMN_PREFIX = 'segment_';

export function segmentFieldColumn(fieldId: string): string {
  return `${SEGMENT_FIELD_COLUMN_PREFIX}${fieldId}`;
}

/**
 * Segments to export, keyed by source `episode_index`. Episodes without
 * segments are absent (exported whole). Declared field values become
 * `segment_<field id>` columns.
 */
export function annotationToExportSegments(
  doc: AnnotationDocument,
  fields: readonly AnnotationField[] = [],
): Map<number, ExportSegment[]> {
  const result = new Map<number, ExportSegment[]>();
  for (const key of Object.keys(doc.episodes)) {
    const episodeIndex = Number(key);
    const segments = getEpisodeSegments(doc, episodeIndex);
    if (segments.length === 0) continue;
    result.set(
      episodeIndex,
      segments.map((segment) => ({
        id: segment.id,
        startFrame: segment.startFrame,
        endFrame: segment.endFrame,
        task: segment.task,
        // Display hints (`taskHint`, `labelHint`) are never exported.
        subtasks: segment.subtasks.map(({ startFrame, endFrame, label }) => ({
          startFrame,
          endFrame,
          label,
        })),
        columns: Object.fromEntries(
          fields.map((field) => {
            const value = segment.values[field.id];
            return [
              segmentFieldColumn(field.id),
              Array.isArray(value) ? [...value] : (value ?? null),
            ];
          }),
        ),
      })),
    );
  }
  return result;
}
