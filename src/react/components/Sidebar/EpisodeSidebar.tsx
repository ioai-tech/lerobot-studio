import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLeRobotData, useLeRobotSelection } from '../../contexts/LeRobotContext';
import type { EpisodeMetadata } from '@/core';
import { EditTaskDialog } from '../dialogs/EditTaskDialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui';
import { Button } from '@/ui';
import { Textarea } from '@/ui';
import { EpisodeHeader } from './episodes/EpisodeHeader';
import { EpisodeSearch } from './episodes/EpisodeSearch';
import { EpisodeFilters } from './episodes/EpisodeFilters';
import { EpisodeToolbar } from './episodes/EpisodeToolbar';
import { EpisodeList } from './episodes/EpisodeList';
import { SidebarFooter } from './shared/SidebarFooter';

export const EpisodeSidebar: React.FC = () => {
  const { t } = useTranslation();
  const { episodes, tasks, isLoading, error, info, versionCapability, isReadOnly } =
    useLeRobotData();
  const {
    selectEpisode,
    selectedEpisodeIndex,
    selectedEpisodeIndices,
    toggleEpisodeSelection,
    selectAllInList,
    clearEpisodeSelection,
    deletedEpisodes,
    getEffectiveEpisode,
    editEpisodeTask,
    deleteEpisode,
    restoreEpisode,
  } = useLeRobotSelection();
  const [searchTerm, setSearchTerm] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [durationMin, setDurationMin] = useState<string>('');
  const [durationMax, setDurationMax] = useState<string>('');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [episodeToEdit, setEpisodeToEdit] = useState<EpisodeMetadata | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditText, setBulkEditText] = useState('');
  const mutationDisabled = isReadOnly || Boolean(info && versionCapability?.status !== 'supported');

  useEffect(() => {
    if (!mutationDisabled) return;
    setEditMode(false);
    setMultiSelectMode(false);
    setEditDialogOpen(false);
    setBulkEditOpen(false);
    clearEpisodeSelection();
  }, [mutationDisabled, clearEpisodeSelection]);

  const filteredEpisodes = useMemo(() => {
    if (!episodes) return [];
    let list = episodes;
    if (searchTerm.trim()) {
      const lowerSearch = searchTerm.trim().toLowerCase();
      list = list.filter((ep) => {
        const effective = getEffectiveEpisode(ep);
        const task = tasks[effective.task_index || 0] || '';
        const taskStr = (effective.tasks && effective.tasks[0]) || task;
        return (
          String(ep.episode_index).includes(lowerSearch) ||
          taskStr.toLowerCase().includes(lowerSearch) ||
          (Array.isArray(effective.tasks) &&
            effective.tasks.some((s: string) => s.toLowerCase().includes(lowerSearch)))
        );
      });
    }
    const fps = info?.fps ?? 30;
    const minSec = durationMin !== '' ? parseFloat(durationMin) : undefined;
    const maxSec = durationMax !== '' ? parseFloat(durationMax) : undefined;
    if (minSec != null && !Number.isNaN(minSec)) {
      list = list.filter((ep) => (ep.length ?? 0) / fps >= minSec);
    }
    if (maxSec != null && !Number.isNaN(maxSec)) {
      list = list.filter((ep) => (ep.length ?? 0) / fps <= maxSec);
    }
    return list;
  }, [episodes, tasks, searchTerm, durationMin, durationMax, info?.fps, getEffectiveEpisode]);

  const openEditDialog = (e: React.MouseEvent, episode: EpisodeMetadata) => {
    e.stopPropagation();
    if (mutationDisabled) return;
    setEpisodeToEdit(getEffectiveEpisode(episode));
    setEditDialogOpen(true);
  };

  const handleDelete = (e: React.MouseEvent, episodeIndex: number) => {
    e.stopPropagation();
    if (mutationDisabled) return;
    deleteEpisode(episodeIndex);
  };

  const handleRestore = (e: React.MouseEvent, episodeIndex: number) => {
    e.stopPropagation();
    if (mutationDisabled) return;
    restoreEpisode(episodeIndex);
  };

  const handleRowClick = (episode: EpisodeMetadata) => {
    const isDeleted = deletedEpisodes.has(episode.episode_index);
    if (isDeleted) return;
    if (multiSelectMode) {
      toggleEpisodeSelection(episode.episode_index);
    } else {
      selectEpisode(episode.episode_index);
    }
  };

  const selectedInFiltered = useMemo(() => {
    return filteredEpisodes.filter((ep) => selectedEpisodeIndices.has(ep.episode_index));
  }, [filteredEpisodes, selectedEpisodeIndices]);
  const selectedDeleted = useMemo(
    () => selectedInFiltered.filter((ep) => deletedEpisodes.has(ep.episode_index)),
    [selectedInFiltered, deletedEpisodes],
  );
  const selectedNonDeleted = useMemo(
    () => selectedInFiltered.filter((ep) => !deletedEpisodes.has(ep.episode_index)),
    [selectedInFiltered, deletedEpisodes],
  );

  const handleBulkEditSave = () => {
    if (mutationDisabled) return;
    const text = bulkEditText.trim();
    selectedInFiltered.forEach((ep) => editEpisodeTask(ep.episode_index, text || ''));
    setBulkEditOpen(false);
    setBulkEditText('');
  };

  const listRows = useMemo(() => {
    const fps = info?.fps || 30;
    return filteredEpisodes.map((episode) => {
      const effective = getEffectiveEpisode(episode);
      const durationInSeconds = (episode.length || 0) / fps;
      const mins = Math.floor(durationInSeconds / 60);
      const secs = Math.floor(durationInSeconds % 60);
      const taskDescription =
        (effective.tasks && effective.tasks.length > 0
          ? String(effective.tasks[0])
          : tasks[effective.task_index || 0]) || t('sidebar.noDescription');

      return {
        episode,
        taskDescription,
        formattedDuration: `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`,
        isDeleted: deletedEpisodes.has(episode.episode_index),
        isSelected: selectedEpisodeIndex === episode.episode_index,
        isChecked: selectedEpisodeIndices.has(episode.episode_index),
      };
    });
  }, [
    filteredEpisodes,
    getEffectiveEpisode,
    info?.fps,
    tasks,
    t,
    deletedEpisodes,
    selectedEpisodeIndex,
    selectedEpisodeIndices,
  ]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="shrink-0 space-y-3 border-b px-3 pt-0 pb-2 min-w-0 overflow-x-hidden">
        <EpisodeHeader
          totalCount={episodes?.length}
          editMode={editMode}
          multiSelectMode={multiSelectMode}
          isReadOnly={mutationDisabled}
          onToggleEditMode={() => setEditMode((v) => !v)}
          onToggleMultiSelectMode={() => {
            setMultiSelectMode((v) => !v);
            if (multiSelectMode) clearEpisodeSelection();
          }}
        />
        {mutationDisabled && versionCapability && (
          <p className="rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
            {t('sidebar.readOnlyVersion', {
              version: versionCapability.normalizedVersion ?? info?.codebase_version ?? 'unknown',
            })}
          </p>
        )}
        <EpisodeSearch
          searchTerm={searchTerm}
          showAdvanced={showAdvanced}
          onSearchTermChange={setSearchTerm}
          onToggleAdvanced={() => setShowAdvanced((v) => !v)}
        />
        {showAdvanced && (
          <EpisodeFilters
            durationMin={durationMin}
            durationMax={durationMax}
            onDurationMinChange={setDurationMin}
            onDurationMaxChange={setDurationMax}
          />
        )}
        {!mutationDisabled && multiSelectMode && (
          <EpisodeToolbar
            selectedCount={selectedEpisodeIndices.size}
            selectedDeletedCount={selectedDeleted.length}
            selectedNonDeletedCount={selectedNonDeleted.length}
            onSelectAll={() => selectAllInList(filteredEpisodes.map((ep) => ep.episode_index))}
            onClearSelection={clearEpisodeSelection}
            onBulkEdit={() => setBulkEditOpen(true)}
            onBulkDelete={() => selectedNonDeleted.forEach((ep) => deleteEpisode(ep.episode_index))}
            onBulkRestore={() => selectedDeleted.forEach((ep) => restoreEpisode(ep.episode_index))}
          />
        )}
      </div>

      <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
        <EpisodeList
          error={error}
          episodes={episodes}
          filteredEpisodes={listRows}
          isLoading={isLoading}
          multiSelectMode={!mutationDisabled && multiSelectMode}
          editMode={!mutationDisabled && editMode}
          onRowClick={handleRowClick}
          onToggleSelection={(episode, event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleEpisodeSelection(episode.episode_index);
          }}
          onEdit={(episode, event) => openEditDialog(event, episode)}
          onDelete={(episodeIndex, event) => handleDelete(event, episodeIndex)}
          onRestore={(episodeIndex, event) => handleRestore(event, episodeIndex)}
        />
      </div>

      <SidebarFooter />

      {!mutationDisabled && (
        <EditTaskDialog
          key={episodeToEdit?.episode_index ?? 'edit-dialog'}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          episode={episodeToEdit}
          onSave={editEpisodeTask}
        />
      )}
      {!mutationDisabled && (
        <Dialog open={bulkEditOpen} onOpenChange={setBulkEditOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('sidebar.bulkEdit', 'Edit task')}</DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <p className="mb-2 text-xs text-muted-foreground">
                {t('sidebar.selectedCount', { count: selectedInFiltered.length })} -{' '}
                {t('editTask.taskDescription')}
              </p>
              <Textarea
                value={bulkEditText}
                onChange={(e) => setBulkEditText(e.target.value)}
                placeholder={t('editTask.taskPlaceholder', 'Enter task description...')}
                rows={3}
                className="resize-none"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBulkEditOpen(false)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button onClick={handleBulkEditSave}>{t('editTask.save', 'Save')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
