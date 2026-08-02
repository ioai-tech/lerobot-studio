import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import type { EpisodeMetadata } from '@/core';
import { ScrollArea } from '@/ui';
import { EpisodeRow } from './EpisodeRow';

interface EpisodeListItem {
  episode: EpisodeMetadata;
  taskDescription: string;
  formattedDuration: string;
  isDeleted: boolean;
  isSelected: boolean;
  isChecked: boolean;
}

interface EpisodeListProps {
  error: string | null;
  episodes: EpisodeMetadata[] | null;
  filteredEpisodes: EpisodeListItem[];
  isLoading: boolean;
  multiSelectMode: boolean;
  editMode: boolean;
  onRowClick: (episode: EpisodeMetadata) => void;
  onToggleSelection: (episode: EpisodeMetadata, event: React.MouseEvent) => void;
  onEdit: (episode: EpisodeMetadata, event: React.MouseEvent) => void;
  onDelete: (episodeIndex: number, event: React.MouseEvent) => void;
  onRestore: (episodeIndex: number, event: React.MouseEvent) => void;
}

export const EpisodeList: React.FC<EpisodeListProps> = ({
  error,
  episodes,
  filteredEpisodes,
  isLoading,
  multiSelectMode,
  editMode,
  onRowClick,
  onToggleSelection,
  onEdit,
  onDelete,
  onRestore,
}) => {
  const { t } = useTranslation();

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center space-y-2 p-4 text-center">
        <AlertCircle className="h-8 w-8 text-destructive/70" />
        <p className="text-sm font-medium text-destructive">{t('sidebar.errorLoading')}</p>
        <p className="max-w-full break-words text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (filteredEpisodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground">
        {episodes && episodes.length === 0
          ? t('sidebar.emptyNoDataset')
          : t('sidebar.emptyNoMatch')}
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 min-h-0 w-full min-w-0">
      <div className="w-full min-w-0 overflow-x-hidden">
        {filteredEpisodes.map((item) => (
          <EpisodeRow
            key={item.episode.episode_index}
            episode={item.episode}
            taskDescription={item.taskDescription}
            formattedDuration={item.formattedDuration}
            isDeleted={item.isDeleted}
            isSelected={item.isSelected}
            isChecked={item.isChecked}
            isLoading={isLoading}
            multiSelectMode={multiSelectMode}
            showActions={editMode}
            onRowClick={() => onRowClick(item.episode)}
            onToggleSelection={(event) => onToggleSelection(item.episode, event)}
            onEdit={(event) => onEdit(item.episode, event)}
            onDelete={(event) => onDelete(item.episode.episode_index, event)}
            onRestore={(event) => onRestore(item.episode.episode_index, event)}
          />
        ))}
      </div>
    </ScrollArea>
  );
};
