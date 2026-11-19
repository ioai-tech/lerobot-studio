// The viewer's lazily loaded chunks, each behind one loader so the viewer and
// `preloadLeRobotViewer` start the same import. Internal: not public API.

/** The viewer's layout chunk (dockview and the panels). */
export const loadDockviewLayout = () => import('./components/DockviewLayout');

/** The data loader chunk (Arrow, the dataset adapters). */
export const loadDataLoaderModule = () => import('../platform/services/LeRobotDataLoader');

/** The worker manager chunk (worker and WASM URLs, Comlink); shared with the loader. */
export const loadWorkerManager = () => import('../platform/workers/workerManager');
