import React, { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Ban, CircleDot, CircleCheck, Lock } from 'lucide-react';
import {
  frameToInTime,
  frameToOutTime,
  getEpisodeSegments,
  matchesSegmentFilter,
  segmentIssueMarkers,
  segmentReviewDisplay,
  reviewProgress,
  type SegmentFilter,
} from '@/core';
import { cn } from '@/ui';
import { useLeRobotData, useLeRobotSegments } from '../../contexts/LeRobotContext';
import { onRadioGroupKeyDown, radioTabIndex } from './radioGroup';
import { REVIEW_TEXT } from './reviewDisplay';

const FILTER_KEYS: Record<SegmentFilter, string> = {
  all: 'segments.filter.all',
  to_review: 'segments.filter.toReview',
  issues: 'segments.filter.issues',
};

/** "N / M confirmed" with a bar, over the document's segments that are not excluded. */
export function SegmentProgress() {
  const { t } = useTranslation();
  const { doc } = useLeRobotSegments();
  const { confirmed, total, excluded } = reviewProgress(doc);
  if (total === 0 && excluded === 0) return null;
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid="lerobot-segment-progress">
      <span className="shrink-0 text-xs text-muted-foreground">
        {t('segments.progress', { confirmed, total })}
        {excluded > 0 ? ` · ${t('segments.progressExcluded', { count: excluded })}` : ''}
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
          style={{ width: `${total > 0 ? (confirmed / total) * 100 : 0}%` }}
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
  const listId = useId();
  const { info } = useLeRobotData();
  const segments = useLeRobotSegments();
  const fps = info?.fps || 30;
  const all = useMemo(
    () => getEpisodeSegments(segments.doc, episodeIndex),
    [episodeIndex, segments.doc],
  );
  const { markersOf } = segments;
  const episodeMarkers = useMemo(() => markersOf(episodeIndex), [episodeIndex, markersOf]);
  // The list is shown for the selected episode: the hook's filter in effect, counts and
  // offered filters (Issues only when it narrows the list, H-1712) are that episode's.
  const { filter, filterCounts: counts, offeredFilters: offered } = segments;
  const visible = all
    .map((segment, index) => ({ segment, number: index + 1 }))
    .filter(({ segment }) => matchesSegmentFilter(segment, filter, episodeMarkers));

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
            {offered.map((option, index) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={filter === option}
                tabIndex={radioTabIndex(filter === option, index, true)}
                className={cn(
                  'h-6 rounded-md border px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  filter === option
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
                onClick={() => segments.setFilter(option)}
              >
                {t(FILTER_KEYS[option])} {counts[option]}
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
        <ul
          className="min-h-0 overflow-y-auto pb-1"
          aria-label={t('segments.title')}
          data-focus-group=""
        >
          {visible.map(({ segment, number }) => {
            const selected = segment.id === segments.selectedSegmentId;
            const display = segmentReviewDisplay(segment);
            const time = `${frameToInTime(segment.startFrame, fps)}–${frameToOutTime(segment.endFrame, fps)}`;
            const reviewText = t(REVIEW_TEXT[display]);
            const markerIssues = segmentIssueMarkers(segment, episodeMarkers);
            // The row's label hides its content, so the badges are its description.
            const statusId = segment.status ? `${listId}-status-${number}` : null;
            const issuesId = markerIssues.length > 0 ? `${listId}-issues-${number}` : null;
            const describedBy = [statusId, issuesId].filter(Boolean).join(' ') || undefined;
            return (
              <li key={segment.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full min-w-0 flex-col gap-0.5 border-l-2 px-3 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60',
                    selected
                      ? 'border-primary bg-background text-foreground ring-1 ring-inset ring-border'
                      : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    display === 'excluded' &&
                      'bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(115,115,115,0.10)_6px_12px)]',
                  )}
                  data-review={display}
                  aria-current={selected ? 'true' : undefined}
                  data-focus-item=""
                  aria-label={t('segments.row', { n: number, time, review: reviewText })}
                  aria-describedby={describedBy}
                  onClick={() => segments.selectSegment(segment.id)}
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-xs">
                    {display === 'excluded' ? (
                      <Ban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    ) : display === 'to_review' ? (
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
                  <span
                    className={cn(
                      'truncate pl-5 text-xs',
                      display === 'excluded'
                        ? 'text-muted-foreground line-through'
                        : 'text-foreground/90',
                    )}
                  >
                    {segment.task ?? (
                      <span className="text-muted-foreground">{t('segments.inheritTask')}</span>
                    )}
                  </span>
                  {display === 'excluded' ||
                  segment.origin.kind === 'suggested' ||
                  segment.status ||
                  markerIssues.length > 0 ? (
                    <span
                      // Each badge stays on one line; a narrow row wraps whole badges (s10 F-27).
                      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 pl-5 text-[10px] text-muted-foreground [&>*]:whitespace-nowrap"
                      data-testid="lerobot-segment-row-badges"
                    >
                      {display === 'excluded' ? (
                        <span className="font-medium">{reviewText}</span>
                      ) : null}
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
                          id={statusId ?? undefined}
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
                      {markerIssues.length > 0 ? (
                        <span
                          id={issuesId ?? undefined}
                          className="inline-flex items-center gap-0.5 text-destructive"
                          title={markerIssues.map((marker) => marker.label).join('\n')}
                        >
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          {t('markers.issueCount', { count: markerIssues.length })}
                          <span className="sr-only">
                            {t('markers.issueList', {
                              labels: markerIssues.map((marker) => marker.label).join(', '),
                            })}
                          </span>
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
