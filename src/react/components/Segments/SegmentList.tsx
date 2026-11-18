import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CircleDot, CircleCheck, Lock } from 'lucide-react';
import {
  frameToInTime,
  frameToOutTime,
  getEpisodeSegments,
  hasSegmentIssue,
  matchesSegmentFilter,
  reviewProgress,
  type SegmentFilter,
} from '@/core';
import { cn } from '@/ui';
import { useLeRobotData, useLeRobotSegments } from '../../contexts/LeRobotContext';
import { onRadioGroupKeyDown, radioTabIndex } from './radioGroup';

const FILTERS: SegmentFilter[] = ['all', 'to_review', 'issues'];
const FILTER_KEYS: Record<SegmentFilter, string> = {
  all: 'segments.filter.all',
  to_review: 'segments.filter.toReview',
  issues: 'segments.filter.issues',
};

/** "N / M confirmed" with a bar, over the whole document. */
export function SegmentProgress() {
  const { t } = useTranslation();
  const { doc } = useLeRobotSegments();
  const { confirmed, total } = reviewProgress(doc);
  if (total === 0) return null;
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid="lerobot-segment-progress">
      <span className="shrink-0 text-xs text-muted-foreground">
        {t('segments.progress', { confirmed, total })}
      </span>
      <div
        className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={t('segments.progressLabel')}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={confirmed}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${(confirmed / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Segments of one dataset episode: review progress, filters and one row per
 * segment. Selecting a row selects the segment and seeks to its start.
 */
export const SegmentList: React.FC<{ episodeIndex: number; showTitle?: boolean }> = ({
  episodeIndex,
  showTitle = true,
}) => {
  const { t } = useTranslation();
  const { info } = useLeRobotData();
  const segments = useLeRobotSegments();
  const fps = info?.fps || 30;
  const all = useMemo(
    () => getEpisodeSegments(segments.doc, episodeIndex),
    [episodeIndex, segments.doc],
  );
  const counts = useMemo(
    () => ({
      all: all.length,
      to_review: all.filter((item) => item.review === 'to_review').length,
      issues: all.filter(hasSegmentIssue).length,
    }),
    [all],
  );
  const visible = all
    .map((segment, index) => ({ segment, number: index + 1 }))
    .filter(({ segment }) => matchesSegmentFilter(segment, segments.filter));

  return (
    <section
      className="flex min-h-0 min-w-0 flex-col"
      aria-label={t('segments.title')}
      data-testid="lerobot-segment-list"
    >
      <div className="shrink-0 space-y-2 px-3 py-2">
        {showTitle ? (
          <h3 className="text-sm font-medium text-foreground">{t('segments.title')}</h3>
        ) : null}
        <SegmentProgress />
        {all.length > 0 ? (
          <div
            role="radiogroup"
            aria-label={t('segments.filter.label')}
            className="flex flex-wrap gap-1"
            onKeyDown={onRadioGroupKeyDown}
          >
            {FILTERS.map((filter, index) => (
              <button
                key={filter}
                type="button"
                role="radio"
                aria-checked={segments.filter === filter}
                tabIndex={radioTabIndex(segments.filter === filter, index, true)}
                className={cn(
                  'h-6 rounded-md border px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  segments.filter === filter
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-accent',
                )}
                onClick={() => segments.setFilter(filter)}
              >
                {t(FILTER_KEYS[filter])} {counts[filter]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {all.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-muted-foreground">
          {segments.canEdit ? t('segments.empty') : t('segments.emptyReadOnly')}
        </p>
      ) : visible.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-muted-foreground">{t('segments.emptyFilter')}</p>
      ) : (
        <ul className="min-h-0 overflow-y-auto pb-1" aria-label={t('segments.title')}>
          {visible.map(({ segment, number }) => {
            const selected = segment.id === segments.selectedSegmentId;
            const toReview = segment.review === 'to_review';
            const time = `${frameToInTime(segment.startFrame, fps)}–${frameToOutTime(segment.endFrame, fps)}`;
            const reviewText = t(
              toReview ? 'segments.review.toReview' : 'segments.review.confirmed',
            );
            return (
              <li key={segment.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full min-w-0 flex-col gap-0.5 border-l-2 px-3 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60',
                    selected
                      ? 'border-primary bg-background text-foreground ring-1 ring-inset ring-border'
                      : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                  aria-current={selected ? 'true' : undefined}
                  aria-label={t('segments.row', { n: number, time, review: reviewText })}
                  onClick={() => segments.selectSegment(segment.id)}
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-xs">
                    {toReview ? (
                      <CircleDot className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                    ) : (
                      <CircleCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                    )}
                    <span className="font-mono">#{number}</span>
                    <span className="font-mono tabular-nums">{time}</span>
                    {segment.readOnly ? (
                      <Lock className="h-3 w-3 shrink-0" aria-label={t('segments.readOnly')} />
                    ) : null}
                  </span>
                  <span className="truncate pl-5 text-xs text-foreground/90">
                    {segment.task ?? (
                      <span className="text-muted-foreground">{t('segments.inheritTask')}</span>
                    )}
                  </span>
                  {segment.origin.kind === 'suggested' || segment.status ? (
                    <span className="flex min-w-0 items-center gap-2 pl-5 text-[10px] text-muted-foreground">
                      {segment.origin.kind === 'suggested' ? (
                        <span>
                          {segment.origin.confidence != null
                            ? t('segments.origin.suggestedConfidence', {
                                confidence: segment.origin.confidence.toFixed(2),
                              })
                            : t('segments.origin.suggested')}
                        </span>
                      ) : null}
                      {segment.status ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-0.5',
                            segment.status.severity !== 'info' && 'text-destructive',
                          )}
                        >
                          {segment.status.severity !== 'info' ? (
                            <AlertTriangle className="h-3 w-3" aria-hidden />
                          ) : null}
                          {segment.status.label}
                          {segment.status.count != null ? ` ${segment.status.count}` : ''}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
