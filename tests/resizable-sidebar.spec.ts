import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResizableSidebar } from '../packages/react/src/components/Sidebar/ResizableSidebar';

describe('ResizableSidebar', () => {
  it('renders a constrained splitter hit area to avoid scrollbar overlap', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ResizableSidebar, null, React.createElement('div', null, 'content')),
    );

    expect(markup).toContain('absolute inset-y-0 left-0 w-4');
    expect(markup).toContain('relative z-10 flex w-1');
    expect(markup).not.toContain('left-1/2 -translate-x-1/2 w-8 -mx-4');
  });
});
