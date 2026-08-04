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
