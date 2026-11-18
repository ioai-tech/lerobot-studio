import React, { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from 'react';
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
import { useLeRobotData, useLeRobotSegments } from '../contexts/LeRobotContext';
import type { LeRobotAnnotationProps } from '../contexts/annotationTypes';
import type { LeRobotMessages } from '../i18n/messageKeys';
import type { AnnotationField } from '../../core/annotation/types';
import type { OverlaySegmentGroup, TimelineMarker } from '../../core/annotation/markers';
import type {
  LeRobotExtension,
  LeRobotInitialSelection,
  LeRobotSelection,
  LeRobotThemeTokens,
} from '../contexts/hostTypes';
import { HostChrome } from './Host/HostChrome';
import { SelectionBridge, type SelectionCarry } from './Host/SelectionBridge';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { ViewerLayout } from '../features/viewer/ViewerLayout';
import { ErrorState } from './Commons/ErrorState';
import { AuxiliarySeriesProvider } from '../contexts/AuxiliarySeriesContext';
import type {
  AuxiliarySeries,
  AuxiliarySeriesWarning,
} from '../../platform/services/auxiliarySeries';

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
  /**
   * Extra time series from separate parquet files, aligned by their own time
   * column and plotted with the dataset's charts on the same playhead (native
   * rate; drawn with min/max-per-pixel decimation). Single-dataset views only.
   */
  auxiliarySeries?: AuxiliarySeries[];
  /** Receives typed auxiliary-series warnings (missing column, read failure …). */
  onAuxiliarySeriesWarning?: (warning: AuxiliarySeriesWarning) => void;
  /**
   * Host-controlled segments: the viewer emits typed changes and shows
   * `value`. Omit for session-only editing (the standalone app's model).
   */
  annotation?: LeRobotAnnotationProps;
  /**
   * No edit control and no edit key, whatever else is set. With
   * `annotation={{ value }}` segments, review states and badges stay visible.
   */
  readOnly?: boolean;
  /** Fields shown in the segment inspector, in order (values live in `Segment.values`). */
  fields?: AnnotationField[];
  /** Host copy for built-in messages, e.g. to call segments "Episodes". */
  messages?: LeRobotMessages;
  /**
   * Ranges or ticks on the time axis by severity, with a tooltip. A segment
   * that overlaps a `warn` or `fail` marker is in the Issues filter.
   */
  markers?: TimelineMarker[];
  /**
   * Read-only segments in a thin band above the segment track (for example
   * another process's proposals); its legend is the `overlay.legend` message.
   */
  overlaySegments?: OverlaySegmentGroup[];
  /** Host toolbar items and notices, rendered in the viewer's style. */
  extensions?: LeRobotExtension[];
  /**
   * Where to open, applied once after the first load (a deep link). The
   * playhead lands paused on the frame that contains `timeS`.
   */
  initialSelection?: LeRobotInitialSelection;
  /**
   * Episode, segment and playhead time. Episode and segment changes are
   * reported at once; time at most four times a second.
   */
  onSelectionChange?: (selection: LeRobotSelection) => void;
  /** Host design tokens on the viewer root; light / dark still follows `theme`. */
  themeTokens?: LeRobotThemeTokens;
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
  auxiliarySeries,
  onAuxiliarySeriesWarning,
  annotation,
  readOnly,
  fields,
  markers,
  overlaySegments,
  extensions,
  initialSelection,
  onSelectionChange,
}: Omit<LeRobotViewerProps, 'theme' | 'language' | 'className' | 'messages' | 'themeTokens'> & {
  showSidebar: boolean;
  showPlaybackBar: boolean;
}) {
  const { t } = useTranslation();
  const { initialize, error, isLoading, clearError, setPendingSelection, getPendingSelection } =
    useLeRobotData();
  const hostChrome = useMemo(() => <HostChrome extensions={extensions} />, [extensions]);
  const { configure } = useLeRobotSegments();

  // Segment configuration lives in the data provider; push the props before paint.
  useLayoutEffect(() => {
    configure({ annotation, readOnly, fields, markers, overlaySegments });
  }, [annotation, configure, fields, markers, overlaySegments, readOnly]);

  /** Captures the current selection so a swap to the same timeline keeps it. */
  const captureSelectionRef = useRef<() => SelectionCarry | null>(() => null);
  const initialSelectionRef = useRef(initialSelection);
  initialSelectionRef.current = initialSelection;

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
      const previous = lastSourceRef.current;
      lastSourceRef.current = resolvedSource;
      if (previous === null) {
        // First load: the host's deep link, once.
        const initial = initialSelectionRef.current;
        setPendingSelection(initial ? { ...initial } : null);
      } else {
        // Another source: keep episode, segment and time when the timeline is the
        // same. A selection still on its way (a deep link) is carried as is.
        setPendingSelection(getPendingSelection() ?? captureSelectionRef.current());
      }
      void initialize(resolvedSource);
    }
  }, [resolvedSource, initialize, setPendingSelection, getPendingSelection]);

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
    <AuxiliarySeriesProvider series={auxiliarySeries} onWarning={onAuxiliarySeriesWarning}>
      <ViewerLayout
        showSidebar={showSidebar}
        showPlaybackBar={showPlaybackBar}
        showToaster={false}
        sidebar={<EpisodeSidebar />}
        sidebarHeader={sidebarHeader}
        hostChrome={extensions && extensions.length > 0 ? hostChrome : null}
        emptyState={emptyState}
        onRetry={handleRetry}
      />
      <SelectionBridge captureRef={captureSelectionRef} onSelectionChange={onSelectionChange} />
    </AuxiliarySeriesProvider>
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
  auxiliarySeries,
  onAuxiliarySeriesWarning,
  annotation,
  readOnly,
  fields,
  messages,
  markers,
  overlaySegments,
  extensions,
  initialSelection,
  onSelectionChange,
  themeTokens,
}) => {
  return (
    <LeRobotStudioProvider
      theme={theme}
      language={language}
      messages={messages}
      themeTokens={themeTokens}
      className={className}
      showToaster
    >
      <LeRobotViewerContent
        dataSource={dataSource}
        showSidebar={showSidebar}
        showPlaybackBar={showPlaybackBar}
        onFatalError={onFatalError}
        enableKeyboardShortcuts={enableKeyboardShortcuts}
        onBack={onBack}
        onExport={onExport}
        auxiliarySeries={auxiliarySeries}
        onAuxiliarySeriesWarning={onAuxiliarySeriesWarning}
        annotation={annotation}
        readOnly={readOnly}
        fields={fields}
        markers={markers}
        overlaySegments={overlaySegments}
        extensions={extensions}
        initialSelection={initialSelection}
        onSelectionChange={onSelectionChange}
      />
    </LeRobotStudioProvider>
  );
};
