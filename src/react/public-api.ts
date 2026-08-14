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
import {
  RemoteManifestDataSource,
  type RemoteFileEntry,
} from '../platform/datasource/RemoteManifestDataSource';

export { LeRobotViewer } from './components/LeRobotViewer';
export type {
  LeRobotViewerError,
  LeRobotViewerErrorCode,
  LeRobotViewerProps,
} from './components/LeRobotViewer';
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
