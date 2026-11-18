import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui';
import { CHUNK_LOAD_FAILED, ChunkLoadError } from './chunkLoadError';

function ChunkLoadFailedNotice({ onRetry, retried }: { onRetry: () => void; retried: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      data-error-code={CHUNK_LOAD_FAILED}
      className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      <span>{t('lazyChunk.failed')}</span>
      <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onRetry}>
        <RotateCcw className="h-3 w-3" aria-hidden />
        {t('common.retry')}
      </Button>
      {retried ? (
        // A retry that failed too: the browser may keep the failed module
        // fetch, so a page reload is the remaining way back.
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => window.location.reload()}
        >
          {t('lazyChunk.reload')}
        </Button>
      ) : null}
    </div>
  );
}

/** Shows a failed chunk import as a named notice with a retry; other errors pass on. */
export class ChunkBoundary extends Component<
  {
    children: ReactNode;
    onRetry: () => void;
    /** The chunk failed again after a retry: also offer a page reload. */
    retried: boolean;
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (error instanceof ChunkLoadError) {
      console.error(`[lerobot-studio] ${CHUNK_LOAD_FAILED}`, error, info.componentStack);
    }
  }

  private retry = () => {
    this.props.onRetry();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // Only a failed import is this boundary's to show; anything else goes on
    // to the boundaries above, as it would without the chunk.
    if (!(error instanceof ChunkLoadError)) throw error;
    return <ChunkLoadFailedNotice onRetry={this.retry} retried={this.props.retried} />;
  }
}
