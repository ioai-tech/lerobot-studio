import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  EpisodeList,
  type EpisodeListItem,
} from '../src/react/components/Sidebar/episodes/EpisodeList';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.index != null ? `${key}:${values.index}` : key,
  }),
}));

function item(index: number): EpisodeListItem {
  return {
    episode: { episode_index: index, length: 3, tasks: ['pick'] },
    taskDescription: `task-${index}`,
    formattedDuration: '0.3s',
    isDeleted: false,
    isSelected: index === 0,
    isChecked: false,
  };
}

const noop = () => undefined;

describe('EpisodeList', () => {
  it('lists the episodes and repeats no load error (the viewer names it once, above the panels)', () => {
    const markup = renderToStaticMarkup(
      React.createElement(EpisodeList, {
        episodes: [item(0).episode, item(1).episode],
        filteredEpisodes: [item(0), item(1)],
        isLoading: false,
        multiSelectMode: false,
        editMode: false,
        onRowClick: noop,
        onToggleSelection: noop,
        onEdit: noop,
        onDelete: noop,
        onRestore: noop,
      }),
    );

    expect(markup).not.toContain('sidebar.errorLoading');
    expect(markup).toContain('sidebar.selectEpisode:0');
    expect(markup).toContain('sidebar.selectEpisode:1');
    expect(markup).not.toContain('sidebar.emptyNoDataset');
    expect(markup).not.toContain('subtask.listTitle');
  });
});
