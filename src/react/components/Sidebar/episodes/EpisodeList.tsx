import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { List, type RowComponentProps } from 'react-window';
import type { EpisodeMetadata } from '@/core';
import { ScrollArea } from '@/ui';
import { EpisodeRow } from './EpisodeRow';

export const EPISODE_VIRTUALIZATION_THRESHOLD = 100;

export interface EpisodeListItem {
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

type VirtualEpisodeRowProps = Pick<
  EpisodeListProps,
  | 'filteredEpisodes'
  | 'isLoading'
  | 'multiSelectMode'
  | 'editMode'
  | 'onRowClick'
  | 'onToggleSelection'
  | 'onEdit'
  | 'onDelete'
  | 'onRestore'
>;

function EpisodeListRow({
  item,
  isLoading,
  multiSelectMode,
  editMode,
  onRowClick,
  onToggleSelection,
  onEdit,
  onDelete,
  onRestore,
}: {
  item: EpisodeListItem;
} & Omit<VirtualEpisodeRowProps, 'filteredEpisodes'>) {
  return (
    <EpisodeRow
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
  );
}

function VirtualEpisodeRow({
  ariaAttributes,
  index,
  style,
  filteredEpisodes,
  ...rowProps
}: RowComponentProps<VirtualEpisodeRowProps>) {
  const item = filteredEpisodes[index];
  return (
    <div {...ariaAttributes} style={style} className="overflow-hidden">
      <EpisodeListRow item={item} {...rowProps} />
    </div>
  );
}

function episodeRowKey(index: number, data: VirtualEpisodeRowProps) {
  return data.filteredEpisodes[index].episode.episode_index;
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
  const virtualRowProps = useMemo<VirtualEpisodeRowProps>(
    () => ({
      filteredEpisodes,
      isLoading,
      multiSelectMode,
      editMode,
      onRowClick,
      onToggleSelection,
      onEdit,
      onDelete,
      onRestore,
    }),
    [
      filteredEpisodes,
      isLoading,
      multiSelectMode,
      editMode,
      onRowClick,
      onToggleSelection,
      onEdit,
      onDelete,
      onRestore,
    ],
  );

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

  if (filteredEpisodes.length >= EPISODE_VIRTUALIZATION_THRESHOLD) {
    return (
      <List
        rowCount={filteredEpisodes.length}
        rowHeight={editMode && !multiSelectMode ? 102 : 61}
        rowComponent={VirtualEpisodeRow}
        rowProps={virtualRowProps}
        rowKey={episodeRowKey}
        overscanCount={4}
        className="flex-1 min-h-0 w-full min-w-0 overflow-x-hidden"
        style={{ height: '100%', width: '100%' }}
        aria-label={t('sidebar.episodesTitle')}
      />
    );
  }

  return (
    <ScrollArea className="flex-1 min-h-0 w-full min-w-0">
      <div className="w-full min-w-0 overflow-x-hidden">
        {filteredEpisodes.map((item) => (
          <EpisodeListRow key={item.episode.episode_index} item={item} {...virtualRowProps} />
        ))}
      </div>
    </ScrollArea>
  );
};
