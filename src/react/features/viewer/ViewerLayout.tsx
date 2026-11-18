import React, { Suspense, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/ui';
import { ResizableSidebar } from '../../components/Sidebar/ResizableSidebar';
import { PlaybackBar } from '../../components/Playback/PlaybackBar';
import { Toaster } from '../../components/ui/toaster';
import { useLeRobotData } from '../../contexts/LeRobotContext';
import { useLoading } from '../../contexts/LoadingContext';
import { ErrorState } from '../../components/Commons/ErrorState';
import { useStackedLayout } from '../../hooks/useStackedLayout';
import { SegmentDialogs } from '../../components/Segments/SegmentDialogs';

const loadDockviewLayout = () => import('../../components/DockviewLayout');
const LazyDockviewLayout = React.lazy(async () => {
  const mod = await loadDockviewLayout();
  return { default: mod.DockviewLayout };
});

export type ViewerLayoutProps = {
  showSidebar?: boolean;
  showPlaybackBar?: boolean;
  className?: string;
  /** Sidebar content when data is loaded. Defaults to EpisodeSidebar via caller. */
  sidebar?: ReactNode;
  /** Main empty/welcome content when no dataset is loaded and no active task/error. */
  emptyState?: ReactNode;
  /** Optional chrome above the sidebar (back/export buttons, etc.). */
  sidebarHeader?: ReactNode;
  /** When true, show Toaster inside the layout. */
  showToaster?: boolean;
  onRetry?: () => void;
};

/**
 * Shared viewer shell: optional sidebar + dockview panels + playback bar.
 * Used by the embedded library viewer and the standalone web app.
 */
export function ViewerLayout({
  showSidebar = true,
  showPlaybackBar = true,
  className,
  sidebar,
  emptyState,
  sidebarHeader,
  showToaster = true,
  onRetry,
}: ViewerLayoutProps) {
  const { t } = useTranslation();
  const { episodes, info, clearError, error } = useLeRobotData();
  const { tasks } = useLoading();
  const layoutRef = useRef<HTMLDivElement>(null);
  const stacked = useStackedLayout(layoutRef);

  const hasData = info !== null && episodes.length > 0;
  const shouldShowSidebar = hasData && showSidebar && Boolean(sidebar);

  const activeTask = tasks.find(
    (task) => task.phase !== 'ready' && task.phase !== 'idle' && task.phase !== 'error',
  );
  const errorTask = tasks.find((task) => task.phase === 'error');

  // Fetch the panel layout (cameras, charts) while the dataset metadata loads,
  // not after it: it is on the critical path to the first frame.
  const loadingSomething = Boolean(activeTask) || info !== null;
  useEffect(() => {
    if (loadingSomething) void loadDockviewLayout().catch(() => undefined);
  }, [loadingSomething]);

  const handleRetry =
    onRetry ??
    (() => {
      clearError();
    });

  const sidebarElement = shouldShowSidebar ? (
    <ResizableSidebar
      key="sidebar"
      orientation={stacked ? 'vertical' : 'horizontal'}
      defaultWidth={256}
      minWidth={200}
      maxWidth={600}
      handleLabel={t('sidebar.resizeHandle')}
      className="min-w-0 overflow-hidden"
    >
      {sidebarHeader}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">{sidebar}</div>
    </ResizableSidebar>
  ) : null;

  const mainElement = (
    <div key="main" className="flex-1 flex flex-col min-w-0 min-h-0">
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden relative">
        {info ? (
          <>
            {error ? (
              <div className="absolute inset-x-0 top-0 z-10 px-3 py-2 text-xs bg-destructive/10 text-destructive border-b border-destructive/20">
                {error}
              </div>
            ) : null}
            <Suspense
              fallback={
                <div
                  className="w-full h-full flex items-center justify-center text-muted-foreground bg-background/50 backdrop-blur-sm z-50"
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin motion-reduce:animate-none"
                        aria-hidden
                      />
                      <span className="text-sm font-medium">{t('common.loadingLayout')}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{t('common.firstLoadNote')}</p>
                  </div>
                </div>
              }
            >
              <LazyDockviewLayout />
            </Suspense>
          </>
        ) : activeTask ? (
          <div
            className="w-full h-full flex items-center justify-center text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <div className="flex flex-col items-center gap-4 max-w-md text-center px-6">
              <div
                className="h-10 w-10 border-4 border-primary border-t-transparent rounded-full animate-spin motion-reduce:animate-none"
                aria-hidden
              />
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-foreground">
                  {t(`loading.phase.${activeTask.phase}`)}
                </h3>
                <p className="text-sm text-muted-foreground animate-pulse motion-reduce:animate-none">
                  {activeTask.message || t('common.loading')}
                </p>
              </div>
            </div>
          </div>
        ) : errorTask ? (
          <ErrorState
            title={t('common.error')}
            message={t('errors.loadFailed')}
            errorDetail={errorTask.error || undefined}
            onRetry={handleRetry}
          />
        ) : (
          (emptyState ?? (
            <div
              className="w-full h-full flex items-center justify-center text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <div className="text-center">
                <p>{t('common.loading')}</p>
              </div>
            </div>
          ))
        )}
      </div>
      {showPlaybackBar && hasData && <PlaybackBar />}
    </div>
  );

  return (
    <div
      ref={layoutRef}
      className={cn(
        '@container/viewer flex flex-col h-full w-full min-h-0 overflow-hidden',
        className,
      )}
      data-testid="lerobot-viewer-layout"
      data-layout={stacked ? 'stacked' : 'split'}
    >
      {/*
       * Below 640px of container width the episode sidebar stacks under the
       * player so the video, timeline and transport keep the full width. The
       * keyed children are reordered (not remounted), so DOM and focus order
       * always match the visual order.
       */}
      <div className={cn('flex flex-1 min-h-0 overflow-hidden', stacked && 'flex-col')}>
        {stacked ? [mainElement, sidebarElement] : [sidebarElement, mainElement]}
      </div>

      {hasData ? <SegmentDialogs /> : null}
      {showToaster ? <Toaster /> : null}
    </div>
  );
}
