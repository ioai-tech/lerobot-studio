import { useState, useEffect, useCallback } from 'react';
import { safeStorage } from '@/platform';
import { clearHandles, deleteHandle } from '@/platform';

export type HistoryItemKind = 'directory' | 'localArchive' | 'remoteArchive' | 'sample';

export interface HistoryItem {
  id: string; // kind:key
  kind: HistoryItemKind;
  label: string;
  payload: {
    url?: string;
    sampleId?: string;
    path?: string; // for local dir/archive label only
  };
  openedAt: number;
  /** 是否在 IndexedDB 中存有 FileSystemHandle，可一键恢复 */
  hasHandle?: boolean;
}

const STORAGE_KEY = 'lerobot-studio-open-history';
const MAX_HISTORY_ITEMS = 50;

function persistHistory(next: HistoryItem[]) {
  safeStorage.setJSON(STORAGE_KEY, next);
}

export function useOpenHistory() {
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Initialize from localStorage
  useEffect(() => {
    const parsed = safeStorage.getJSON<HistoryItem[]>(STORAGE_KEY, []);
    if (parsed.length > 0) {
      setHistory(parsed.sort((a, b) => b.openedAt - a.openedAt));
    }
  }, []);

  const addHistoryItem = useCallback((item: Omit<HistoryItem, 'openedAt'>) => {
    setHistory((prev) => {
      const now = Date.now();
      const newItem: HistoryItem = { ...item, openedAt: now };

      // Remove existing item with same ID (deduplicate)
      const filtered = prev.filter((h) => h.id !== item.id);

      const next = [newItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);

      persistHistory(next);

      return next;
    });
  }, []);

  const clearHistoryHandleFlag = useCallback((id: string) => {
    setHistory((prev) => {
      const next = prev.map((h) => (h.id === id ? { ...h, hasHandle: false } : h));
      persistHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    safeStorage.removeItem(STORAGE_KEY);
    void clearHandles();
  }, []);

  const removeHistoryItem = useCallback((id: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h.id !== id);
      persistHistory(next);
      return next;
    });
    void deleteHandle(id);
  }, []);

  return {
    history,
    addHistoryItem,
    clearHistoryHandleFlag,
    clearHistory,
    removeHistoryItem,
  };
}
