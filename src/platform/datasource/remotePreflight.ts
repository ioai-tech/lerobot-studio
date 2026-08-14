import type { ArchiveKind } from './ArchiveDataSourceFactory';
import {
  getArchiveKindFromHeaders,
  getArchiveKindFromMagicBytes,
  getArchiveKindFromUrl,
} from './ArchiveDataSourceFactory';

export type RemotePreflightFailureCode =
  'range_http' | 'range_headers' | 'full_download_too_large' | 'cors' | 'network' | 'unknown';

/** 结构化失败信息，供 i18n 拼接；技术片段（如 header 摘要、浏览器报错）保留英文以保证稳定可读。 */
export type RemotePreflightFailure = {
  code: RemotePreflightFailureCode;
  /** 预期为 206 时，实际 HTTP 状态码 */
  actualStatus?: number;
  /** 英文摘要：Content-Range / Accept-Ranges 实际值 */
  headerSummary?: string;
  /** 浏览器或运行时的简要错误信息（已截断） */
  detail?: string;
};

export type RemotePreflightResult =
  | {
      ok: true;
      kind: ArchiveKind | null;
      /** `full` means the server ignored Range and must never be passed to HttpReader. */
      accessMode: 'range' | 'full';
      contentLength?: number;
    }
  | { ok: false; kind: 'range' | 'cors' | 'network' | 'unknown'; failure: RemotePreflightFailure };

type TranslateFn = (
  key: string,
  defaultMessage?: string,
  values?: Record<string, unknown>,
) => string;

const DETAIL_MAX = 220;
export const REMOTE_ARCHIVE_PROBE_BYTES = 512;
/** Abort hanging preflight fetches (unreachable host, dropped TCP, etc.). */
export const REMOTE_PREFLIGHT_TIMEOUT_MS = 20_000;
/** Disk-backed full downloads are bounded to protect quota and hostile endpoints. */
export const MAX_FULL_ARCHIVE_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;

function clampDetail(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  return s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX)}…` : s;
}

function summarizeRangeHeaders(contentRange: string, acceptRanges: string): string {
  const cr = contentRange.trim() || '(empty)';
  const ar = acceptRanges.trim() || '(empty)';
  return `Content-Range: ${cr}; Accept-Ranges: ${ar}`;
}

/** 与 en.json 一致，作为 react-intl 的 defaultMessage（占位符为单花括号）。 */
const EN_FALLBACK: Record<RemotePreflightFailureCode, string> = {
  range_http: 'Range preflight failed: expected HTTP 206 (Partial Content), actual {actualStatus}.',
  range_headers:
    'Range not supported: expected Accept-Ranges: bytes or a bytes Content-Range; actual: {headerSummary}.',
  full_download_too_large:
    'This server does not support Range requests and the complete archive exceeds the safe download limit.',
  cors: 'CORS blocked the request. Browser reported: {detail}.',
  network: 'Network or authentication failed: {detail}.',
  unknown: 'Preflight failed: {detail}.',
};

export function translateRemotePreflightFailure(
  t: TranslateFn,
  failure: RemotePreflightFailure,
): string {
  const key = `dialogs.remoteArchive.error.${failure.code}`;
  const values: Record<string, unknown> = {};
  if (failure.actualStatus !== undefined) values.actualStatus = failure.actualStatus;
  if (failure.headerSummary) values.headerSummary = failure.headerSummary;
  if (failure.detail) values.detail = failure.detail;
  return t(key, EN_FALLBACK[failure.code], values);
}

function parseContentLength(headers: Headers): number | undefined {
  const raw = headers.get('content-length');
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Reads only a bounded prefix and explicitly cancels the remaining body.  A
 * 200 response can contain a multi-GB archive, so `arrayBuffer()` is unsafe
 * even during a supposedly lightweight preflight.
 */
async function readPrefix(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = maxBytes - total;
      const prefix = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(prefix);
      total += prefix.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function resolveRemoteArchiveKind(
  url: string,
  headers: Headers,
  bytes: Uint8Array,
): ArchiveKind | null {
  // File signatures are authoritative; headers and URL extensions are useful
  // fallbacks for empty or unusually chunked probe responses.
  return (
    getArchiveKindFromMagicBytes(bytes) ||
    getArchiveKindFromHeaders(headers) ||
    getArchiveKindFromUrl(url)
  );
}

function unsupportedArchiveResult(): RemotePreflightResult {
  return {
    ok: false,
    kind: 'unknown',
    failure: {
      code: 'unknown',
      detail: 'Unsupported archive content: expected ZIP, TAR, or TAR.GZ/GZIP.',
    },
  };
}

function isTimeoutOrAbort(error: unknown): boolean {
  if (
    error instanceof DOMException &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return true;
  }
  const message = String((error as Error)?.message || error).toLowerCase();
  return (
    message.includes('timeout') || message.includes('timed out') || message.includes('aborted')
  );
}

function createPreflightSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

/**
 * 远程压缩包轻量预检：
 * - 统一用 GET + Range（兼容只允许 GET 的签名 URL）
 * - 只读取前几个字节，用响应头和文件魔数推断归档类型，避免整包下载
 */
export async function preflightRemoteArchive(url: string): Promise<RemotePreflightResult> {
  let httpsUrl: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return {
        ok: false,
        kind: 'network',
        failure: {
          code: 'network',
          detail: 'Blocked insecure HTTP archive URL; use HTTPS',
        },
      };
    }
    httpsUrl = parsed.toString();
  } catch {
    return {
      ok: false,
      kind: 'unknown',
      failure: { code: 'unknown', detail: 'Invalid archive URL' },
    };
  }

  const { signal, cancel } = createPreflightSignal(REMOTE_PREFLIGHT_TIMEOUT_MS);
  try {
    const rangeRes = await fetch(httpsUrl, {
      headers: { Range: `bytes=0-${REMOTE_ARCHIVE_PROBE_BYTES - 1}` },
      signal,
    });
    const contentLength = parseContentLength(rangeRes.headers);
    if (rangeRes.status === 200) {
      if (contentLength !== undefined && contentLength > MAX_FULL_ARCHIVE_DOWNLOAD_BYTES) {
        await rangeRes.body?.cancel().catch(() => undefined);
        return {
          ok: false,
          kind: 'range',
          failure: { code: 'full_download_too_large', actualStatus: rangeRes.status },
        };
      }
      const bytes = await readPrefix(rangeRes, REMOTE_ARCHIVE_PROBE_BYTES);
      const kind = resolveRemoteArchiveKind(url, rangeRes.headers, bytes);
      if (!kind) return unsupportedArchiveResult();
      return { ok: true, kind, accessMode: 'full', contentLength };
    }
    if (rangeRes.status !== 206) {
      return {
        ok: false,
        kind: 'range',
        failure: {
          code: 'range_http',
          actualStatus: rangeRes.status,
        },
      };
    }
    const contentRange = rangeRes.headers.get('content-range') || '';
    const acceptRanges = rangeRes.headers.get('accept-ranges') || '';
    const supportsRange = contentRange.toLowerCase().startsWith('bytes ');
    if (!supportsRange && !acceptRanges.toLowerCase().includes('bytes')) {
      return {
        ok: false,
        kind: 'range',
        failure: {
          code: 'range_headers',
          headerSummary: summarizeRangeHeaders(contentRange, acceptRanges),
        },
      };
    }

    const bytes = await readPrefix(rangeRes, REMOTE_ARCHIVE_PROBE_BYTES);
    const kind = resolveRemoteArchiveKind(url, rangeRes.headers, bytes);
    if (!kind) return unsupportedArchiveResult();
    return { ok: true, kind, accessMode: 'range', contentLength };
  } catch (e) {
    if (isTimeoutOrAbort(e)) {
      return {
        ok: false,
        kind: 'network',
        failure: {
          code: 'network',
          detail: `Preflight timed out after ${REMOTE_PREFLIGHT_TIMEOUT_MS / 1000}s`,
        },
      };
    }
    const msg = clampDetail((e as Error).message || String(e));
    const lower = msg.toLowerCase();
    if (lower.includes('cors')) {
      return {
        ok: false,
        kind: 'cors',
        failure: { code: 'cors', detail: msg || 'CORS error' },
      };
    }
    if (lower.includes('failed to fetch')) {
      return {
        ok: false,
        kind: 'network',
        failure: { code: 'network', detail: msg || 'Failed to fetch' },
      };
    }
    return {
      ok: false,
      kind: 'unknown',
      failure: { code: 'unknown', detail: msg || 'Unknown error' },
    };
  } finally {
    cancel();
  }
}
