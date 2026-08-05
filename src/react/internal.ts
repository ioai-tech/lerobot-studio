import './index.css';

// Internal web-app barrel. This file is deliberately not part of the npm exports.
export * from './index';
export { LeRobotViewerContent } from './components/LeRobotViewer';
export { LeRobotWelcome } from './components/LeRobotWelcome';
export type { LeRobotWelcomeProps } from './components/LeRobotWelcome';
export { LeRobotStudioProvider, LeRobotProvider } from './components/LeRobotStudioProvider';
export type { LeRobotStudioProviderProps } from './components/LeRobotStudioProvider';
export { LeRobotContent } from './components/LeRobotContent';
export { ViewerLayout } from './features/viewer/ViewerLayout';
export type { ViewerLayoutProps } from './features/viewer/ViewerLayout';
export { ErrorBoundary } from './components/ErrorBoundary';
export {
  LeRobotDataProvider,
  LeRobotProvider as LeRobotDatasetProvider,
} from './contexts/LeRobotProvider';
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
export type { SourceKind, ParsedSourceUrl } from './utils/sourceUrlTypes';
