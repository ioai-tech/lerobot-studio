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
  EPISODE_SET_PREVIEW_VIDEO_PATH,
  EpisodeSetDataSource,
  type EpisodeSetEpisode,
  type EpisodeSetManifest,
  type EpisodeSetOptions,
  type EpisodeSetRecording,
} from '../platform/datasource/EpisodeSetDataSource';
import {
  RemoteManifestDataSource,
  type RemoteFileEntry,
  type RemoteManifestOptions,
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
  RangeReadOptions,
} from '../core/datasource/types';
export type { RemoteFileEntry, RemoteManifestOptions };
export type { EpisodeSetEpisode, EpisodeSetManifest, EpisodeSetOptions, EpisodeSetRecording };
export { EPISODE_SET_PREVIEW_VIDEO_PATH };

/**
 * Create a viewer data source that plays episodes of several recordings (a curated dataset
 * version) as one dataset, from each recording's own presigned files. Pass
 * `EPISODE_SET_PREVIEW_VIDEO_PATH` as the viewer's `previewVideoPath` to play preview copies.
 */
export function createEpisodeSetDataSource(
  manifest: EpisodeSetManifest,
  options?: EpisodeSetOptions,
): DataSource {
  return new EpisodeSetDataSource(manifest, options);
}

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
export function createRemoteManifestDataSource(
  files: RemoteFileEntry[],
  options?: RemoteManifestOptions,
): DataSource {
  return new RemoteManifestDataSource(files, undefined, options);
}

/** Create a viewer data source from a File System Access directory handle. */
export function createDirectoryDataSource(handle: FileSystemDirectoryHandle): DataSource {
  return new DirectoryDataSource(handle);
}
