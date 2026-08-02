import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

export type LoadingPhase =
  'idle' | 'preflight' | 'download' | 'index' | 'gunzip' | 'read' | 'render' | 'ready' | 'error';

export interface LoadingTask {
  id: string;
  title?: string;
  phase: LoadingPhase;
  loaded?: number;
  total?: number;
  message?: string;
  error?: string | null;
}

interface LoadingContextValue {
  tasks: LoadingTask[];
  upsertTask: (task: LoadingTask) => void;
  completeTask: (id: string) => void;
  failTask: (id: string, error: string) => void;
  clear: () => void;
}

const LoadingContext = createContext<LoadingContextValue | null>(null);

export const LoadingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tasks, setTasks] = useState<LoadingTask[]>([]);

  const upsertTask = useCallback((task: LoadingTask) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === task.id);
      if (idx === -1) return [...prev, task];
      const next = [...prev];
      next[idx] = { ...next[idx], ...task };
      return next;
    });
  }, []);

  const completeTask = useCallback((id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, phase: 'ready' } : t)));
  }, []);

  const failTask = useCallback((id: string, error: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, phase: 'error', error } : t)));
  }, []);

  const clear = useCallback(() => setTasks([]), []);

  const value = useMemo<LoadingContextValue>(
    () => ({
      tasks,
      upsertTask,
      completeTask,
      failTask,
      clear,
    }),
    [tasks, upsertTask, completeTask, failTask, clear],
  );

  return <LoadingContext.Provider value={value}>{children}</LoadingContext.Provider>;
};

export const useLoading = () => {
  const ctx = useContext(LoadingContext);
  if (!ctx) throw new Error('useLoading must be used within LoadingProvider');
  return ctx;
};
