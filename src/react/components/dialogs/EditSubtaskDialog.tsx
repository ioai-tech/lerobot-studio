import React, { useEffect, useMemo, useState } from 'react';
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
import { Textarea } from '@/ui';

export interface EditSubtaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startFrame: number;
  endFrame: number;
  knownLabels: string[];
  onSave: (label: string) => void;
}

export const EditSubtaskDialog: React.FC<EditSubtaskDialogProps> = ({
  open,
  onOpenChange,
  startFrame,
  endFrame,
  knownLabels,
  onSave,
}) => {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLabel('');
      setError(null);
    }
  }, [open, startFrame, endFrame]);

  const suggestions = useMemo(() => {
    const query = label.trim().toLowerCase();
    if (!query) return knownLabels.slice(0, 8);
    return knownLabels.filter((item) => item.toLowerCase().includes(query)).slice(0, 8);
  }, [knownLabels, label]);

  const handleSave = () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setError(t('subtask.labelRequired', 'Enter a subtask description'));
      return;
    }
    try {
      onSave(trimmed);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('subtask.dialogTitle', 'Describe subtask')}</DialogTitle>
          <DialogDescription>
            {t('subtask.dialogRange', 'Frames {{start}}–{{end}}', {
              start: startFrame,
              end: endFrame,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="subtask-label">
              {t('subtask.label', 'Subtask description')}
            </label>
            <Textarea
              id="subtask-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t('subtask.labelPlaceholder', 'e.g. Grasp the apple')}
              rows={3}
              className="resize-none"
              autoFocus
            />
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestions.map((item) => (
                <Button
                  key={item}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setLabel(item)}
                >
                  {item}
                </Button>
              ))}
            </div>
          )}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleSave}>{t('subtask.save', 'Save subtask')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
