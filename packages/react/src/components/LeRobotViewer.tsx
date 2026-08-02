import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LeRobotStudioProvider } from './LeRobotStudioProvider';
import { EpisodeSidebar } from './Sidebar/EpisodeSidebar';
import { Button } from '@ioai/lerobot-studio-ui';
import { ArrowLeft, Download } from 'lucide-react';
import type { DataSource } from '@ioai/lerobot-studio-platform';
import {
  createArchiveDataSourceFromUrl,
  getArchiveKindFromUrl,
} from '@ioai/lerobot-studio-platform';
import {
  preflightRemoteArchive,
  translateRemotePreflightFailure,
} from '@ioai/lerobot-studio-platform';
import { useLeRobotData } from '../contexts/LeRobotContext';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { ViewerLayout } from '../features/viewer/ViewerLayout';
import { ErrorState } from './Commons/ErrorState';

export interface LeRobotViewerProps {
  dataSource: string | DataSource;
  theme?: 'light' | 'dark' | 'system';
  language?: string;
  showSidebar?: boolean;
  showPlaybackBar?: boolean;
  className?: string;
  onBack?: () => void;
  /** 当提供时，在侧栏返回按钮下方显示导出按钮，点击后触发。 */
  onExport?: () => void;
  /**
   * 严重错误回调：当数据源解析失败或加载失败（如 CORS / 网络错误）时触发。
   * 典型用法：宿主应用收到回调后清空 url query 并提示用户，而不是显示 lerobot 内置错误页。
   */
  onFatalError?: (errorMessage: string) => void;
  /**
   * 是否启用键盘快捷键（空格播放/暂停，方向键跳转帧等）
   * @default true
   */
  enableKeyboardShortcuts?: boolean;
}

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
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const lastFatalErrorRef = useRef<string | null>(error);

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
        setResolveError(t('common.error') + ': empty dataSource url');
        return;
      }

      const url = normalizeUrl(raw);

      setIsResolving(true);
      try {
        const pre = await preflightRemoteArchive(url);
        if (!pre.ok) {
          throw new Error(translateRemotePreflightFailure(t, pre.failure));
        }
        const kind = getArchiveKindFromUrl(url) || pre.kind;
        if (!kind) {
          throw new Error(t('validation.unsupportedFormat'));
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
        setResolveError(msg);
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
    if (!error && !resolveError) {
      lastFatalErrorRef.current = null;
    }
  }, [error, resolveError]);

  useEffect(() => {
    if (!onFatalError) return;
    const msg = resolveError || error;
    if (!msg) return;
    if (lastFatalErrorRef.current === msg) return;
    lastFatalErrorRef.current = msg;
    onFatalError(msg);
  }, [resolveError, error, onFatalError]);

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

  if (onFatalError && (resolveError || error)) {
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

  const emptyState =
    resolveError || error ? (
      <ErrorState
        title={t('common.error')}
        message={t('errors.loadFailed')}
        errorDetail={resolveError || error || undefined}
        onRetry={handleRetry}
      />
    ) : (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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
  theme = 'system',
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
