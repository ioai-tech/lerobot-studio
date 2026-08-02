import type { ProgressHandler } from './dataSources';
import {
  TarDataSourceHttp,
  TarDataSourceLocal,
  TarGzDataSourceHttp,
  TarGzDataSourceLocal,
  RemoteFullArchiveDataSource,
  ZipDataSourceHttp,
  ZipDataSourceLocal,
} from './dataSources';

export type ArchiveKind = 'zip' | 'tar' | 'targz';
export type RemoteArchiveAccessMode = 'range' | 'full';

export function getArchiveKindFromUrl(rawUrl: string): ArchiveKind | null {
  // Prefer pathname-based detection (most reliable)
  const pathLower = getPathLower(rawUrl);
  if (pathLower.endsWith('.tar.gz') || pathLower.endsWith('.tgz')) return 'targz';
  if (pathLower.endsWith('.tar')) return 'tar';
  if (pathLower.endsWith('.zip')) return 'zip';

  // Fallback: sometimes the real filename is in query params (e.g. ?filename=xxx.zip)
  // or the API returns a "download" endpoint without extension in pathname.
  // This is best-effort and intentionally simple.
  const fullLower = rawUrl.split('#')[0].toLowerCase();
  if (fullLower.includes('.tar.gz') || fullLower.includes('.tgz')) return 'targz';
  // Note: check ".tar" after ".tar.gz" to avoid misclassifying targz
  if (fullLower.includes('.tar')) return 'tar';
  if (fullLower.includes('.zip')) return 'zip';

  return null;
}

export function getArchiveKindFromFile(file: File): ArchiveKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) return 'targz';
  if (name.endsWith('.tar')) return 'tar';
  if (name.endsWith('.zip')) return 'zip';
  return null;
}

export function getArchiveKindFromHeaders(headers: Headers): ArchiveKind | null {
  // content-disposition may contain filename/filename*
  const cd = headers.get('content-disposition') || '';
  const cdLower = cd.toLowerCase();
  if (cdLower.includes('.tar.gz') || cdLower.includes('.tgz')) return 'targz';
  if (cdLower.includes('.tar')) return 'tar';
  if (cdLower.includes('.zip')) return 'zip';

  // content-type fallback (rough, but useful for same-origin/proxy downloads)
  const ct = (headers.get('content-type') || '').toLowerCase();
  if (ct.includes('zip')) return 'zip';
  if (ct.includes('gzip')) return 'targz';
  if (ct.includes('x-tar') || ct.includes('tar')) return 'tar';
  return null;
}

export function getArchiveKindFromMagicBytes(bytes: Uint8Array): ArchiveKind | null {
  // ZIP local file header / empty archive / spanning signatures.
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(bytes[2]) &&
    [0x04, 0x06, 0x08].includes(bytes[3])
  ) {
    return 'zip';
  }

  // gzip header, used by .tar.gz/.tgz.
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return 'targz';
  }

  // POSIX tar magic string "ustar" at offset 257.
  if (
    bytes.length >= 262 &&
    bytes[257] === 0x75 &&
    bytes[258] === 0x73 &&
    bytes[259] === 0x74 &&
    bytes[260] === 0x61 &&
    bytes[261] === 0x72
  ) {
    return 'tar';
  }

  return null;
}

export function createArchiveDataSourceFromUrl(
  url: string,
  onProgress?: ProgressHandler,
  knownKind?: ArchiveKind,
  options?: { accessMode?: RemoteArchiveAccessMode },
) {
  const kind = knownKind || getArchiveKindFromUrl(url);
  if (!kind) throw new Error('Unsupported archive type (need .zip/.tar/.tar.gz/.tgz)');
  if (options?.accessMode === 'full') {
    return new RemoteFullArchiveDataSource(url, kind, onProgress);
  }
  if (kind === 'targz') return new TarGzDataSourceHttp(url, onProgress);
  if (kind === 'tar') return new TarDataSourceHttp(url);
  return new ZipDataSourceHttp(url);
}

export function createArchiveDataSourceFromFile(file: File, onProgress?: ProgressHandler) {
  const kind = getArchiveKindFromFile(file);
  if (!kind) throw new Error('Unsupported archive type (need .zip/.tar/.tar.gz/.tgz)');
  if (kind === 'targz') return new TarGzDataSourceLocal(file, onProgress);
  if (kind === 'tar') return new TarDataSourceLocal(file);
  return new ZipDataSourceLocal(file);
}

export function getArchiveBasename(rawUrl: string) {
  try {
    const pathname = new URL(rawUrl).pathname;
    const last = pathname.split('/').filter(Boolean).pop() || rawUrl;
    return safeDecodeTwice(last);
  } catch {
    const base = rawUrl.split('#')[0].split('?')[0].split('/').filter(Boolean).pop();
    return base ? safeDecodeTwice(base) : rawUrl;
  }
}

function getPathLower(rawUrl: string) {
  try {
    return new URL(rawUrl).pathname.toLowerCase();
  } catch {
    return rawUrl.split('#')[0].split('?')[0].toLowerCase();
  }
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
