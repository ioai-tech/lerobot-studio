import type { SegmentReviewDisplay } from '@/core';

/** Words of each review display (`segmentReviewDisplay`), shared by the track, list and inspector. */
export const REVIEW_TEXT = {
  to_review: 'segments.review.toReview',
  confirmed: 'segments.review.confirmed',
  excluded: 'segments.review.excluded',
} as const satisfies Record<SegmentReviewDisplay, string>;

/** Track block per display. Excluded is greyed and hatched: never the confirmed (primary) or to-review (amber) look. */
export const TRACK_LOOK: Record<SegmentReviewDisplay, string> = {
  to_review:
    'border-amber-500/70 bg-amber-400/25 text-foreground bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgba(245,158,11,0.18)_4px_8px)]',
  confirmed: 'border-primary/60 bg-primary/25 text-foreground',
  excluded:
    'border-dashed border-muted-foreground/60 bg-muted text-muted-foreground line-through bg-[repeating-linear-gradient(135deg,transparent_0_3px,rgba(115,115,115,0.28)_3px_6px)]',
};

/** Inspector badge per display. */
export const BADGE_LOOK: Record<SegmentReviewDisplay, string> = {
  to_review: 'bg-amber-400/25 text-amber-800 dark:text-amber-300',
  confirmed: 'bg-primary/15 text-primary',
  excluded: 'bg-muted text-muted-foreground line-through',
};
