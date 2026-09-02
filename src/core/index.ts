export type {
  LeRobotInfo,
  EpisodeMetadata,
  FrameData,
  LeRobotFeature,
  EpisodeMetadataV3,
  PlaybackMode,
} from './types/lerobot';
export { isV2Info, isV3Info, isV3Metadata } from './types/lerobot';

export type { DataSource, ProgressHandler, ProgressInfo, LoadingPhase } from './datasource/types';

export type { NumericalColumnData, NumericalColumnMap, EpisodeTableLoader } from './loader/types';

export * from './versioning';
export type { ExportAdapter, ExportFormat as AdapterExportFormat } from './export/ExportAdapter';
export type {
  ExportFormat,
  ExportProgress,
  ExportManifest,
  ExportOptions,
  TargetVersion,
  EpisodeVideoOffsets,
  V3DataEpisodeLocation,
  V3DataLayout,
} from './export/types';

export { computeSplits, splitsIndicesToInfoSplits } from './analysis/SplitService';
export type { SplitStrategy, SplitConfig, SplitsIndices } from './analysis/SplitService';
export type {
  FeatureStats,
  DatasetStats,
  StatsArray,
  StatsDataLoader,
  NumericFeatureRow,
  NumericStatsRowContext,
  ComputeDatasetStatsOptions,
} from './analysis/StatsService';
export { aggregateEpisodeStats, computeDatasetStats } from './analysis/StatsService';

export {
  getEagerEpisodeColumns,
  buildPlaybackFrames,
  getFirstAvailableEpisodeIndex,
} from './playback/episodeLoadPlan';
export { shouldStartAutoplay } from './playback/playbackAutoplay';
export type { AutoplayDecisionInput } from './playback/playbackAutoplay';

export * from './utils/featureUtils';
export * from './utils/datasetDisplayName';
export * from './utils/mediaFeatureMetadata';
export * from './utils/imageColumns';
export * from './utils/depthImage';
export * from './utils/episodeKeyboard';
export * from './utils/chartTooltipPlacement';

export * from './panels/selectionModel';
export * from './panels/filterGrouping';
export * from './panels/chartFeatureSelection';
export * from './panels/chartFilterGrouping';
export * from './panels/splitChartConstants';
export * from './panels/imagePanelLoadGuards';
export * from './panels/imagePanelRequestUtils';
export type { ChartSeriesKind, ChartDimensionMeta } from './panels/chartTypes';

export type { ParquetWorkerAPI, ParquetImageWorkerAPI } from './workers/types';

export * from './subtask';
