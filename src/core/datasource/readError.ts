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
