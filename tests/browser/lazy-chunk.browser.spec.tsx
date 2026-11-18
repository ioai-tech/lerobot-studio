import React, { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/core';
import { lazyChunk } from '@/components/Commons/lazyChunk';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

class Outer extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }
  render() {
    return this.state.message ? (
      <p data-testid="outer">{this.state.message}</p>
    ) : (
      this.props.children
    );
  }
}

function mount(element: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <I18nProvider forcedLanguage="en">
      <Outer>{element}</Outer>
    </I18nProvider>,
  );
  return {
    host,
    unmount: () => {
      root.unmount();
      host.remove();
    },
  };
}

it('shows a failed chunk as a named notice with a retry; the rest keeps working', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let attempts = 0;
  const Chunk = lazyChunk<{ label: string }>(async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('Failed to fetch dynamically imported module');
    return ({ label }) => <p data-testid="chunk">{label}</p>;
  });
  const { host, unmount } = mount(
    <>
      <p data-testid="sibling">still here</p>
      <Chunk label="loaded" />
    </>,
  );
  try {
    await expect
      .poll(() => host.querySelector('[role="alert"]')?.getAttribute('data-error-code'))
      .toBe('CHUNK_LOAD_FAILED');
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('CHUNK_LOAD_FAILED');
    expect(host.querySelector('[data-testid="sibling"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="outer"]')).toBeNull();

    host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    await expect
      .poll(() => host.querySelector('[data-testid="chunk"]')?.textContent)
      .toBe('loaded');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(attempts).toBe(2);
  } finally {
    unmount();
    vi.restoreAllMocks();
  }
});

it('offers a page reload when the retry fails too', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let attempts = 0;
  const Chunk = lazyChunk(async () => {
    attempts += 1;
    throw new TypeError('Failed to fetch dynamically imported module');
  });
  const { host, unmount } = mount(<Chunk />);
  const buttons = () =>
    Array.from(host.querySelectorAll('[role="alert"] button')).map((button) =>
      button.textContent?.trim(),
    );
  try {
    await expect.poll(buttons).toEqual(['Retry']);
    host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    await expect.poll(buttons).toEqual(['Retry', 'Reload page']);
    expect(attempts).toBe(2);
  } finally {
    unmount();
    vi.restoreAllMocks();
  }
});

it('passes errors of the loaded component on, as without the chunk', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const Broken = lazyChunk(async () => () => {
    throw new Error('render bug');
  });
  const { host, unmount } = mount(<Broken />);
  try {
    await expect
      .poll(() => host.querySelector('[data-testid="outer"]')?.textContent)
      .toBe('render bug');
    expect(host.querySelector('[data-error-code]')).toBeNull();
  } finally {
    unmount();
    vi.restoreAllMocks();
  }
});
