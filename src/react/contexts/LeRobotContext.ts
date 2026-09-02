import { createContext, useContext } from 'react';
import type {
  LeRobotInfo,
  EpisodeMetadata,
  FrameData,
  PlaybackMode,
  LeRobotVersionCapability,
} from '@/core';
import type { LeRobotDataLoader } from '@/platform';
import type { NumericalColumnMap } from '@/platform';
import type { DataSource } from '@/platform';
import type { ParquetImageServiceImpl } from '@/platform';
import type { ValidationReport, SubtaskSegment, SubtaskCoverage, SubtaskTable } from '@/core';
import type { PendingSubtaskRange } from './useSubtaskAnnotation';

// 帧索引订阅者回调类型
export type FrameIndexSubscriber = (frameIndex: number) => void;

/** RawPanel 等仅需数据与订阅的组件使用，避免播放状态变化触发重渲染 */
export interface LeRobotDataContextType {
  info: LeRobotInfo | null;
  versionCapability: LeRobotVersionCapability | null;
  isReadOnly: boolean;
  featureData: Record<string, unknown[]>;
  subscribeFeature: (featureName: string) => Promise<void>;
  unsubscribeFeature: (featureName: string) => void;
  subscribeFrameIndex: (callback: FrameIndexSubscriber) => () => void;
  getFrameIndex: () => number;
  dataLoader: LeRobotDataLoader | null;
  /** Isolated per LeRobotDataProvider; never use the deprecated module singleton in UI code. */
  imageService: ParquetImageServiceImpl;
  episodes: EpisodeMetadata[];
  tasks: Record<number, string>;
  subtasks: SubtaskTable;
  lastValidationReport: ValidationReport | null;
  initialize: (dataSource: DataSource | FileSystemDirectoryHandle) => Promise<void>;
  reset: () => Promise<void>;
  clearError: () => void;
  error: string | null;
  isLoading: boolean;
}

/** Episode / export selection — changes shouldn't re-render video panels */
export interface LeRobotSelectionContextType {
  selectedEpisodeIndex: number | null;
  selectedEpisodeIndices: Set<number>;
  toggleEpisodeSelection: (index: number) => void;
  setSelectedEpisodeIndices: (indices: Set<number>) => void;
  selectAllInList: (indices: number[]) => void;
  clearEpisodeSelection: () => void;
  deletedEpisodes: Set<number>;
  modifiedEpisodes: Map<number, Partial<EpisodeMetadata>>;
  effectiveEpisodes: EpisodeMetadata[];
  episodesForExport: EpisodeMetadata[];
  editEpisodeTask: (episodeIndex: number, newTask: string) => void;
  deleteEpisode: (episodeIndex: number) => void;
  restoreEpisode: (episodeIndex: number) => void;
  getEffectiveEpisode: (episode: EpisodeMetadata) => EpisodeMetadata;
  selectEpisode: (index: number) => Promise<boolean>;
}

/** 播放控制、帧与 chart 数据 */
export interface LeRobotPlaybackContextType {
  currentFrames: FrameData[];
  chartData: NumericalColumnMap;
  currentFrameIndex: number;
  isPlaying: boolean;
  playbackMode: PlaybackMode;
  playbackSpeed: number;
  setFrameIndex: (index: number) => void;
  togglePlay: () => void;
  setPlaying: (target: boolean) => void;
  seek: (offset: number) => void;
  setPlaybackMode: (mode: PlaybackMode) => void;
  setPlaybackSpeed: (speed: number) => void;
}

export interface LeRobotSubtaskContextType {
  canAnnotate: boolean;
  overlay: ReadonlyMap<number, SubtaskSegment[]>;
  currentSegments: SubtaskSegment[];
  knownLabels: string[];
  coverage: SubtaskCoverage;
  pendingStart: number | null;
  pendingRange: PendingSubtaskRange | null;
  labelAtFrame: (frameIndex: number) => string | null;
  markStart: (frameIndex: number) => void;
  markEnd: (frameIndex: number) => boolean;
  cancelPending: () => void;
  commitPending: (label: string) => void;
  updateSegment: (index: number, segment: SubtaskSegment) => void;
  removeSegment: (index: number) => void;
  jumpToFrame: (frameIndex: number) => void;
}

/** Presentation-only UI state (dialogs), kept out of domain contexts */
export interface LeRobotUiContextType {
  healthDialogOpen: boolean;
  setHealthDialogOpen: (open: boolean) => void;
  subtaskDialogOpen: boolean;
  setSubtaskDialogOpen: (open: boolean) => void;
}

/**
 * @deprecated Prefer useLeRobotData / useLeRobotPlayback / useLeRobotSelection / useLeRobotUi.
 * Aggregated context re-renders on any domain change.
 */
export interface LeRobotContextType
  extends
    LeRobotDataContextType,
    LeRobotSelectionContextType,
    LeRobotPlaybackContextType,
    LeRobotSubtaskContextType,
    LeRobotUiContextType {}

export const LeRobotContext = createContext<LeRobotContextType | null>(null);
export const LeRobotDataContext = createContext<LeRobotDataContextType | null>(null);
export const LeRobotPlaybackContext = createContext<LeRobotPlaybackContextType | null>(null);
export const LeRobotSelectionContext = createContext<LeRobotSelectionContextType | null>(null);
export const LeRobotUiContext = createContext<LeRobotUiContextType | null>(null);
export const LeRobotSubtaskContext = createContext<LeRobotSubtaskContextType | null>(null);

/** @deprecated Prefer domain hooks (useLeRobotData / useLeRobotPlayback / useLeRobotSelection). */
export const useLeRobot = () => {
  const context = useContext(LeRobotContext);
  if (!context) throw new Error('useLeRobot must be used within LeRobotDataProvider');
  return context;
};

export const useLeRobotData = () => {
  const context = useContext(LeRobotDataContext);
  if (!context) throw new Error('useLeRobotData must be used within LeRobotDataProvider');
  return context;
};

export const useLeRobotPlayback = () => {
  const context = useContext(LeRobotPlaybackContext);
  if (!context) throw new Error('useLeRobotPlayback must be used within LeRobotDataProvider');
  return context;
};

export const useLeRobotSelection = () => {
  const context = useContext(LeRobotSelectionContext);
  if (!context) throw new Error('useLeRobotSelection must be used within LeRobotDataProvider');
  return context;
};

export const useLeRobotUi = () => {
  const context = useContext(LeRobotUiContext);
  if (!context) throw new Error('useLeRobotUi must be used within LeRobotDataProvider');
  return context;
};

export const useLeRobotSubtask = () => {
  const context = useContext(LeRobotSubtaskContext);
  if (!context) throw new Error('useLeRobotSubtask must be used within LeRobotDataProvider');
  return context;
};
