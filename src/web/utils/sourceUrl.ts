import type { HistoryItem, SourceKind, ParsedSourceUrl } from '@';
export type { SourceKind, ParsedSourceUrl };

const LEGACY_KEYS = ['dataset', 'data'] as const;

export function getUrlParamFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search);
  // 兼容旧参数：dataset/data/url
  return params.get('url') || params.get('dataset') || params.get('data');
}

export function setUrlParamInLocation(rawUrl: string | null, mode: 'push' | 'replace' = 'replace') {
  const params = new URLSearchParams(window.location.search);

  // 清理旧参数，统一只写 url
  LEGACY_KEYS.forEach((k) => params.delete(k));

  if (!rawUrl) {
    params.delete('url');
  } else {
    params.set('url', rawUrl);
  }

  const qs = params.toString();
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  if (mode === 'push') {
    window.history.pushState({}, '', next);
  } else {
    window.history.replaceState({}, '', next);
  }
}

export function buildFolderUrl(name: string) {
  // 注意：浏览器无法从 URL 直接访问本地路径，这里保存的是“意图 + 名称提示”
  return `folder://${encodeURIComponent(normalizeLocalLabel(name))}`;
}

export function buildFileUrl(name: string) {
  return `file://${encodeURIComponent(normalizeLocalLabel(name))}`;
}

export function buildSampleUrl(id: string) {
  return `sample://${encodeURIComponent(id)}`;
}

export function parseSourceUrl(raw: string): ParsedSourceUrl {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { kind: 'unknown', raw: '' };

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return { kind: 'remoteArchive', raw: trimmed };
  }

  if (trimmed.startsWith('folder://') || trimmed.startsWith('dir://')) {
    const hint = decodeSuffix(trimmed.replace(/^folder:\/\//, '').replace(/^dir:\/\//, ''));
    return { kind: 'directory', raw: trimmed, hint };
  }

  if (trimmed.startsWith('file://')) {
    const hint = decodeSuffix(trimmed.replace(/^file:\/\//, ''));
    return { kind: 'localArchive', raw: trimmed, hint };
  }

  if (trimmed.startsWith('sample://')) {
    const sampleId = decodeSuffix(trimmed.replace(/^sample:\/\//, ''));
    return { kind: 'sample', raw: trimmed, sampleId, hint: sampleId };
  }

  return { kind: 'unknown', raw: trimmed };
}

function decodeSuffix(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 规范化本地路径/文件名，避免对已编码字符串二次 encodeURIComponent */
function normalizeLocalLabel(name: string): string {
  if (!name) return name;
  try {
    let current = name;
    for (let i = 0; i < 2; i++) {
      if (!/%[0-9A-Fa-f]{2}/.test(current)) break;
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    }
    return current;
  } catch {
    return name;
  }
}

/** 根据 URL 意图生成可能的历史项 id（兼容 URLSearchParams 解码及旧的双重编码） */
export function buildHistoryIdsFromParsed(parsed: ParsedSourceUrl): string[] {
  if (parsed.kind !== 'directory' && parsed.kind !== 'localArchive') return [];
  const prefix = parsed.kind === 'directory' ? 'directory' : 'localArchive';
  const scheme = parsed.kind === 'directory' ? 'folder://' : 'file://';
  const ids = new Set<string>();

  const add = (url: string) => {
    if (url) ids.add(`${prefix}:${url}`);
  };

  add(parsed.raw);

  if (parsed.hint) {
    add(parsed.kind === 'directory' ? buildFolderUrl(parsed.hint) : buildFileUrl(parsed.hint));
  }

  if (parsed.raw.startsWith(scheme)) {
    const rawSuffix = parsed.raw.slice(scheme.length);
    // 地址栏 ?url= 经 URLSearchParams 读回时可能已解码斜杠，需 re-encode 才能匹配 IDB
    add(`${scheme}${encodeURIComponent(rawSuffix)}`);
    // 兼容旧的双重编码条目（如 %252F）
    try {
      add(`${scheme}${encodeURIComponent(encodeURIComponent(decodeSuffix(rawSuffix)))}`);
    } catch {
      // ignore
    }
  }

  return [...ids];
}

/** 将本地 URL 意图规范化为与历史/IDB 一致的 canonical 形式 */
export function canonicalizeLocalSourceUrl(parsed: ParsedSourceUrl): string {
  if (parsed.kind === 'directory' && parsed.hint) return buildFolderUrl(parsed.hint);
  if (parsed.kind === 'localArchive' && parsed.hint) return buildFileUrl(parsed.hint);
  return parsed.raw;
}

export function buildHistoryItemFromParsed(
  parsed: ParsedSourceUrl,
  historyId: string,
): HistoryItem | null {
  if (parsed.kind !== 'directory' && parsed.kind !== 'localArchive') return null;
  return {
    id: historyId,
    kind: parsed.kind,
    label: parsed.hint || parsed.raw,
    payload: { path: parsed.hint, url: parsed.raw },
    openedAt: 0,
    hasHandle: true,
  };
}
