import React, { useEffect, useState } from 'react';
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
import { Textarea } from '@/ui';
import type { EpisodeMetadata } from '@/core';

export interface EditTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episode: EpisodeMetadata | null;
  onSave: (episodeIndex: number, newTask: string) => void;
}

export const EditTaskDialog: React.FC<EditTaskDialogProps> = ({
  open,
  onOpenChange,
  episode,
  onSave,
}) => {
  const { t } = useTranslation();
  const [taskText, setTaskText] = useState('');

  useEffect(() => {
    if (!episode) return;
    const next = (episode.tasks && episode.tasks.length > 0 && episode.tasks[0]) || '';
    setTaskText(next);
  }, [episode]);

  const handleSave = () => {
    if (episode == null) return;
    const trimmed = taskText.trim();
    onSave(episode.episode_index, trimmed || '');
    onOpenChange(false);
  };

  const isOpen = Boolean(open && episode);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editTask.title', 'Edit Episode Task')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('editTask.a11yDescription', 'Edit the task description for the selected episode.')}
          </DialogDescription>
        </DialogHeader>
        {episode ? (
          <>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  {t('editTask.episodeIndex', 'Episode Index')}
                </label>
                <Input value={episode.episode_index} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  {t('editTask.taskDescription', 'Task Description')}
                </label>
                <Textarea
                  value={taskText}
                  onChange={(e) => setTaskText(e.target.value)}
                  placeholder={t('editTask.taskPlaceholder', 'Enter task description...')}
                  rows={4}
                  className="resize-none"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button onClick={handleSave}>{t('editTask.save', 'Save')}</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
