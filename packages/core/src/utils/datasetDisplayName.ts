import type { LeRobotInfo } from '../types/lerobot';

/**
 * 统一计算顶部显示的数据集名称：
 * - 用户选择时记录的 datasetLabel 优先（避免 info 中出现 file-{file_index:03d}.parquet）
 * - 否则尝试从 info.data_path / info.video_path 里提取 basename
 */
export function getDatasetDisplayName(info: LeRobotInfo | null, datasetLabel?: string) {
  if (datasetLabel) return datasetLabel;
  if (!info) return undefined;
  const pick = sanitizeInfoName(info.data_path || info.video_path || '');
  return pick || undefined;
}

function sanitizeInfoName(infoPath?: string) {
  if (!infoPath) return undefined;
  const pick = infoPath.split(/[\\/]/).filter(Boolean).pop();
  if (!pick) return undefined;
  if (pick.startsWith('file-{file_index')) return undefined;
  return safeDecodeTwice(pick);
}

function safeDecodeTwice(value: string) {
  const once = safeDecode(value);
  return safeDecode(once);
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
