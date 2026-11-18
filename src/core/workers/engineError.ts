/**
 * The Parquet reader (the parquet WASM) could not be loaded or started. It
 * says nothing about the data: a loader reports it as is, never as an
 * invalid file.
 */
export const PARQUET_ENGINE_UNAVAILABLE = 'PARQUET_ENGINE_UNAVAILABLE';

/** An error naming a Parquet reader that could not be loaded. */
export function parquetEngineError(cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (detail.startsWith(PARQUET_ENGINE_UNAVAILABLE)) return new Error(detail);
  return new Error(
    `${PARQUET_ENGINE_UNAVAILABLE}: the Parquet reader could not be loaded (${detail})`,
  );
}

/** Whether an error (also one passed from a worker) names an unavailable Parquet reader. */
export function isParquetEngineError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return message.startsWith(PARQUET_ENGINE_UNAVAILABLE);
}
