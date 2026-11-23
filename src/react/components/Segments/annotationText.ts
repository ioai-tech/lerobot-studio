import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { SegmentOrigin } from '@/core';
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
      const text = t(notice.key, notice.values);
      if (!notice.detail) return text;
      // CJK sentences end in a full-width stop and take no space before the next.
      const joiner = /[。．！？]$/.test(text) ? '' : ' ';
      return `${text}${joiner}${t(notice.detail.key, notice.detail.values)}`;
    },
    [t],
  );
}

/**
 * Who made a segment, in words a reviewer reads: "Suggested", or with the
 * suggester's confidence as a percentage ("Suggested · 25% confidence"), never
 * a bare number (F-04). `null` for a person's segment.
 */
export function useOriginText() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  return useCallback(
    (origin: SegmentOrigin): string | null => {
      if (origin.kind !== 'suggested') return null;
      const { confidence } = origin;
      if (confidence == null || !Number.isFinite(confidence)) return t('segments.origin.suggested');
      let percent: string;
      try {
        percent = new Intl.NumberFormat(language, {
          style: 'percent',
          maximumFractionDigits: 0,
        }).format(Math.min(1, Math.max(0, confidence)));
      } catch {
        percent = `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`;
      }
      return t('segments.origin.suggestedConfidence', { confidence: percent });
    },
    [language, t],
  );
}
