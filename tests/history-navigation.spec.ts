import { describe, expect, it } from 'vitest';
import { resolveHistoryClickAction } from '../src/react/utils/historyNavigation';
import type { HistoryItem } from '@';

const baseItem = (overrides: Partial<HistoryItem>): HistoryItem => ({
  id: 'test:id',
  kind: 'directory',
  label: 'dataset',
  payload: { path: 'dataset', url: 'folder://dataset' },
  openedAt: Date.now(),
  ...overrides,
});

describe('resolveHistoryClickAction', () => {
  it('restores when hasHandle and restore is supported', () => {
    const action = resolveHistoryClickAction(baseItem({ hasHandle: true, kind: 'directory' }), {
      canRestore: true,
    });
    expect(action).toEqual({ type: 'restore' });
  });

  it('opens directory picker for local directory without hasHandle (Firefox fallback)', () => {
    const action = resolveHistoryClickAction(baseItem({ kind: 'directory', hasHandle: false }), {
      canRestore: false,
    });
    expect(action).toEqual({ type: 'openDirectory' });
  });

  it('does not route local directory to openUrl even when payload.url exists', () => {
    const action = resolveHistoryClickAction(
      baseItem({
        kind: 'directory',
        payload: { path: 'dataset', url: 'folder://dataset' },
      }),
      { canRestore: false },
    );
    expect(action.type).not.toBe('openUrl');
    expect(action).toEqual({ type: 'openDirectory' });
  });

  it('opens local archive picker without hasHandle', () => {
    const action = resolveHistoryClickAction(
      baseItem({
        kind: 'localArchive',
        id: 'localArchive:file://data.zip',
        payload: { path: 'data.zip', url: 'file://data.zip' },
      }),
      { canRestore: false },
    );
    expect(action).toEqual({ type: 'openLocalArchive' });
  });

  it('opens remote archive by URL', () => {
    const action = resolveHistoryClickAction(
      baseItem({
        kind: 'remoteArchive',
        payload: { url: 'https://example.com/data.zip' },
      }),
      { canRestore: false },
    );
    expect(action).toEqual({ type: 'openRemote', url: 'https://example.com/data.zip' });
  });

  it('falls back to picker when hasHandle but restore unsupported', () => {
    const action = resolveHistoryClickAction(
      baseItem({
        hasHandle: true,
        kind: 'localArchive',
        payload: { url: 'file://x.zip', path: 'x.zip' },
      }),
      { canRestore: false },
    );
    expect(action).toEqual({ type: 'openLocalArchive' });
  });
});
