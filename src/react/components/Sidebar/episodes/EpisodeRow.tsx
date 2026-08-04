import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckSquare, Pencil, Square, Trash2, Undo2 } from 'lucide-react';
import type { EpisodeMetadata } from '@/core';
import { Badge } from '@/ui';
import { Button } from '@/ui';
import { cn } from '@/ui';
import { isEpisodeRowActivationKey } from '@/core';

interface EpisodeRowProps {
  episode: EpisodeMetadata;
  taskDescription: string;
  formattedDuration: string;
  isDeleted: boolean;
  isSelected: boolean;
  isChecked: boolean;
  isLoading: boolean;
  multiSelectMode: boolean;
  showActions: boolean;
  onRowClick: () => void;
  onToggleSelection: (event: React.MouseEvent) => void;
  onEdit: (event: React.MouseEvent) => void;
  onDelete: (event: React.MouseEvent) => void;
  onRestore: (event: React.MouseEvent) => void;
}

export const EpisodeRow: React.FC<EpisodeRowProps> = ({
  episode,
  taskDescription,
  formattedDuration,
  isDeleted,
  isSelected,
  isChecked,
  isLoading,
  multiSelectMode,
  showActions,
  onRowClick,
  onToggleSelection,
  onEdit,
  onDelete,
  onRestore,
}) => {
  const { t } = useTranslation();
  const isInteractive = !isDeleted && !isLoading;
  const selectedActive = !isDeleted && isSelected;
  const checkedOnly = !isDeleted && !isSelected && isChecked;

  return (
    <div
      className={cn(
        'group relative flex w-full min-w-0 flex-col overflow-hidden border-b border-border/30 text-left transition-colors',
        isDeleted && 'bg-muted/30 opacity-60',
        selectedActive && 'bg-accent text-foreground',
        checkedOnly && 'bg-muted/60 text-muted-foreground',
        !isDeleted &&
          !isSelected &&
          !isChecked &&
          'bg-transparent text-muted-foreground/80 hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <div
        role="button"
        tabIndex={isInteractive ? 0 : -1}
        className={cn(
          'flex w-full px-3 py-2.5 min-w-0 flex-1 overflow-hidden rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
          multiSelectMode ? 'flex-row items-start gap-2' : 'flex-col',
        )}
        onClick={() => isInteractive && onRowClick()}
        onKeyDown={(e) => {
          if (!isInteractive) return;
          // Keep Space for global play/pause shortcut.
          if (isEpisodeRowActivationKey(e.key)) {
            e.preventDefault();
            onRowClick();
          }
        }}
        aria-label={t('sidebar.selectEpisode', { index: episode.episode_index })}
        aria-current={selectedActive ? 'true' : undefined}
        aria-disabled={!isInteractive}
        title={t('sidebar.selectEpisode', { index: episode.episode_index })}
      >
        {multiSelectMode && (
          <span className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="rounded border-0 bg-transparent p-0.5 hover:bg-muted/50"
              onClick={onToggleSelection}
              aria-label={
                isChecked
                  ? t('sidebar.deselectEpisode', 'Deselect episode')
                  : t('sidebar.selectEpisodeForBulk', 'Select episode')
              }
              title={
                isChecked
                  ? t('sidebar.deselectEpisode', 'Deselect episode')
                  : t('sidebar.selectEpisodeForBulk', 'Select episode')
              }
            >
              {isChecked ? (
                <CheckSquare className="h-4 w-4 text-primary" />
              ) : (
                <Square className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </span>
        )}
        {selectedActive && (
          <div className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-primary" />
        )}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="mb-1 flex min-w-0 items-center justify-between gap-2 overflow-hidden">
            <Badge
              variant={selectedActive ? 'default' : 'outline'}
              className={cn(
                'h-4 shrink-0 px-1.5 font-mono text-[10px] font-medium transition-colors',
                selectedActive
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : checkedOnly
                    ? 'border-border/60 bg-muted text-foreground/80'
                    : 'opacity-70',
              )}
            >
              # {episode.episode_index}
            </Badge>
            <span
              className={cn(
                'min-w-0 truncate font-mono text-[11px] transition-colors',
                selectedActive
                  ? 'font-medium text-foreground/80'
                  : checkedOnly
                    ? 'text-foreground/80'
                    : 'text-muted-foreground',
              )}
              title={formattedDuration}
            >
              {formattedDuration}
            </span>
          </div>
          <span
            className={cn(
              'block truncate text-xs font-normal leading-snug transition-colors',
              selectedActive
                ? 'font-medium text-foreground'
                : checkedOnly
                  ? 'text-foreground'
                  : 'text-muted-foreground',
            )}
            title={taskDescription}
          >
            {taskDescription}
          </span>
        </div>
      </div>

      {showActions && !multiSelectMode && (
        <div
          className="mx-2 mt-1 flex shrink-0 items-center gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          {isDeleted ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-muted-foreground hover:text-foreground"
              onClick={onRestore}
              title={t('sidebar.restoreEpisode', 'Restore episode')}
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-muted-foreground hover:text-foreground"
                onClick={onEdit}
                title={t('sidebar.editTask', 'Edit task')}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={onDelete}
                title={t('sidebar.deleteEpisode', 'Delete episode')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
