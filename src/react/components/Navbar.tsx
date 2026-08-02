import React, { useMemo } from 'react';
import { Button } from '@/ui';
import {
  FolderOpen,
  PanelLeftClose,
  PanelRightClose,
  PanelBottomClose,
  PanelBottomOpen,
  HardDrive,
  Archive,
  Globe2,
  History,
  Database,
  Loader2,
  Home,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ThemeToggle } from './ThemeToggle';
import { LanguageToggle } from './LanguageToggle';
import { Separator } from '@/ui';
import { ExportButton } from './ExportButton';
import { cn } from '@/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/ui';
import { useLoading } from '../contexts/LoadingContext';
import type { HistoryItem } from '../hooks/useOpenHistory';
import type { ValidationReport } from '@/core';
import { resolveHistoryClickAction } from '../utils/historyNavigation';
import { supportsHandlePersistence } from '@/platform';

interface NavbarProps {
  onOpenDirectory?: () => void;
  onOpenLocalArchive?: () => void;
  onOpenRemoteArchive?: (url?: string) => void;
  onOpenSample?: () => void;
  onOpenUrl?: (url: string) => void;
  onRestoreHistory?: (item: HistoryItem) => void;
  onGoHome?: () => void;
  onExport?: () => void;
  history?: HistoryItem[];
  datasetName?: string;
  sidebarVisible?: boolean;
  playbackBarVisible?: boolean;
  onToggleSidebar?: () => void;
  onTogglePlaybackBar?: () => void;
  validationReport?: ValidationReport | null;
  onOpenHealth?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenDirectory,
  onOpenLocalArchive,
  onOpenRemoteArchive,
  onOpenSample,
  onOpenUrl,
  onRestoreHistory,
  onGoHome,
  onExport,
  history = [],
  datasetName,
  sidebarVisible = true,
  playbackBarVisible = true,
  onToggleSidebar,
  onTogglePlaybackBar,
  validationReport = null,
  onOpenHealth,
}) => {
  const { t } = useTranslation();
  const { tasks } = useLoading();

  const activeTask = useMemo(() => {
    // Only show "truly running" tasks
    const running = tasks.find(
      (tk) => tk.phase !== 'ready' && tk.phase !== 'error' && tk.phase !== 'idle',
    );
    const errored = tasks.find((tk) => tk.phase === 'error');
    return running || errored || undefined;
  }, [tasks]);

  const percent = useMemo(() => {
    if (!activeTask || !activeTask.total || activeTask.total <= 0) return undefined;
    if ((activeTask.loaded || 0) <= 0) return undefined;
    return Math.min(100, Math.round(((activeTask.loaded || 0) / activeTask.total) * 100));
  }, [activeTask]);

  const isLoading = useMemo(() => {
    return activeTask && activeTask.phase !== 'error' && !percent;
  }, [activeTask, percent]);

  const displayName = datasetName || t('common.companyName');

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background">
      <div className="flex h-12 items-center px-4 gap-4 relative">
        {/* Left: Open & History */}
        <div className="flex items-center gap-2 mr-auto">
          {datasetName && onGoHome && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    onClick={onGoHome}
                  />
                }
              >
                <Home className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('navbar.goHome')}</TooltipContent>
            </Tooltip>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                />
              }
            >
              <FolderOpen className="h-4 w-4" />
              <span className="hidden sm:inline">{t('common.open')}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[200px]">
              <DropdownMenuItem onClick={onOpenDirectory}>
                <HardDrive className="h-4 w-4 mr-2" />
                {t('navbar.openLocalDir')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenLocalArchive}>
                <Archive className="h-4 w-4 mr-2" />
                {t('navbar.openLocalArchive')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onOpenRemoteArchive?.()}>
                <Globe2 className="h-4 w-4 mr-2" />
                {t('navbar.openRemoteArchive')}
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={onOpenSample}>
                <Database className="h-4 w-4 mr-2" />
                {t('common.browseLeRobot')}
              </DropdownMenuItem>

              {history.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <History className="h-4 w-4 mr-2" />
                      {t('navbar.history')}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-w-[300px]">
                      {history.map((item) => (
                        <DropdownMenuItem
                          key={item.id}
                          onClick={() => {
                            const action = resolveHistoryClickAction(item, {
                              canRestore: supportsHandlePersistence() && !!onRestoreHistory,
                            });
                            switch (action.type) {
                              case 'restore':
                                onRestoreHistory?.(item);
                                break;
                              case 'openUrl':
                                onOpenUrl?.(action.url);
                                break;
                              case 'openRemote':
                                onOpenRemoteArchive?.(action.url);
                                break;
                              case 'openDirectory':
                                onOpenDirectory?.();
                                break;
                              case 'openLocalArchive':
                                onOpenLocalArchive?.();
                                break;
                              case 'openSample':
                                onOpenSample?.();
                                break;
                            }
                          }}
                        >
                          <div className="flex items-center gap-2 overflow-hidden w-full">
                            {item.hasHandle && (
                              <RotateCcw
                                className="h-3.5 w-3.5 shrink-0 text-primary"
                                aria-hidden
                              />
                            )}
                            <div className="flex flex-col gap-0.5 overflow-hidden min-w-0">
                              <span className="truncate font-medium">{item.label}</span>
                              <span className="truncate text-xs text-muted-foreground">
                                {item.payload.url || item.payload.path || item.kind}
                              </span>
                            </div>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {onExport && <ExportButton onClick={onExport} />}

          {(datasetName || validationReport) && onOpenHealth && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-8 gap-2 text-xs font-medium',
                      validationReport?.hasError && 'text-destructive hover:text-destructive',
                      !validationReport?.hasError &&
                        validationReport?.hasWarning &&
                        'text-amber-600 dark:text-amber-500 hover:text-amber-600',
                      !validationReport?.hasError &&
                        !validationReport?.hasWarning &&
                        'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={onOpenHealth}
                  />
                }
              >
                {validationReport?.hasError ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : validationReport?.hasWarning ? (
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />
                )}
                <span className="hidden sm:inline">{t('health.check', 'Check')}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t('health.healthCheckButton', 'Dataset health check')}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Center: Title & Logo */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
          {isLoading ? (
            <Loader2 className="h-4 w-4 text-primary animate-spin" />
          ) : !datasetName ? (
            <img src="logo.svg" alt="LeRobot Studio Logo" className="h-5 w-5 opacity-90" />
          ) : null}
          <span
            className={`text-sm font-semibold tracking-tight ${isLoading ? 'text-muted-foreground animate-pulse' : ''}`}
          >
            {displayName}
          </span>
        </div>

        {/* Right: Controls */}
        <div className="flex items-center gap-1 ml-auto">
          {/* View Controls */}
          {(onToggleSidebar || onTogglePlaybackBar) && (
            <>
              <div className="flex items-center gap-0.5 mr-2">
                {onToggleSidebar && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={onToggleSidebar}
                        />
                      }
                    >
                      {sidebarVisible ? (
                        <PanelLeftClose className="h-4 w-4" />
                      ) : (
                        <PanelRightClose className="h-4 w-4" />
                      )}
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {sidebarVisible ? t('navbar.hideSidebar') : t('navbar.showSidebar')}
                    </TooltipContent>
                  </Tooltip>
                )}

                {onTogglePlaybackBar && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={onTogglePlaybackBar}
                        />
                      }
                    >
                      {playbackBarVisible ? (
                        <PanelBottomClose className="h-4 w-4" />
                      ) : (
                        <PanelBottomOpen className="h-4 w-4" />
                      )}
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {playbackBarVisible
                        ? t('navbar.hidePlaybackBar')
                        : t('navbar.showPlaybackBar')}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <Separator orientation="vertical" className="h-4 mr-2" />
            </>
          )}

          {/* Theme & Language */}
          <div className="flex items-center gap-1">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Bottom Progress Bar */}
      {(activeTask || percent !== undefined) && (
        <div className="absolute bottom-0 left-0 w-full h-[2px] bg-muted overflow-hidden">
          {activeTask && activeTask.phase === 'error' ? (
            <div className="h-full w-full bg-destructive" />
          ) : percent !== undefined ? (
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          ) : (
            <div className="h-full w-1/3 bg-primary animate-indeterminate-loading" />
          )}
        </div>
      )}
    </nav>
  );
};
