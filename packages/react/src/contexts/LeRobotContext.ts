import { createContext, useContext } from 'react';
import type {
  LeRobotInfo,
  EpisodeMetadata,
  FrameData,
  PlaybackMode,
} from '@ioai/lerobot-studio-core';
import type { LeRobotDataLoader } from '@ioai/lerobot-studio-platform';
import type { NumericalColumnMap } from '@ioai/lerobot-studio-platform';
import type { DataSource } from '@ioai/lerobot-studio-platform';
import type { ParquetImageServiceImpl } from '@ioai/lerobot-studio-platform';
import type { ValidationReport } from '@ioai/lerobot-studio-core';

// 帧索引订阅者回调类型
export type FrameIndexSubscriber = (frameIndex: number) => void;

/** RawPanel 等仅需数据与订阅的组件使用，避免播放状态变化触发重渲染 */
export interface LeRobotDataContextType {
  info: LeRobotInfo | null;
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

/** Presentation-only UI state (dialogs), kept out of domain contexts */
export interface LeRobotUiContextType {
  healthDialogOpen: boolean;
  setHealthDialogOpen: (open: boolean) => void;
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
    LeRobotUiContextType {}

export const LeRobotContext = createContext<LeRobotContextType | null>(null);
export const LeRobotDataContext = createContext<LeRobotDataContextType | null>(null);
export const LeRobotPlaybackContext = createContext<LeRobotPlaybackContextType | null>(null);
export const LeRobotSelectionContext = createContext<LeRobotSelectionContextType | null>(null);
export const LeRobotUiContext = createContext<LeRobotUiContextType | null>(null);

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
