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
import { Input } from '@/ui';
import { usePortalContainer } from '@/ui';

export interface EditSubtaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startFrame: number;
  endFrame: number;
  startSeconds?: number;
  endSeconds?: number;
  knownLabels: string[];
  initialLabel?: string;
  onSave: (label: string) => void;
}

export const EditSubtaskDialog: React.FC<EditSubtaskDialogProps> = ({
  open,
  onOpenChange,
  startFrame,
  endFrame,
  startSeconds,
  endSeconds,
  knownLabels,
  initialLabel = '',
  onSave,
}) => {
  const { t } = useTranslation();
  const portalContainer = usePortalContainer();
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLabel(initialLabel);
      setError(null);
    }
  }, [open, startFrame, endFrame, initialLabel]);

  const suggestions = useMemo(() => {
    const query = label.trim().toLowerCase();
    if (!query) return knownLabels.slice(0, 8);
    return knownLabels.filter((item) => item.toLowerCase().includes(query)).slice(0, 8);
  }, [knownLabels, label]);

  const handleSave = () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setError(t('subtask.labelRequired', 'Enter a name'));
      return;
    }
    try {
      onSave(trimmed);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const stopPlaybackKeys = (event: React.KeyboardEvent) => {
    if (event.key === ' ' || event.key.length === 1) {
      event.stopPropagation();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onKeyDown={stopPlaybackKeys}
        onKeyUp={stopPlaybackKeys}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          portalContainer?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('subtask.dialogTitle', 'Subtask')}</DialogTitle>
          <DialogDescription>
            {t('subtask.dialogRange', '{{start}}–{{end}} · {{startTime}}–{{endTime}} s', {
              start: startFrame,
              end: endFrame,
              startTime: (startSeconds ?? startFrame).toFixed(1),
              endTime: (endSeconds ?? endFrame).toFixed(1),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Input
            id="subtask-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              stopPlaybackKeys(event);
              if (event.key === 'Enter') {
                event.preventDefault();
                handleSave();
              }
            }}
            placeholder={t('subtask.labelPlaceholder', 'Grasp the apple')}
            aria-label={t('subtask.label', 'Name')}
            autoFocus
            autoComplete="off"
          />
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
          <Button onClick={handleSave}>{t('subtask.save', 'Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
