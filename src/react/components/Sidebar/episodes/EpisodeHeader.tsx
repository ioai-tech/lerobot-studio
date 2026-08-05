import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CheckSquare, Pencil } from 'lucide-react';
import { Button } from '@/ui';
import { cn } from '@/ui';

interface EpisodeHeaderProps {
  totalCount?: number;
  editMode: boolean;
  multiSelectMode: boolean;
  isReadOnly: boolean;
  onToggleEditMode: () => void;
  onToggleMultiSelectMode: () => void;
}

export const EpisodeHeader: React.FC<EpisodeHeaderProps> = ({
  totalCount,
  editMode,
  multiSelectMode,
  isReadOnly,
  onToggleEditMode,
  onToggleMultiSelectMode,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 overflow-hidden">
      <h2 className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground overflow-hidden">
        {totalCount != null && <span>{totalCount}</span>}
        <span>Episodes</span>
      </h2>

      {!isReadOnly && (
        <div className="flex min-w-0 flex-wrap items-center gap-1 overflow-hidden">
          <Button
            variant={multiSelectMode ? 'secondary' : 'ghost'}
            size="sm"
            className={cn(
              'h-7 shrink-0 px-1 text-xs font-medium',
              multiSelectMode
                ? 'text-pink-400 hover:text-pink-700'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={onToggleMultiSelectMode}
            title={t('sidebar.multiSelect', 'Select')}
          >
            {multiSelectMode ? (
              <>
                <Check className="h-3 w-3 shrink-0" />
                {t('sidebar.multiSelect', 'Select')}
              </>
            ) : (
              <>
                <CheckSquare className="h-3 w-3 shrink-0" />
                {t('sidebar.multiSelect', 'Select')}
              </>
            )}
          </Button>

          <Button
            variant={editMode ? 'secondary' : 'ghost'}
            size="sm"
            className={cn(
              'h-7 shrink-0 px-1 text-xs font-medium',
              editMode
                ? 'text-pink-400 hover:text-pink-700'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={onToggleEditMode}
            title={
              editMode
                ? t('sidebar.exitEditMode', 'Done editing')
                : t('sidebar.enterEditMode', 'Edit episodes')
            }
          >
            {editMode ? (
              <>
                <Check className="mr-1 h-3 w-3 shrink-0" />
                {t('sidebar.done', 'Done')}
              </>
            ) : (
              <>
                <Pencil className="mr-1 h-3 w-3 shrink-0" />
                {t('sidebar.edit', 'Edit')}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
};
