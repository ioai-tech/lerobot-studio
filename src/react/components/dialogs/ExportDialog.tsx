import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/ui';
import { Button } from '@/ui';
import { useLeRobotData, useLeRobotSelection } from '../../contexts/LeRobotContext';
import { detectPlatformCapabilities } from '@/platform';
import { ExportService } from '@/platform';
import { WebExportAdapter } from '@/platform';
import type { ExportFormat } from '@/core';
import type { ExportProgress } from '@/core';

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({ open, onOpenChange }) => {
  const { t } = useTranslation();
  const { dataLoader, info, tasks } = useLeRobotData();
  const { episodesForExport, modifiedEpisodes, deletedEpisodes } = useLeRobotSelection();

  const capabilities = React.useMemo(() => detectPlatformCapabilities(), []);
  const versionCapability = dataLoader?.getVersionCapability() ?? null;

  const defaultTargetVersion = useMemo((): 'v2.1' | 'v3.0' => {
    if (versionCapability?.adapterVersion === 'v3.0') return 'v3.0';
    return 'v2.1';
  }, [versionCapability?.adapterVersion]);

  const [format, setFormat] = useState<ExportFormat>('zip');
  const [targetVersion, setTargetVersion] = useState<'v2.1' | 'v3.0'>(defaultTargetVersion);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  React.useEffect(() => {
    setTargetVersion(defaultTargetVersion);
  }, [defaultTargetVersion]);

  const handleExport = useCallback(async () => {
    if (!dataLoader || !info) {
      setExportError(t('export.noData', 'No dataset loaded.'));
      return;
    }
    if (versionCapability?.status !== 'supported') {
      setExportError(
        t(
          'export.versionReadOnly',
          'This dataset version is not supported for export and can only be viewed.',
        ),
      );
      return;
    }
    setExportError(null);
    let directoryHandle: FileSystemDirectoryHandle | null = null;
    if (format === 'directory') {
      if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
        setExportError('File System Access API is not supported in this browser.');
        return;
      }
      try {
        directoryHandle = await (
          window as Window & {
            showDirectoryPicker: (o?: {
              mode?: 'read' | 'readwrite';
            }) => Promise<FileSystemDirectoryHandle>;
          }
        ).showDirectoryPicker({ mode: 'readwrite' });
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          return;
        }
        setExportError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    setProgress({
      phase: 'metadata',
      current: 0,
      total: 1,
      message: t('export.preparing', 'Preparing...'),
      cancelable: true,
      percent: 0,
    });
    const safeSetProgress = (p: ExportProgress) => {
      try {
        setProgress(p);
      } catch {
        // Ignore if component unmounted or React update fails
      }
    };
    try {
      const adapter = new WebExportAdapter(directoryHandle ? { directoryHandle } : undefined);
      const service = new ExportService(dataLoader, adapter);
      try {
        await service.exportWithData(info, episodesForExport, tasks, {
          format,
          targetVersion,
          onProgress: safeSetProgress,
          includeData: true,
          includeVideos: true,
          signal,
        });
        abortControllerRef.current = null;
        onOpenChange(false);
        setProgress(null);
      } catch (innerErr) {
        // Always release any in-memory files staged by the adapter so cancelled
        // or failed exports don't leave megabytes of data held in the closure.
        try {
          adapter.clear();
        } catch {
          /* ignore */
        }
        throw innerErr;
      }
    } catch (e) {
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      try {
        if (isAbort) {
          setExportError(t('export.cancelled', 'Export cancelled.'));
        } else {
          const msg =
            e instanceof Error
              ? e.message
              : typeof e === 'string'
                ? e
                : String(e ?? t('export.errorUnknown', 'Export failed'));
          setExportError(msg);
        }
      } finally {
        abortControllerRef.current = null;
        setProgress(null);
      }
    }
  }, [
    dataLoader,
    info,
    versionCapability?.status,
    episodesForExport,
    tasks,
    format,
    targetVersion,
    onOpenChange,
    t,
  ]);

  const handleClose = useCallback(() => {
    if (!progress) onOpenChange(false);
  }, [progress, onOpenChange]);

  const isExporting = progress !== null;
  const canExport =
    info && dataLoader && versionCapability?.status === 'supported' && episodesForExport.length > 0;

  const progressPercent = useMemo(() => {
    return (
      progress?.percent ??
      (progress && progress.total > 0 ? (progress.current / progress.total) * 100 : 0)
    );
  }, [progress]);

  const displayPercent = useMemo(() => {
    return Math.min(100, Math.max(0, progressPercent));
  }, [progressPercent]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('export.title', 'Export Dataset')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t(
              'export.a11yDescription',
              'Choose export format and target dataset version, then export to a file or folder.',
            )}
          </DialogDescription>
        </DialogHeader>
        {!isExporting ? (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">
                {t('export.format', 'Export Format')}
              </span>
              <div className="flex flex-wrap gap-2">
                {capabilities.supportedExportFormats.includes('zip') && (
                  <Button
                    variant={format === 'zip' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFormat('zip')}
                  >
                    ZIP
                  </Button>
                )}
                {capabilities.supportedExportFormats.includes('directory') && (
                  <Button
                    variant={format === 'directory' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFormat('directory')}
                  >
                    {t('export.directory', 'Local Directory')}
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">
                {t('export.targetVersion', 'Target Version')}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={targetVersion === 'v2.1' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTargetVersion('v2.1')}
                >
                  v2.1
                </Button>
                <Button
                  variant={targetVersion === 'v3.0' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTargetVersion('v3.0')}
                >
                  v3.0
                </Button>
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="font-medium mb-1">
                {t('export.changesSummary', 'Changes Summary')}
              </div>
              <ul className="space-y-0.5 text-muted-foreground">
                <li>
                  {t('export.modifiedCount', 'Modified')}: {modifiedEpisodes.size}
                </li>
                <li>
                  {t('export.deletedCount', 'Deleted')}: {deletedEpisodes.size}
                </li>
                <li>
                  {t('export.totalEpisodes', 'Total episodes')}: {episodesForExport.length}
                </li>
              </ul>
            </div>
            {exportError && <p className="text-sm text-destructive">{exportError}</p>}
            {versionCapability && versionCapability.status !== 'supported' && !exportError && (
              <p className="text-sm text-muted-foreground">
                {t(
                  'export.versionReadOnly',
                  'This dataset version is not supported for export and can only be viewed.',
                )}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3 py-2 min-w-0 overflow-hidden">
            <p className="text-sm font-medium break-words min-w-0">{progress?.message}</p>
            <div className="space-y-1.5 min-w-0">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${displayPercent}%` }}
                  role="progressbar"
                  aria-valuenow={Math.round(displayPercent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {progress?.percent != null
                  ? t('export.percentDone', '{{percent}}%', {
                      percent: Math.round(progress.percent),
                    })
                  : `${progress?.current ?? 0} / ${progress?.total ?? 0}`}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          {!isExporting ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button onClick={handleExport} disabled={!canExport}>
                {t('export.export', 'Export')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => abortControllerRef.current?.abort()}>
                {t('export.cancelExport', 'Cancel export')}
              </Button>
              <span className="text-sm text-muted-foreground self-center">
                {t('export.exporting', 'Exporting...')}
              </span>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
