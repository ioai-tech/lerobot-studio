/**
 * Components that load as their own chunk. A chunk that fails to load (for
 * example after a redeploy while the tab stayed open) shows a named notice
 * with a retry in its place; the rest of the viewer keeps working.
 */
import React, { Suspense, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { ChunkBoundary } from './ChunkBoundary';
import { ChunkLoadError } from './chunkLoadError';

/**
 * `load` resolves to the component. `fallback` shows while the chunk loads.
 * A retry imports the chunk again (React keeps a failed lazy import failed).
 */
export function lazyChunk<P extends object>(
  load: () => Promise<ComponentType<P>>,
  fallback: ReactNode = null,
): ComponentType<P> {
  const make = () =>
    React.lazy(async () => {
      try {
        return { default: await load() };
      } catch (error) {
        throw new ChunkLoadError(error);
      }
    });
  let Chunk = make();
  function LazyChunk(props: P) {
    const [, setAttempt] = useState(0);
    const retry = () => {
      Chunk = make();
      setAttempt((attempt) => attempt + 1);
    };
    return (
      <ChunkBoundary onRetry={retry}>
        <Suspense fallback={fallback}>
          <Chunk {...props} />
        </Suspense>
      </ChunkBoundary>
    );
  }
  return LazyChunk;
}
