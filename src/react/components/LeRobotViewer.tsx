import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LeRobotStudioProvider } from './LeRobotStudioProvider';
import { EpisodeSidebar } from './Sidebar/EpisodeSidebar';
import { Button } from '@/ui';
import { ArrowLeft, Download } from 'lucide-react';
import type { DataSource } from '../../core/datasource/types';
import {
  createArchiveDataSourceFromUrl,
  getArchiveKindFromUrl,
} from '../../platform/datasource/ArchiveDataSourceFactory';
import {
  preflightRemoteArchive,
  translateRemotePreflightFailure,
} from '../../platform/datasource/remotePreflight';
import { useLeRobotData } from '../contexts/LeRobotContext';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { ViewerLayout } from '../features/viewer/ViewerLayout';
import { ErrorState } from './Commons/ErrorState';

/** Stable error categories reported to an embedding host. */
export type LeRobotViewerErrorCode =
  | 'INVALID_DATA_SOURCE'
  | 'REMOTE_SOURCE_UNAVAILABLE'
  | 'UNSUPPORTED_ARCHIVE'
  | 'DATASET_LOAD_FAILED';

/** A fatal viewer error that requires host action or an explicit retry. */
export interface LeRobotViewerError {
  /** Machine-readable category. */
  code: LeRobotViewerErrorCode;
  /** Localized message suitable for display. */
  message: string;
  /** Whether retrying the same operation may succeed. */
  recoverable: boolean;
  /** Original failure when one is available. */
  cause?: unknown;
}

/** Properties for the stable, client-only LeRobot dataset viewer. */
export interface LeRobotViewerProps {
  /** Remote archive URL or a custom browser data source. */
  dataSource: string | DataSource;
  /** Viewer color scheme. @defaultValue 'system' */
  theme?: 'light' | 'dark' | 'system';
  /** BCP 47 language tag. Built-in messages currently cover en, zh, and ja. */
  language?: string;
  /** Show the episode sidebar. @defaultValue true */
  showSidebar?: boolean;
  /** Show playback controls. @defaultValue true */
  showPlaybackBar?: boolean;
  /** Additional class name applied to the scoped viewer root. */
  className?: string;
  /** Optional host-owned navigation action. */
  onBack?: () => void;
  /** Optional host-owned export action; the npm viewer does not export data itself. */
  onExport?: () => void;
  /**
   * Receives fatal source or dataset loading failures. When provided, the host
   * owns fatal-error rendering and the built-in fatal state is not rendered.
   */
  onFatalError?: (error: LeRobotViewerError) => void;
  /**
   * Enable viewer keyboard shortcuts such as Space and arrow-key seeking.
   * @defaultValue true
   */
  enableKeyboardShortcuts?: boolean;
}

/** Viewer without the provider wrapper; render inside `LeRobotStudioProvider`. */
export function LeRobotViewerContent({
  dataSource,
  showSidebar = true,
  showPlaybackBar = true,
  onFatalError,
  enableKeyboardShortcuts = true,
  onBack,
  onExport,
}: Omit<LeRobotViewerProps, 'theme' | 'language' | 'className'> & {
  showSidebar: boolean;
  showPlaybackBar: boolean;
}) {
  const { t } = useTranslation();
  const { initialize, error, isLoading, clearError } = useLeRobotData();

  useKeyboardShortcuts(enableKeyboardShortcuts);

  const lastSourceRef = useRef<DataSource | null>(null);
  const [resolvedSource, setResolvedSource] = useState<DataSource | null>(null);
  const [resolveError, setResolveError] = useState<LeRobotViewerError | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const lastFatalErrorRef = useRef<string | null>(null);
  const fatalError = useMemo<LeRobotViewerError | null>(
    () =>
      resolveError ??
      (error
        ? {
            code: 'DATASET_LOAD_FAILED',
            message: error,
            recoverable: true,
          }
        : null),
    [error, resolveError],
  );

  const normalizeUrl = (raw: string) => {
    try {
      return new URL(raw, window.location.href).toString();
    } catch {
      return raw;
    }
  };

  useEffect(() => {
    let cancelled = false;
    clearError();

    const run = async () => {
      setResolveError(null);
      setIsResolving(false);

      if (typeof dataSource !== 'string') {
        setResolvedSource(dataSource);
        return;
      }

      const raw = dataSource.trim();
      if (!raw) {
        setResolvedSource(null);
        setResolveError({
          code: 'INVALID_DATA_SOURCE',
          message: `${t('common.error')}: empty dataSource url`,
          recoverable: false,
        });
        return;
      }

      const url = normalizeUrl(raw);

      setIsResolving(true);
      try {
        const pre = await preflightRemoteArchive(url);
        if (!pre.ok) {
          setResolvedSource(null);
          setResolveError({
            code: 'REMOTE_SOURCE_UNAVAILABLE',
            message: translateRemotePreflightFailure(t, pre.failure),
            recoverable: true,
          });
          return;
        }
        const kind = getArchiveKindFromUrl(url) || pre.kind;
        if (!kind) {
          setResolvedSource(null);
          setResolveError({
            code: 'UNSUPPORTED_ARCHIVE',
            message: t('validation.unsupportedFormat'),
            recoverable: false,
          });
          return;
        }
        if (cancelled) return;
        setResolvedSource(
          createArchiveDataSourceFromUrl(url, undefined, kind, {
            accessMode: pre.accessMode,
          }),
        );
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setResolvedSource(null);
        setResolveError({
          code: 'REMOTE_SOURCE_UNAVAILABLE',
          message: msg,
          recoverable: true,
          cause: e,
        });
      } finally {
        if (!cancelled) setIsResolving(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [dataSource, t, clearError]);

  useEffect(() => {
    if (resolvedSource && lastSourceRef.current !== resolvedSource) {
      lastSourceRef.current = resolvedSource;
      void initialize(resolvedSource);
    }
  }, [resolvedSource, initialize]);

  useEffect(() => {
    if (!fatalError) {
      lastFatalErrorRef.current = null;
    }
  }, [fatalError]);

  useEffect(() => {
    if (!onFatalError || !fatalError) return;
    const key = `${fatalError.code}:${fatalError.message}`;
    if (lastFatalErrorRef.current === key) return;
    lastFatalErrorRef.current = key;
    onFatalError(fatalError);
  }, [fatalError, onFatalError]);

  const handleRetry = useCallback(() => {
    clearError();
    lastSourceRef.current = null;
    setResolveError(null);
    if (resolvedSource) {
      lastSourceRef.current = resolvedSource;
      void initialize(resolvedSource);
      return;
    }
    // Force re-resolve from the original prop
    setResolvedSource(null);
    if (typeof dataSource !== 'string') {
      setResolvedSource(dataSource);
    }
  }, [clearError, resolvedSource, initialize, dataSource]);

  if (onFatalError && fatalError) {
    // The embedding host owns fatal-error rendering via onFatalError. Keeping a
    // spinner mounted here made permanent failures indistinguishable from load.
    return null;
  }

  const sidebarHeader =
    onBack || onExport ? (
      <div className="flex flex-row items-center justify-between gap-2 h-9 px-2 border-b border-border/30 bg-background/50 backdrop-blur-sm">
        {onBack ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 justify-start gap-1.5 rounded-md hover:bg-accent/60 hover:text-foreground transition-all duration-200"
            onClick={onBack}
            aria-label={t('common.back')}
            title={t('common.back')}
          >
            <ArrowLeft className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors shrink-0" />
            <span className="text-xs font-medium truncate">{t('common.back')}</span>
          </Button>
        ) : (
          <span className="flex-1 min-w-0" aria-hidden />
        )}
        {onExport ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 justify-end gap-1.5 rounded-md hover:bg-accent/60 hover:text-foreground transition-all duration-200"
            onClick={onExport}
            aria-label={t('navbar.export', 'Export')}
            title={t('navbar.export', 'Export')}
          >
            <Download className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors shrink-0" />
            <span className="text-xs font-medium truncate">{t('navbar.export', 'Export')}</span>
          </Button>
        ) : (
          <span className="flex-1 min-w-0" aria-hidden />
        )}
      </div>
    ) : null;

  const emptyState = fatalError ? (
    <ErrorState
      title={t('common.error')}
      message={t('errors.loadFailed')}
      errorDetail={fatalError.message}
      onRetry={handleRetry}
    />
  ) : (
    <div
      className="w-full h-full flex items-center justify-center text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <div
          className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin motion-reduce:animate-none"
          aria-hidden
        />
        <span className="text-sm">
          {isResolving || isLoading ? t('common.initializing') : t('common.loading')}
        </span>
      </div>
    </div>
  );

  return (
    <ViewerLayout
      showSidebar={showSidebar}
      showPlaybackBar={showPlaybackBar}
      showToaster={false}
      sidebar={<EpisodeSidebar />}
      sidebarHeader={sidebarHeader}
      emptyState={emptyState}
      onRetry={handleRetry}
    />
  );
}

export const LeRobotViewer: React.FC<LeRobotViewerProps> = ({
  dataSource,
  theme,
  language,
  showSidebar = true,
  showPlaybackBar = true,
  className,
  onFatalError,
  enableKeyboardShortcuts = true,
  onBack,
  onExport,
}) => {
  return (
    <LeRobotStudioProvider theme={theme} language={language} className={className} showToaster>
      <LeRobotViewerContent
        dataSource={dataSource}
        showSidebar={showSidebar}
        showPlaybackBar={showPlaybackBar}
        onFatalError={onFatalError}
        enableKeyboardShortcuts={enableKeyboardShortcuts}
        onBack={onBack}
        onExport={onExport}
      />
    </LeRobotStudioProvider>
  );
};
