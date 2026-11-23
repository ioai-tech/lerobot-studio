import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { List, type RowComponentProps } from 'react-window';
import type { EpisodeMetadata } from '@/core';
import { ScrollArea } from '@/ui';
import { EpisodeRow } from './EpisodeRow';

export const EPISODE_VIRTUALIZATION_THRESHOLD = 100;
const EPISODE_ROW_HEIGHT = 61;
const EPISODE_ROW_HEIGHT_EDIT = 102;

export interface EpisodeListItem {
  episode: EpisodeMetadata;
  taskDescription: string;
  formattedDuration: string;
  isDeleted: boolean;
  isSelected: boolean;
  isChecked: boolean;
}

interface EpisodeListProps {
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
  /** Content shown under the selected row (e.g. its segments). */
  renderSelectedExpansion?: (episode: EpisodeMetadata) => React.ReactNode;
  /** Height of that content in the virtualized list. */
  expansionHeight?: (episode: EpisodeMetadata) => number;
}

type VirtualEpisodeRowProps = Pick<
  EpisodeListProps,
  | 'renderSelectedExpansion'
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
  renderSelectedExpansion,
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
  const expansion =
    item.isSelected && !item.isDeleted && renderSelectedExpansion
      ? renderSelectedExpansion(item.episode)
      : null;
  return (
    <>
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
      {expansion ? <div className="border-b border-border/30 bg-muted/20">{expansion}</div> : null}
    </>
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
  renderSelectedExpansion,
  expansionHeight,
}) => {
  const { t } = useTranslation();
  const virtualRowProps = useMemo<VirtualEpisodeRowProps>(
    () => ({
      renderSelectedExpansion,
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
      renderSelectedExpansion,
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

  const baseRowHeight = editMode && !multiSelectMode ? EPISODE_ROW_HEIGHT_EDIT : EPISODE_ROW_HEIGHT;
  const rowHeight = useCallback(
    (index: number, props: VirtualEpisodeRowProps) => {
      const item = props.filteredEpisodes[index];
      return item?.isSelected && !item.isDeleted && props.renderSelectedExpansion && expansionHeight
        ? baseRowHeight + expansionHeight(item.episode)
        : baseRowHeight;
    },
    [baseRowHeight, expansionHeight],
  );

  if (filteredEpisodes.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-1 items-center justify-center p-4 text-center text-muted-foreground">
          {episodes && episodes.length === 0
            ? t('sidebar.emptyNoDataset')
            : t('sidebar.emptyNoMatch')}
        </div>
      </div>
    );
  }

  if (filteredEpisodes.length >= EPISODE_VIRTUALIZATION_THRESHOLD) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <List
          rowCount={filteredEpisodes.length}
          rowHeight={rowHeight}
          rowComponent={VirtualEpisodeRow}
          rowProps={virtualRowProps}
          rowKey={episodeRowKey}
          overscanCount={4}
          className="flex-1 min-h-0 w-full min-w-0 overflow-x-hidden"
          style={{ height: '100%', width: '100%' }}
          aria-label={t('sidebar.episodesTitle')}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="flex-1 min-h-0 w-full min-w-0">
        <div className="w-full min-w-0 overflow-x-hidden">
          {filteredEpisodes.map((item) => (
            <EpisodeListRow key={item.episode.episode_index} item={item} {...virtualRowProps} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
