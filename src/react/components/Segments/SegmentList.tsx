import React, { useEffect, useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Ban, CircleDot, CircleCheck, Lock } from 'lucide-react';
import {
  frameToInTime,
  frameToOutTime,
  getEpisodeSegments,
  matchesSegmentFilter,
  segmentIssueMarkers,
  segmentReviewDisplay,
  segmentTaskHint,
  reviewProgress,
  type SegmentFilter,
} from '@/core';
import { cn } from '@/ui';
import { useLeRobotData, useLeRobotSegments } from '../../contexts/LeRobotContext';
import { onRadioGroupKeyDown, radioTabIndex } from './radioGroup';
import { REVIEW_TEXT } from './reviewDisplay';
import { useOriginText } from './annotationText';

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
  const originText = useOriginText();
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
  const listRef = useRef<HTMLUListElement>(null);
  const { selectedSegmentId } = segments;
  // The selected row stays in view, and focus and selection never disagree
  // (F-18): when the selection moves (J / K, a confirm that goes on to the next
  // row) while another row of this list has focus, focus moves to the selected
  // row. Focus anywhere else is never taken.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !selectedSegmentId) return;
    const row = Array.from(list.querySelectorAll<HTMLElement>('[data-segment-id]')).find(
      (item) => item.dataset.segmentId === selectedSegmentId,
    );
    if (!row) return;
    const active = list.ownerDocument.activeElement;
    if (active instanceof HTMLElement && active !== row && list.contains(active)) {
      row.focus({ preventScroll: true });
    }
    // Scroll the list only, never the host page around the viewer.
    const rowBox = row.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    if (rowBox.top < listBox.top) list.scrollTop -= listBox.top - rowBox.top;
    else if (rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.bottom - listBox.bottom;
  }, [selectedSegmentId]);

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
          ref={listRef}
          className="min-h-0 overflow-y-auto pb-1"
          aria-label={t('segments.title')}
          data-focus-group=""
        >
          {visible.map(({ segment, number }) => {
            const selected = segment.id === segments.selectedSegmentId;
            const display = segmentReviewDisplay(segment);
            const hint = segmentTaskHint(segment);
            const time = `${frameToInTime(segment.startFrame, fps)}–${frameToOutTime(segment.endFrame, fps)}`;
            const reviewText = t(REVIEW_TEXT[display]);
            const markerIssues = segmentIssueMarkers(segment, episodeMarkers);
            // Who suggested it matters until a person confirmed it; then the
            // row no longer repeats it (the details keep it).
            const origin = display === 'confirmed' ? null : originText(segment.origin);
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
                  data-segment-id={segment.id}
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
                    {segment.task || (
                      // The host's hint (e.g. the task in another language) is
                      // display only, muted like the inherited-task copy it replaces.
                      <span
                        className="text-muted-foreground"
                        data-task-hint={hint ? '' : undefined}
                      >
                        {hint ?? t('segments.inheritTask')}
                      </span>
                    )}
                  </span>
                  {display === 'excluded' || origin || segment.status || markerIssues.length > 0 ? (
                    <span
                      // Each badge stays on one line; a narrow row wraps whole badges (s10 F-27).
                      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 pl-5 text-[10px] text-muted-foreground [&>*]:whitespace-nowrap"
                      data-testid="lerobot-segment-row-badges"
                    >
                      {display === 'excluded' ? (
                        <span className="font-medium">{reviewText}</span>
                      ) : null}
                      {origin ? <span>{origin}</span> : null}
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
