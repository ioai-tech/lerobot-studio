import type { DockviewApi, IDockviewPanel } from 'dockview-react';

type AddPanelOptions = Parameters<DockviewApi['addPanel']>[0];

const MAX_RETRIES = 3;

function isPanelIdConflictError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('already exists');
}

export function allocatePanelId(
  containerApi: DockviewApi,
  type: string,
  featureKey: string,
): string {
  const base = `${type}-${featureKey}`;
  let n = 1;
  while (containerApi.getPanel(`${base}-${n}`)) {
    n += 1;
  }
  return `${base}-${n}`;
}

export type SafeAddPanelOptions = Omit<AddPanelOptions, 'id'> & {
  id?: string;
  /** Used to auto-generate `${type}-${featureKey}-${n}` when `id` is omitted */
  autoId?: { type: string; featureKey: string };
};

export function safeAddPanel(
  containerApi: DockviewApi,
  options: SafeAddPanelOptions,
): IDockviewPanel | undefined {
  const { autoId, ...rest } = options;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const id =
      rest.id ??
      (autoId ? allocatePanelId(containerApi, autoId.type, autoId.featureKey) : undefined);

    if (!id) {
      console.warn('[dockview] safeAddPanel: missing panel id');
      return undefined;
    }

    try {
      return containerApi.addPanel({ ...rest, id } as AddPanelOptions);
    } catch (error) {
      if (!isPanelIdConflictError(error)) {
        throw error;
      }

      if (!autoId || attempt === MAX_RETRIES - 1) {
        console.warn('[dockview] safeAddPanel: panel id conflict', id, error);
        return undefined;
      }
    }
  }

  return undefined;
}
