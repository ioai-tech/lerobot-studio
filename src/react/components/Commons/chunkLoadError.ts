/** Error code of a chunk that could not be loaded. */
export const CHUNK_LOAD_FAILED = 'CHUNK_LOAD_FAILED';

/** The import of a chunk failed (other errors of its component pass through). */
export class ChunkLoadError extends Error {
  readonly code = CHUNK_LOAD_FAILED;
  constructor(cause: unknown) {
    super(`${CHUNK_LOAD_FAILED}: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
    this.name = 'ChunkLoadError';
  }
}
