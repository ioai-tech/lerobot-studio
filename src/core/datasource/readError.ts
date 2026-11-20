/**
 * A dataset file could not be read (network, HTTP status, permission). It says
 * nothing about the file's format: a loader reports it as is, never as an
 * invalid file (s10 F-32: offline used to read as "could not be parsed as Parquet").
 */
export const DATASET_READ_FAILED = 'DATASET_READ_FAILED';

/** An error naming a dataset file that could not be read. */
export function datasetReadError(path: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (detail.startsWith(DATASET_READ_FAILED)) return new Error(detail, { cause });
  return new Error(`${DATASET_READ_FAILED}: could not read ${path} (${detail})`, { cause });
}

/** Whether an error names a dataset file that could not be read. */
export function isDatasetReadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return message.startsWith(DATASET_READ_FAILED);
}

/**
 * The one way a data source says "this file is not in the dataset" (an archive,
 * tar, folder, manifest or episode set without that entry): a DOMException
 * named `NotFoundError`, the error the browser's File System Access API
 * throws for a missing entry. A custom `DataSource` throws it too.
 */
export function fileNotFoundError(path: string, where?: string): Error {
  return new DOMException(
    `File not found${where ? ` in ${where}` : ''}: ${path}`,
    'NotFoundError',
  ) as unknown as Error;
}

/**
 * Whether a read failure says the file is not in the dataset (see
 * `fileNotFoundError`): a dataset problem a validator reports, not a failed
 * read. An HTTP 404 for a file a manifest lists is a failed read.
 */
export function isMissingFileError(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'NotFoundError';
}
