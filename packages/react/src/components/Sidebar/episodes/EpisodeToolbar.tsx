import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCheck, Pencil, Trash2, Undo2, X } from 'lucide-react';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@ioai/lerobot-studio-ui';

interface EpisodeToolbarProps {
  selectedCount: number;
  selectedDeletedCount: number;
  selectedNonDeletedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkEdit: () => void;
  onBulkDelete: () => void;
  onBulkRestore: () => void;
}

export const EpisodeToolbar: React.FC<EpisodeToolbarProps> = ({
  selectedCount,
  selectedDeletedCount,
  selectedNonDeletedCount,
  onSelectAll,
  onClearSelection,
  onBulkEdit,
  onBulkDelete,
  onBulkRestore,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 overflow-hidden">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onSelectAll}
            />
          }
        >
          <CheckCheck className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('sidebar.selectAll')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onClearSelection}
            />
          }
        >
          <X className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('sidebar.clearSelection')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              disabled={selectedCount === 0}
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onBulkEdit}
            />
          }
        >
          <Pencil className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('sidebar.bulkEdit')}</TooltipContent>
      </Tooltip>
      {selectedNonDeletedCount > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                onClick={onBulkDelete}
              />
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('sidebar.bulkDelete')}</TooltipContent>
        </Tooltip>
      )}
      {selectedDeletedCount > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                disabled={selectedCount === 0}
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={onBulkRestore}
              />
            }
          >
            <Undo2 className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('sidebar.bulkRestore')}</TooltipContent>
        </Tooltip>
      )}

      {selectedCount > 0 && (
        <span className="ml-auto min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
          {t('sidebar.selectedCount', { count: selectedCount })}
        </span>
      )}
    </div>
  );
};
