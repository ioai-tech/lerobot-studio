import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/ui';

interface LoadFailureLineProps {
  /** The browser is offline: the line says so instead of naming the failure. */
  offline: boolean;
  /** The selected episode failed to load (otherwise another open of the shown viewer did). */
  episode: boolean;
  /** What failed, shown under the heading (not when offline). */
  detail: string;
  onRetry: () => void;
}

/**
 * The one line a shown viewer gives a load that failed (an episode, a source
 * swap): named, with its cause and Retry. It sits above the panels, so it
 * never covers a panel's title.
 */
export const LoadFailureLine: React.FC<LoadFailureLineProps> = ({
  offline,
  episode,
  detail,
  onRetry,
}) => {
  const { t } = useTranslation();
  const heading = offline
    ? t('errors.offlineShown')
    : episode
      ? t('errors.episodeLoadFailed')
      : t('errors.loadFailed');
  return (
    <div
      role="alert"
      data-testid="load-failure"
      className="flex shrink-0 items-start gap-2 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium">{heading}</p>
        {offline ? null : (
          <p className="break-words text-destructive/80" data-testid="load-failure-detail">
            {detail}
          </p>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 shrink-0 gap-1.5 text-xs"
        onClick={onRetry}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        {t('common.retry')}
      </Button>
    </div>
  );
};
