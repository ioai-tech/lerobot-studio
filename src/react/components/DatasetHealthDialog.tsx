import React, { useMemo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/ui';
import { Button } from '@/ui';
import { ScrollArea } from '@/ui';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui';
import { DatasetHealthTable } from './DatasetHealthTable';
import { translateTerm } from './validationI18n';
import type { ValidationReport } from '@/core';
import { AlertCircle, CheckCircle2, AlertTriangle, Download } from 'lucide-react';
import { cn } from '@/ui';

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv(
  report: ValidationReport,
  headers: { field: string; current: string; expected: string; suggestion: string },
  t: (key: string, defaultOrOptions?: string | Record<string, unknown>) => string,
): string {
  const rows = [
    [headers.field, headers.current, headers.expected, headers.suggestion],
    ...report.items.map((item) => {
      const current = translateTerm(t, item.current) || item.current || '';
      const expected = translateTerm(t, item.expected) || item.expected || '';
      const suggestion = item.code
        ? t(`health.validation.codes.${item.code}.suggestion`, {
            ...(item.suggestionValues as Record<string, string | number> | undefined),
            defaultMessage: item.suggestion,
          })
        : (item.suggestion ?? '');
      return [item.field ?? '', current, expected, suggestion].map(escapeCsvCell);
    }),
  ];
  return '\uFEFF' + rows.map((r) => r.join(',')).join('\r\n');
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface DatasetHealthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ValidationReport | null;
}

type ValidationLevelFilter = 'all' | 'error' | 'warning' | 'info';

export const DatasetHealthDialog: React.FC<DatasetHealthDialogProps> = ({
  open,
  onOpenChange,
  report,
}) => {
  const { t } = useTranslation();
  const [levelFilter, setLevelFilter] = useState<ValidationLevelFilter>('all');

  const { hasError, hasWarning, errorCount, warningCount, passedCount } = useMemo(() => {
    if (!report)
      return { hasError: false, hasWarning: false, errorCount: 0, warningCount: 0, passedCount: 0 };
    const items = report.items;
    const errorCount = items.filter((i) => i.level === 'error').length;
    const warningCount = items.filter((i) => i.level === 'warning').length;
    const passedCount = items.filter((i) => i.level === 'info').length;
    return {
      hasError: report.hasError,
      hasWarning: report.hasWarning,
      errorCount,
      warningCount,
      passedCount,
    };
  }, [report]);

  const summaryMessage = hasError
    ? t('health.validation.dialog.summaryErrors')
    : hasWarning
      ? t('health.validation.dialog.summaryWarnings')
      : t('health.validation.dialog.summaryOk');

  const filteredItems = useMemo(() => {
    if (levelFilter === 'all') return report?.items ?? [];
    return report?.items.filter((item) => item.level === levelFilter) ?? [];
  }, [levelFilter, report]);

  useEffect(() => {
    if (!open) setLevelFilter('all');
  }, [open]);

  const toggleLevelFilter = useCallback((level: Exclude<ValidationLevelFilter, 'all'>) => {
    setLevelFilter((current) => (current === level ? 'all' : level));
  }, []);

  const handleExportCsv = useCallback(() => {
    if (!report?.items?.length) return;
    const headers = {
      field: t('health.validation.columns.field'),
      current: t('health.validation.columns.current'),
      expected: t('health.validation.columns.expected'),
      suggestion: t('health.validation.columns.suggestion'),
    };
    const csv = buildCsv(report, headers, t);
    downloadCsv(csv, 'dataset-health-report.csv');
  }, [report, t]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setLevelFilter('all');
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] sm:max-w-[80vw] h-[85vh] max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="space-y-0 flex flex-row items-center justify-start gap-4 w-full px-6 py-4 border-b border-border shrink-0">
          <DialogTitle className="text-lg font-semibold">
            {t('health.validation.dialog.title')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t(
              'health.validation.dialog.a11yDescription',
              'Review dataset validation results and export a CSV report.',
            )}
          </DialogDescription>
          <div className="flex items-center gap-4">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={!report?.items?.length}
                  />
                }
              >
                <Download className="h-4 w-4" />
                {t('health.validation.dialog.export', 'Export')}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportCsv}>
                  {t('health.validation.dialog.exportCsv', 'Export as CSV')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </DialogHeader>

        <div
          className={cn(
            'px-6 py-3 flex items-center gap-3 shrink-0 border-b border-border',
            hasError && 'bg-destructive/10 border-destructive/30',
            !hasError && hasWarning && 'bg-amber-500/10 border-amber-500/30',
            !hasError && !hasWarning && 'bg-green-500/10 border-green-500/30',
          )}
        >
          {hasError ? (
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
          ) : hasWarning ? (
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500 shrink-0" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-500 shrink-0" />
          )}
          <span className="font-medium">{summaryMessage}</span>
          {report && (
            <span className="text-muted-foreground text-sm">
              {errorCount > 0 && (
                <button
                  type="button"
                  className={cn(
                    'rounded-sm cursor-pointer underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    levelFilter === 'error' && 'font-semibold text-destructive underline',
                  )}
                  aria-pressed={levelFilter === 'error'}
                  aria-label={t('health.validation.dialog.filterErrors', { count: errorCount })}
                  onClick={() => toggleLevelFilter('error')}
                >
                  {t('health.validation.dialog.errorsCount', { count: errorCount })}
                </button>
              )}
              {errorCount > 0 && warningCount > 0 && ' · '}
              {warningCount > 0 && (
                <button
                  type="button"
                  className={cn(
                    'rounded-sm cursor-pointer underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    levelFilter === 'warning' &&
                      'font-semibold text-amber-700 underline dark:text-amber-400',
                  )}
                  aria-pressed={levelFilter === 'warning'}
                  aria-label={t('health.validation.dialog.filterWarnings', { count: warningCount })}
                  onClick={() => toggleLevelFilter('warning')}
                >
                  {t('health.validation.dialog.warningsCount', { count: warningCount })}
                </button>
              )}
              {(errorCount > 0 || warningCount > 0) && passedCount > 0 && ' · '}
              {passedCount > 0 && (
                <button
                  type="button"
                  className={cn(
                    'rounded-sm cursor-pointer underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    levelFilter === 'info' &&
                      'font-semibold text-green-700 underline dark:text-green-400',
                  )}
                  aria-pressed={levelFilter === 'info'}
                  aria-label={t('health.validation.dialog.filterPassed', { count: passedCount })}
                  onClick={() => toggleLevelFilter('info')}
                >
                  {t('health.validation.dialog.passedCount', { count: passedCount })}
                </button>
              )}
            </span>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <ScrollArea className="flex-1 h-full">
            <div className="px-6 py-4">
              <DatasetHealthTable items={filteredItems} />
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
};
