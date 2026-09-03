import React, { useState } from 'react';
import { cn, PortalContainerProvider, TooltipProvider } from '@/ui';
import { ThemeProvider } from '../contexts/ThemeProvider';
import { LoadingProvider } from '../contexts/LoadingContext';
import { ToastProvider } from '../contexts/ToastContext';
import { LeRobotDataProvider } from '../contexts/LeRobotProvider';
import { I18nProvider } from '../i18n/core';
import { Toaster } from './ui/toaster';

export interface LeRobotStudioProviderProps {
  theme?: 'light' | 'dark' | 'system';
  language?: string;
  className?: string;
  children: React.ReactNode;
  /** When true, render the shared Sonner toaster inside the studio root. @defaultValue true */
  showToaster?: boolean;
  /**
   * When true (default), wrap children in a scoped root for CSS and portals.
   * Set false when the host page already provides its own layout wrapper.
   */
  wrapRoot?: boolean;
}

function StudioTree({
  theme,
  children,
  showToaster,
  portalContainer,
}: {
  theme?: 'light' | 'dark' | 'system';
  children: React.ReactNode;
  showToaster: boolean;
  portalContainer: HTMLElement | null;
}) {
  return (
    <PortalContainerProvider container={portalContainer}>
      <ThemeProvider controlledTheme={theme} rootElement={portalContainer}>
        <LoadingProvider>
          <LeRobotDataProvider>
            <ToastProvider>
              <TooltipProvider delay={200}>
                {children}
                {showToaster ? <Toaster /> : null}
              </TooltipProvider>
            </ToastProvider>
          </LeRobotDataProvider>
        </LoadingProvider>
      </ThemeProvider>
    </PortalContainerProvider>
  );
}

/**
 * Shared theme, language, and dataset context for the viewer and a custom welcome page.
 */
export const LeRobotStudioProvider: React.FC<LeRobotStudioProviderProps> = ({
  theme,
  language,
  className,
  children,
  showToaster = true,
  wrapRoot = true,
}) => {
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null);

  return (
    <I18nProvider forcedLanguage={language}>
      {wrapRoot ? (
        <div
          ref={setRootEl}
          tabIndex={-1}
          className={cn(
            'lerobot-root h-full w-full relative bg-background text-foreground outline-none',
            className,
          )}
        >
          <StudioTree theme={theme} showToaster={showToaster} portalContainer={rootEl}>
            {children}
          </StudioTree>
        </div>
      ) : (
        <div
          ref={setRootEl}
          tabIndex={-1}
          className={cn(
            'lerobot-root h-full w-full bg-background text-foreground outline-none',
            className,
          )}
        >
          <StudioTree theme={theme} showToaster={showToaster} portalContainer={rootEl}>
            {children}
          </StudioTree>
        </div>
      )}
    </I18nProvider>
  );
};

/** @deprecated Prefer LeRobotStudioProvider */
export const LeRobotProvider = LeRobotStudioProvider;
