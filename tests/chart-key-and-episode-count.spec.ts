import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../src/react/i18n/core';
import { EpisodeHeader } from '../src/react/components/Sidebar/episodes/EpisodeHeader';
import { ChartLineStyleKey } from '../src/react/components/panels/ChartPanel/ChartLineStyleKey';

const noop = () => {};

function header(lang: string, totalCount?: number) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { forcedLanguage: lang },
      React.createElement(EpisodeHeader, {
        totalCount,
        editMode: false,
        multiSelectMode: false,
        isReadOnly: true,
        onToggleEditMode: noop,
        onToggleMultiSelectMode: noop,
      }),
    ),
  );
}

function key(lang: string, kind: 'action' | 'state') {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { forcedLanguage: lang },
      React.createElement(ChartLineStyleKey, { kind, visible: true, onVisibleChange: noop }),
    ),
  );
}

describe('sidebar episode count', () => {
  it('pluralizes in en', () => {
    expect(header('en', 1)).toContain('1 episode<');
    expect(header('en', 2)).toContain('2 episodes<');
  });
  it('is localized in zh and ja', () => {
    expect(header('zh', 1)).toContain('1 个片段');
    expect(header('ja', 3)).toContain('3 件のエピソード');
    expect(header('zh', 1)).not.toContain('Episodes');
  });
});

describe('chart line-style key', () => {
  it('shows full words, never abbreviations', () => {
    expect(key('en', 'action')).toContain('>Action<');
    expect(key('en', 'state')).toContain('>State<');
    expect(key('en', 'action')).not.toContain('>Act<');
    expect(key('zh', 'action')).toContain('>指令<');
    expect(key('zh', 'state')).toContain('>状态<');
  });
  it('dashes action only', () => {
    expect(key('en', 'action')).toContain('stroke-dasharray');
    expect(key('en', 'state')).not.toContain('stroke-dasharray');
  });
});
