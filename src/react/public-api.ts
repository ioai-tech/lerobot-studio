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
  EpisodeSetDataSource,
  type EpisodeSetManifest,
  type EpisodeSetOptions,
} from '../platform/datasource/EpisodeSetDataSource';
import {
  RemoteManifestDataSource,
  type RemoteFileEntry,
  type RemoteManifestOptions,
  type RemoteManifestRefreshResult,
} from '../platform/datasource/RemoteManifestDataSource';

export { LeRobotViewer, LeRobotViewerContent } from './components/LeRobotViewer';
export { preloadLeRobotViewer } from './preload';
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
  ByteRangeResult,
  DataSource,
  LoadingPhase,
  ProgressHandler,
  ProgressInfo,
} from '../core/datasource/types';
export type { RemoteFileEntry, RemoteManifestOptions, RemoteManifestRefreshResult };
export { RemoteSourceError } from '../platform/datasource/signedUrls';
export { fileNotFoundError } from '../core/datasource/readError';
export { EpisodeSetError } from '../platform/datasource/EpisodeSetDataSource';
export type {
  EpisodeSetEpisode,
  EpisodeSetErrorCode,
  EpisodeSetManifest,
  EpisodeSetOptions,
  EpisodeSetRecording,
  EpisodeSetResolvedRecording,
} from '../platform/datasource/EpisodeSetDataSource';
export type { RemoteSourceErrorCode } from '../platform/datasource/signedUrls';
export type {
  AuxiliarySeries,
  AuxiliarySeriesWarning,
  AuxiliarySeriesWarningCode,
} from '../platform/services/auxiliarySeries';
export type {
  AnnotationChangeMeta,
  LeRobotAnnotationProps,
  LeRobotAnnotationSaveState,
} from './contexts/annotationTypes';
export type {
  LeRobotExtension,
  LeRobotInitialSelection,
  LeRobotNotice,
  LeRobotSelection,
  LeRobotThemeColors,
  LeRobotThemeTokens,
  LeRobotToolbarButton,
  LeRobotToolbarIcon,
  LeRobotToolbarItem,
  LeRobotToolbarLink,
  LeRobotToolbarToggle,
} from './contexts/hostTypes';
export type {
  OverlaySegment,
  OverlaySegmentGroup,
  TimelineMarker,
} from '../core/annotation/markers';
export { LEROBOT_MESSAGE_KEYS } from './i18n/messageKeys';
export type { LeRobotMessageKey, LeRobotMessages } from './i18n/messageKeys';
export type {
  AnnotationChange,
  AnnotationChangeOp,
  AnnotationContext,
  AnnotationDocument,
  AnnotationField,
  AnnotationRefusal,
  AnnotationRefusalCode,
  ApplyChangeResult,
  ReviewState,
  Segment,
  SegmentFieldValue,
  SegmentOrigin,
  SegmentPatch,
  SegmentStatus,
  SegmentSubtask,
} from '../core/annotation/types';
export { applyChange } from '../core/annotation/reducer';
export { setParquetWasmUrl } from '../platform/workers/wasmConfig';

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
 * browser can stream media with Range requests. Pass `refresh` to renew
 * signed URLs (401/403 or within 60 s of `expiresAt`) without reloading the
 * dataset, and `episodeScope` to show only some episodes.
 */
export function createRemoteManifestDataSource(
  files: RemoteFileEntry[],
  options?: RemoteManifestOptions,
): DataSource {
  return new RemoteManifestDataSource(files, undefined, options);
}

/**
 * Create a read-only dataset view over episodes (row ranges) of several
 * one-episode LeRobot v3 trees. Opening signs nothing; selecting an episode
 * resolves its recording (batched with the next two episodes' recordings).
 */
export function createEpisodeSetDataSource(
  manifest: EpisodeSetManifest,
  options?: EpisodeSetOptions,
): DataSource {
  return new EpisodeSetDataSource(manifest, options);
}

/** Create a viewer data source from a File System Access directory handle. */
export function createDirectoryDataSource(handle: FileSystemDirectoryHandle): DataSource {
  return new DirectoryDataSource(handle);
}
