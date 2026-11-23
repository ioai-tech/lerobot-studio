import React, { useState, useCallback, useMemo, useRef, useEffect, useId } from 'react';
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
import {
  useLeRobotData,
  useLeRobotSegments,
  useLeRobotSelection,
} from '../../contexts/LeRobotContext';
import { canUseFileSystemAccess, detectPlatformCapabilities } from '@/platform';
import { ExportService } from '@/platform';
import { WebExportAdapter } from '@/platform';
import type { ExportFormat } from '@/core';
import type { ExportProgress } from '@/core';
import { SubtaskCoverageError, annotationToExportSegments, episodeNumber } from '@/core';

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({ open, onOpenChange }) => {
  const { t } = useTranslation();
  const fieldId = useId();
  const { dataLoader, info, tasks, subtasks } = useLeRobotData();
  const { episodesForExport, modifiedEpisodes, deletedEpisodes } = useLeRobotSelection();
  const { doc, fields } = useLeRobotSegments();
  // Each kept segment is exported as its own episode; episodes without segments stay whole.
  const exportSegments = useMemo(() => annotationToExportSegments(doc, fields), [doc, fields]);
  const segmentSummary = useMemo(() => {
    let segmentCount = 0;
    let episodesWithSegments = 0;
    let keptFrames = 0;
    for (const episode of episodesForExport) {
      const list = exportSegments.get(episode.episode_index);
      if (!list?.length) {
        keptFrames += episode.length;
        continue;
      }
      episodesWithSegments += 1;
      segmentCount += list.length;
      keptFrames += list.reduce((sum, item) => sum + item.endFrame - item.startFrame + 1, 0);
    }
    const outputEpisodes = episodesForExport.length - episodesWithSegments + segmentCount;
    const originalFrames = episodesForExport.reduce((sum, episode) => sum + episode.length, 0);
    return { segmentCount, episodesWithSegments, keptFrames, outputEpisodes, originalFrames };
  }, [episodesForExport, exportSegments]);

  const capabilities = useMemo(() => detectPlatformCapabilities(), []);
  const versionCapability = dataLoader?.getVersionCapability() ?? null;

  const defaultTargetVersion = useMemo((): 'v2.1' | 'v3.0' => {
    if (versionCapability?.adapterVersion === 'v3.0') return 'v3.0';
    return 'v2.1';
  }, [versionCapability?.adapterVersion]);

  const [format, setFormat] = useState<ExportFormat>('zip');
  const [targetVersion, setTargetVersion] = useState<'v2.1' | 'v3.0'>(defaultTargetVersion);
  const [includeSubtasks, setIncludeSubtasks] = useState(false);
  const [fillSubtaskGaps, setFillSubtaskGaps] = useState(false);
  const [compactVideos, setCompactVideos] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setTargetVersion(defaultTargetVersion);
  }, [defaultTargetVersion]);

  useEffect(() => {
    if (!open) return;
    setIncludeSubtasks(false);
    setFillSubtaskGaps(false);
    setExportError(null);
  }, [open]);

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
      if (!canUseFileSystemAccess()) {
        setExportError(
          t(
            'source.insecureOriginExportDirectory',
            'Exporting to a folder requires HTTPS or localhost.',
          ),
        );
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
          compactVideos,
          segments: exportSegments,
          includeSubtasks: targetVersion === 'v3.0' && includeSubtasks,
          fillSubtaskGaps: targetVersion === 'v3.0' && includeSubtasks && fillSubtaskGaps,
          signal,
          sourceSubtasks: subtasks,
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
        } else if (e instanceof SubtaskCoverageError) {
          const segmentNumber = e.segmentId
            ? (exportSegments.get(e.episodeIndex)?.findIndex((item) => item.id === e.segmentId) ??
                -1) + 1
            : 0;
          setExportError(
            segmentNumber > 0
              ? t('export.subtaskCoverageSegment', {
                  number: episodeNumber(e.episodeIndex),
                  index: e.episodeIndex,
                  n: segmentNumber,
                  labeled: e.coverage.labeledFrames,
                  total: e.coverage.totalFrames,
                })
              : e.coverage.labeledFrames === 0
                ? t('export.subtaskCoverageMissing', 'Episode #{{number}} has no subtask labels.', {
                    number: episodeNumber(e.episodeIndex),
                    index: e.episodeIndex,
                  })
                : t(
                    'export.subtaskCoverageIncomplete',
                    'Episode #{{number}} is missing labels ({{labeled}}/{{total}}).',
                    {
                      number: episodeNumber(e.episodeIndex),
                      index: e.episodeIndex,
                      labeled: e.coverage.labeledFrames,
                      total: e.coverage.totalFrames,
                    },
                  ),
          );
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
    subtasks,
    exportSegments,
    format,
    targetVersion,
    includeSubtasks,
    fillSubtaskGaps,
    compactVideos,
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
                  onClick={() => {
                    setTargetVersion('v2.1');
                    setIncludeSubtasks(false);
                  }}
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
            {targetVersion === 'v3.0' ? (
              <div className="space-y-1">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    id={`${fieldId}-include-subtasks`}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                    checked={includeSubtasks}
                    onChange={(event) => setIncludeSubtasks(event.target.checked)}
                  />
                  <span>{t('export.includeSubtasks', 'Include subtasks')}</span>
                </label>
                {includeSubtasks ? (
                  <label className="ml-5 flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      id={`${fieldId}-fill-subtask-gaps`}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                      checked={fillSubtaskGaps}
                      onChange={(event) => setFillSubtaskGaps(event.target.checked)}
                    />
                    <span>{t('export.fillSubtaskGaps')}</span>
                  </label>
                ) : null}
              </div>
            ) : null}
            {targetVersion === 'v3.0' && versionCapability?.adapterVersion === 'v3.0' ? (
              <div className="space-y-1 text-sm">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    id={`${fieldId}-compact-videos`}
                    className="mt-0.5 accent-primary"
                    checked={compactVideos}
                    onChange={(event) => setCompactVideos(event.target.checked)}
                  />
                  <span>{t('export.compactVideos', 'Remove unused video segments (slower)')}</span>
                </label>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'export.sharedVideoHint',
                    'Fast export copies shared videos without re-encoding. Deleted episodes and trimmed frames are excluded from the exported data, but their footage may remain in shared files. Enable this option to physically remove unused segments.',
                  )}
                </p>
              </div>
            ) : null}
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
                  {t('export.segmentSummary', {
                    count: segmentSummary.segmentCount,
                    episodes: segmentSummary.episodesWithSegments,
                  })}
                </li>
                <li>
                  {t('export.totalEpisodes', 'Total episodes')}: {segmentSummary.outputEpisodes}
                </li>
              </ul>
              {targetVersion === 'v3.0' && includeSubtasks && !fillSubtaskGaps ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('export.subtaskCoverageHint', 'Every exported episode must be fully labeled.')}
                </p>
              ) : null}
            </div>
            {segmentSummary.segmentCount > 0 ? (
              <p className="text-xs text-muted-foreground" role="status">
                {t('export.segmentFrames', {
                  original: segmentSummary.originalFrames,
                  kept: segmentSummary.keptFrames,
                })}
              </p>
            ) : null}
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
