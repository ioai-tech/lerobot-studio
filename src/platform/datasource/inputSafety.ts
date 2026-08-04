export interface DataSourceSafetyLimits {
  maxArchiveEntries: number;
  maxArchiveEntryBytes: number;
  maxArchiveTotalBytes: number;
  maxMaterializedBytes: number;
  maxPathLength: number;
  maxPathDepth: number;
  maxCompressionRatio: number;
  compressionRatioFloorBytes: number;
  maxTarGzOutputBytes: number;
  maxManifestEntries: number;
  maxManifestEntryBytes: number;
  maxManifestTotalBytes: number;
  maxManifestUrlLength: number;
}

export const DEFAULT_DATA_SOURCE_SAFETY_LIMITS: Readonly<DataSourceSafetyLimits> = Object.freeze({
  maxArchiveEntries: 250_000,
  maxArchiveEntryBytes: 16 * 1024 ** 3,
  maxArchiveTotalBytes: 4 * 1024 ** 4,
  maxMaterializedBytes: 512 * 1024 ** 2,
  maxPathLength: 1024,
  maxPathDepth: 64,
  maxCompressionRatio: 1000,
  compressionRatioFloorBytes: 1024 * 1024,
  maxTarGzOutputBytes: 512 * 1024 ** 2,
  maxManifestEntries: 250_000,
  maxManifestEntryBytes: 64 * 1024 ** 3,
  maxManifestTotalBytes: 16 * 1024 ** 4,
  maxManifestUrlLength: 16 * 1024,
});

export type DataSourceSafetyErrorCode =
  | 'ENTRY_COUNT_LIMIT'
  | 'ENTRY_SIZE_LIMIT'
  | 'TOTAL_SIZE_LIMIT'
  | 'MATERIALIZED_SIZE_LIMIT'
  | 'PATH_INVALID'
  | 'PATH_LENGTH_LIMIT'
  | 'PATH_DEPTH_LIMIT'
  | 'DUPLICATE_PATH'
  | 'COMPRESSION_RATIO_LIMIT'
  | 'ARCHIVE_TRUNCATED'
  | 'MANIFEST_INVALID'
  | 'URL_INVALID';

export class DataSourceSafetyError extends Error {
  readonly name = 'DataSourceSafetyError';
  readonly code: DataSourceSafetyErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: DataSourceSafetyErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function resolveSafetyLimits(
  overrides?: Partial<DataSourceSafetyLimits>,
): Readonly<DataSourceSafetyLimits> {
  const limits = { ...DEFAULT_DATA_SOURCE_SAFETY_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`Invalid data-source safety limit ${name}: ${value}`);
    }
  }
  return limits;
}

export function validateUntrustedPath(
  rawPath: string,
  limits: Readonly<DataSourceSafetyLimits>,
): string {
  if (
    !rawPath ||
    rawPath.includes('\0') ||
    rawPath.startsWith('/') ||
    rawPath.startsWith('\\') ||
    /^[a-zA-Z]:[\\/]/.test(rawPath)
  ) {
    throw new DataSourceSafetyError('PATH_INVALID', 'Archive path is empty or absolute', {
      path: rawPath,
    });
  }

  const normalized = rawPath
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/{2,}/g, '/');
  const segments = normalized.split('/');
  if (!normalized || segments.every((segment) => !segment || segment === '.')) {
    throw new DataSourceSafetyError('PATH_INVALID', 'Archive path is empty after normalization', {
      path: rawPath,
    });
  }
  if (segments.some((segment) => segment === '..')) {
    throw new DataSourceSafetyError('PATH_INVALID', 'Archive path attempts to escape its root', {
      path: rawPath,
    });
  }
  if (normalized.length > limits.maxPathLength) {
    throw new DataSourceSafetyError('PATH_LENGTH_LIMIT', 'Archive path is too long', {
      pathLength: normalized.length,
      limit: limits.maxPathLength,
    });
  }
  const depth = segments.filter((segment) => segment && segment !== '.').length;
  if (depth > limits.maxPathDepth) {
    throw new DataSourceSafetyError('PATH_DEPTH_LIMIT', 'Archive path is too deep', {
      depth,
      limit: limits.maxPathDepth,
    });
  }
  return normalized;
}

export function validateEntrySizes(
  path: string,
  uncompressedSize: number,
  compressedSize: number | undefined,
  currentTotal: number,
  limits: Readonly<DataSourceSafetyLimits>,
): number {
  if (!Number.isSafeInteger(uncompressedSize) || uncompressedSize < 0) {
    throw new DataSourceSafetyError('ENTRY_SIZE_LIMIT', 'Archive entry has an invalid size', {
      path,
      size: uncompressedSize,
    });
  }
  if (
    compressedSize !== undefined &&
    (!Number.isSafeInteger(compressedSize) || compressedSize < 0)
  ) {
    throw new DataSourceSafetyError(
      'ENTRY_SIZE_LIMIT',
      'Archive entry has an invalid compressed size',
      { path, compressedSize },
    );
  }
  if (uncompressedSize > limits.maxArchiveEntryBytes) {
    throw new DataSourceSafetyError('ENTRY_SIZE_LIMIT', 'Archive entry exceeds the size limit', {
      path,
      size: uncompressedSize,
      limit: limits.maxArchiveEntryBytes,
    });
  }
  const total = currentTotal + uncompressedSize;
  if (!Number.isSafeInteger(total) || total > limits.maxArchiveTotalBytes) {
    throw new DataSourceSafetyError('TOTAL_SIZE_LIMIT', 'Archive exceeds the total size limit', {
      total,
      limit: limits.maxArchiveTotalBytes,
    });
  }
  if (
    compressedSize !== undefined &&
    uncompressedSize >= limits.compressionRatioFloorBytes &&
    (compressedSize <= 0 || uncompressedSize / compressedSize > limits.maxCompressionRatio)
  ) {
    throw new DataSourceSafetyError(
      'COMPRESSION_RATIO_LIMIT',
      'Archive entry has a suspicious compression ratio',
      { path, compressedSize, uncompressedSize, limit: limits.maxCompressionRatio },
    );
  }
  return total;
}

export function assertMaterializable(
  path: string,
  size: number | undefined,
  limits: Readonly<DataSourceSafetyLimits>,
): void {
  if (size !== undefined && size > limits.maxMaterializedBytes) {
    throw new DataSourceSafetyError(
      'MATERIALIZED_SIZE_LIMIT',
      'File is too large to materialize safely in memory',
      { path, size, limit: limits.maxMaterializedBytes },
    );
  }
}
