import type { HistoryItem } from '../hooks/useOpenHistory';

export type HistoryClickAction =
  | { type: 'restore' }
  | { type: 'openUrl'; url: string }
  | { type: 'openRemote'; url: string }
  | { type: 'openDirectory' }
  | { type: 'openLocalArchive' }
  | { type: 'openSample' };

/**
 * 解析历史项点击应执行的动作。
 * 本地 directory/localArchive 无 hasHandle 时必须回退 picker，不能走 openFromUrl（会仅显示欢迎页）。
 */
export function resolveHistoryClickAction(
  item: HistoryItem,
  options: { canRestore: boolean },
): HistoryClickAction {
  if (item.hasHandle && options.canRestore) {
    return { type: 'restore' };
  }

  if (item.kind === 'remoteArchive' && item.payload.url) {
    return { type: 'openRemote', url: item.payload.url };
  }

  if (item.kind === 'sample' && item.payload.url) {
    return { type: 'openUrl', url: item.payload.url };
  }

  if (item.kind === 'sample') {
    return { type: 'openSample' };
  }

  if (item.kind === 'directory') {
    return { type: 'openDirectory' };
  }

  if (item.kind === 'localArchive') {
    return { type: 'openLocalArchive' };
  }

  if (item.payload.url) {
    return { type: 'openUrl', url: item.payload.url };
  }

  return { type: 'openSample' };
}
