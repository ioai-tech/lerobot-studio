import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnnotationNotice } from '../../contexts/useSegmentAnnotation';

/** Translate the status-line notice (refusals carry a typed code). */
export function useNoticeText() {
  const { t } = useTranslation();
  return useCallback(
    (notice: AnnotationNotice | null): string | null => {
      if (!notice) return null;
      if (notice.refusal) {
        return t(`segments.refusal.${notice.refusal.code}`, notice.refusal.message);
      }
      return t(notice.key, notice.values);
    },
    [t],
  );
}
