/**
 * Client-only React viewer for supported LeRobot datasets.
 *
 * @packageDocumentation
 */
import type { DataSource } from '../core/datasource/types';
import {
  createArchiveDataSourceFromFile as createArchiveDataSourceFromFileInternal,
  createArchiveDataSourceFromUrl as createArchiveDataSourceFromUrlInternal,
} from '../platform/datasource/ArchiveDataSourceFactory';
import { DirectoryDataSource } from '../platform/datasource/dataSources';
import {
  RemoteManifestDataSource,
  type RemoteFileEntry,
} from '../platform/datasource/RemoteManifestDataSource';

export { LeRobotViewer, LeRobotViewerContent } from './components/LeRobotViewer';
export type {
  LeRobotViewerError,
  LeRobotViewerErrorCode,
  LeRobotViewerProps,
} from './components/LeRobotViewer';
export { LeRobotStudioProvider, LeRobotProvider } from './components/LeRobotStudioProvider';
export type { LeRobotStudioProviderProps } from './components/LeRobotStudioProvider';
export { DatasetSourceSelector } from './components/DatasetSourceSelector';
export type { DatasetSourceSelectorProps } from './components/DatasetSourceSelector';
export { SampleDatasetCard } from './components/open/SampleDatasetCard';
export type { SampleDatasetCardProps } from './components/open/SampleDatasetCard';
export type { SampleDataset } from '../platform/datasource/sampleDatasets';
export { Pagination } from './components/Pagination';
export type { PaginationProps } from './components/Pagination';
export { useDragAndDrop } from './utils/dragAndDrop';
export type { DirectoryFile, DragAndDropCallbacks } from './utils/dragAndDrop';
export type { ParsedSourceUrl, SourceKind } from './utils/sourceUrlTypes';
export type {
  DataSource,
  LoadingPhase,
  ProgressHandler,
  ProgressInfo,
} from '../core/datasource/types';
export type { RemoteFileEntry };

/** Create a viewer data source for a local ZIP, TAR, or TAR.GZ archive. */
export function createArchiveDataSourceFromFile(file: File): DataSource {
  return createArchiveDataSourceFromFileInternal(file);
}

/**
 * Create a viewer data source for a remote archive.
 *
 * The host must provide appropriate CORS and HTTP Range support.
 */
export function createArchiveDataSourceFromUrl(url: string): DataSource {
  return createArchiveDataSourceFromUrlInternal(url);
}

/**
 * Create a viewer data source from a host-owned list of per-file HTTP(S) URLs.
 *
 * Use this when the host already signed individual dataset files and must not
 * download a full archive. `getObjectUrl` returns the remote URL so the
 * browser can stream media with Range requests.
 */
export function createRemoteManifestDataSource(files: RemoteFileEntry[]): DataSource {
  return new RemoteManifestDataSource(files);
}

/** Create a viewer data source from a File System Access directory handle. */
export function createDirectoryDataSource(handle: FileSystemDirectoryHandle): DataSource {
  return new DirectoryDataSource(handle);
}
