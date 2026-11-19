import { loadDataLoaderModule, loadDockviewLayout, loadWorkerManager } from './lazyChunks';

/**
 * Start what every viewer open waits for, before a data source exists: the
 * viewer's lazily loaded layout and loader code, and one Parquet worker,
 * which downloads and compiles the parquet WASM in the background (nothing
 * is compiled on the page). The next viewer to open adopts that worker; if
 * none opens within 30 s it is terminated.
 *
 * Call it as early as the host knows a viewer will open: on the viewer's
 * route before its data source is ready, or when a person points at a link
 * that opens one. Call `setParquetWasmUrl` first if you serve the WASM
 * yourself. Repeated calls share the same work. It never throws and does
 * nothing outside a browser (server rendering); a failure here is reported,
 * by name, when the viewer opens.
 *
 * @public
 */
export function preloadLeRobotViewer(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const settle = (start: () => unknown) => {
    try {
      const pending = start();
      if (pending instanceof Promise) pending.catch(() => undefined);
    } catch {
      // Reported when the viewer opens.
    }
  };
  settle(loadDataLoaderModule);
  settle(loadDockviewLayout);
  settle(() => loadWorkerManager().then((workers) => workers.prewarmParquetWorker()));
}
