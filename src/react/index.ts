import './index.css';

// ── Composition roots ──────────────────────────────────────────────
export { LeRobotViewer, LeRobotViewerContent } from './components/LeRobotViewer';
export type { LeRobotViewerProps } from './components/LeRobotViewer';
export { LeRobotWelcome } from './components/LeRobotWelcome';
export type { LeRobotWelcomeProps } from './components/LeRobotWelcome';
export { LeRobotStudioProvider } from './components/LeRobotStudioProvider';
export type { LeRobotStudioProviderProps } from './components/LeRobotStudioProvider';
/** @deprecated Prefer LeRobotStudioProvider */
export { LeRobotProvider } from './components/LeRobotStudioProvider';
export { LeRobotContent } from './components/LeRobotContent';
export { ViewerLayout } from './features/viewer/ViewerLayout';
export type { ViewerLayoutProps } from './features/viewer/ViewerLayout';
export { ErrorBoundary } from './components/ErrorBoundary';

// ── Dataset provider (domain) ──────────────────────────────────────
export { LeRobotDataProvider } from './contexts/LeRobotProvider';
/** @deprecated Prefer LeRobotDataProvider */
export { LeRobotProvider as LeRobotDatasetProvider } from './contexts/LeRobotProvider';

// ── Shell / chrome components ──────────────────────────────────────
export { Navbar } from './components/Navbar';
export { SidebarTabs } from './components/Sidebar/SidebarTabs';
export { EpisodeSidebar } from './components/Sidebar/EpisodeSidebar';
export { PlaybackBar } from './components/Playback/PlaybackBar';
export { WelcomeScreen } from './components/WelcomeScreen';
export { DatasetSourceSelector } from './components/DatasetSourceSelector';
export { ExportDialog } from './components/dialogs/ExportDialog';
export { DatasetHealthDialog } from './components/DatasetHealthDialog';
export { SampleDatasetCard } from './components/open/SampleDatasetCard';
export { SampleDatasetDialog } from './components/open/SampleDatasetDialog';
export { OpenRemoteArchiveDialog } from './components/open/OpenRemoteArchiveDialog';
export { RemoteArchiveOpenForm } from './components/open/RemoteArchiveOpenForm';
export { Pagination } from './components/Pagination';
export type { PaginationProps } from './components/Pagination';
export { Toaster } from './components/ui/toaster';

// ── Contexts & hooks ───────────────────────────────────────────────
export {
  useLeRobot,
  useLeRobotData,
  useLeRobotPlayback,
  useLeRobotSelection,
  useLeRobotUi,
} from './contexts/LeRobotContext';
export { ThemeProvider } from './contexts/ThemeProvider';
export { useTheme } from './contexts/ThemeContext';
export { LoadingProvider, useLoading } from './contexts/LoadingContext';
export type { LoadingPhase, LoadingTask } from './contexts/LoadingContext';
export { ToastProvider, useToast } from './contexts/ToastContext';
export type { ToastType, ToastMessage } from './contexts/ToastContext';
export { I18nProvider, useI18nController, useTranslationBridge } from './i18n/core';
export { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
export { useOpenHistory } from './hooks/useOpenHistory';
export type { HistoryItem, HistoryItemKind } from './hooks/useOpenHistory';
export { useSampleDatasets } from './hooks/useSampleDatasets';
export { useDragAndDrop } from './utils/dragAndDrop';

// ── URL types (shared with the standalone app shell) ──────────────
export type { SourceKind, ParsedSourceUrl } from './utils/sourceUrlTypes';

// ── Platform re-exports for embed convenience ──────────────────────
export {
  createArchiveDataSourceFromFile,
  createArchiveDataSourceFromUrl,
  DirectoryDataSource,
  RemoteManifestDataSource,
} from '@/platform';

export type { LeRobotInfo, EpisodeMetadata, FrameData, DataSource } from '@/core';
export type { RemoteFileEntry } from '@/platform';
