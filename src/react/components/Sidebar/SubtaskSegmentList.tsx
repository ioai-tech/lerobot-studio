import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui';
import { ScrollArea } from '@/ui';
import type { SubtaskCoverage, SubtaskSegment } from '@/core';
import { buildSubtaskTable, indexForSubtaskLabel } from '@/core';

export interface SubtaskSegmentListProps {
  segments: SubtaskSegment[];
  coverage: SubtaskCoverage;
  canAnnotate: boolean;
  knownLabels: string[];
  sourceAvailable?: boolean;
  onJump: (frameIndex: number) => void;
  onDelete: (index: number) => void;
}

export const SubtaskSegmentList: React.FC<SubtaskSegmentListProps> = ({
  segments,
  coverage,
  canAnnotate,
  knownLabels,
  sourceAvailable = false,
  onJump,
  onDelete,
}) => {
  const { t } = useTranslation();
  const table = buildSubtaskTable(knownLabels);

  if (coverage.totalFrames === 0) return null;
  if (!canAnnotate && segments.length === 0) return null;
  if (segments.length === 0 && !sourceAvailable) return null;

  return (
    <div className="border-t px-2 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t('subtask.listTitle', 'Subtasks')}
        </span>
        <span
          className="font-mono text-[10px] text-muted-foreground"
          title={t('subtask.coverage', {
            labeled: coverage.labeledFrames,
            total: coverage.totalFrames,
            defaultValue: '{{labeled}}/{{total}} frames labeled',
          })}
        >
          {coverage.labeledFrames}/{coverage.totalFrames}
        </span>
      </div>
      {segments.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {t('subtask.empty', 'No labeled subtasks on this episode')}
        </p>
      ) : (
        <ScrollArea className="max-h-36">
          <ul className="space-y-1">
            {segments.map((segment, index) => {
              const subtaskIndex = indexForSubtaskLabel(table, segment.label);
              return (
                <li
                  key={`${segment.startFrame}-${segment.endFrame}-${segment.label}`}
                  className="flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-1"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-[11px]"
                    onClick={() => onJump(segment.startFrame)}
                    title={segment.label}
                  >
                    <span className="mr-1 font-mono text-muted-foreground">
                      {subtaskIndex ?? '–'}
                    </span>
                    {segment.label}
                    <span className="ml-1 font-mono text-muted-foreground">
                      {segment.startFrame}–{segment.endFrame}
                    </span>
                  </button>
                  {canAnnotate ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1 text-[10px]"
                      onClick={() => onDelete(index)}
                    >
                      {t('common.delete', 'Delete')}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
      {canAnnotate && !coverage.complete && (sourceAvailable || segments.length > 0) ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t(
            'subtask.coverageIncomplete',
            'Unlabeled frames remain. v3.0 export needs every frame labeled; official -1 is treated as unlabeled.',
          )}
        </p>
      ) : null}
    </div>
  );
};
