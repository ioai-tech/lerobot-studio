import { loadParquetWasm } from '../platform/workers/workerManager';
import { loadDataLoaderModule, loadDockviewLayout } from './lazyChunks';

/**
 * Start what every viewer open waits for, before a data source exists: the
 * parquet WASM (downloaded once; compiled once on the page, or by each worker
 * under a page CSP without 'wasm-unsafe-eval'; reused by every loader) and
 * the viewer's lazily loaded layout and loader code.
 *
 * Call it as early as the host knows a viewer will open: on the viewer's
 * route before its data source is ready, or when a person points at a link
 * that opens one. Repeated calls share the same work. It never throws and
 * does nothing outside a browser (server rendering); a failure here is
 * reported, by name, when the viewer opens.
 *
 * @public
 */
export function preloadLeRobotViewer(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const settle = (start: () => Promise<unknown>) => {
    try {
      start().catch(() => undefined);
    } catch {
      // Reported when the viewer opens.
    }
  };
  if (typeof WebAssembly !== 'undefined') settle(loadParquetWasm);
  settle(loadDataLoaderModule);
  settle(loadDockviewLayout);
}
