import React, { useState } from 'react';
import { cn, PortalContainerProvider, TooltipProvider } from '@/ui';
import { ThemeProvider } from '../contexts/ThemeProvider';
import { LoadingProvider } from '../contexts/LoadingContext';
import { ToastProvider } from '../contexts/ToastContext';
import { LeRobotDataProvider } from '../contexts/LeRobotProvider';
import { I18nProvider } from '../i18n/core';
import { Toaster } from './ui/toaster';
import type { LeRobotMessages } from '../i18n/messageKeys';
import { useTranslation } from '../i18n/reactI18nextCompat';
import { useTheme } from '../contexts/ThemeContext';
import { useThemeTokens } from '../contexts/themeTokens';
import type { LeRobotThemeTokens } from '../contexts/hostTypes';

/** Applies host theme tokens for the resolved light / dark scheme. */
function ThemeTokens({
  root,
  tokens,
}: {
  root: HTMLElement | null;
  tokens: LeRobotThemeTokens | undefined;
}) {
  const { resolvedTheme } = useTheme();
  useThemeTokens(root, tokens, resolvedTheme);
  return null;
}

/**
 * The scoped root: a labelled `region` landmark, never `main` (the host page
 * owns its `main`; nesting it inside an embedded viewer breaks landmarks).
 */
const ScopedRoot = React.forwardRef<
  HTMLDivElement,
  { className: string; children: React.ReactNode }
>(function ScopedRoot({ className, children }, ref) {
  const { t } = useTranslation();
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="region"
      aria-label={t('viewer.regionLabel')}
      className={className}
    >
      {children}
    </div>
  );
});

export interface LeRobotStudioProviderProps {
  theme?: 'light' | 'dark' | 'system';
  language?: string;
  /** Host copy for built-in messages, e.g. to call segments "Episodes". */
  messages?: LeRobotMessages;
  /** Host design tokens on the viewer root; light / dark still follows `theme`. */
  themeTokens?: LeRobotThemeTokens;
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
  themeTokens,
  children,
  showToaster,
  portalContainer,
}: {
  theme?: 'light' | 'dark' | 'system';
  themeTokens?: LeRobotThemeTokens;
  children: React.ReactNode;
  showToaster: boolean;
  portalContainer: HTMLElement | null;
}) {
  return (
    <PortalContainerProvider container={portalContainer}>
      <ThemeProvider controlledTheme={theme} rootElement={portalContainer}>
        <ThemeTokens root={portalContainer} tokens={themeTokens} />
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
  messages,
  themeTokens,
  className,
  children,
  showToaster = true,
  wrapRoot = true,
}) => {
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null);

  return (
    <I18nProvider forcedLanguage={language} messages={messages}>
      <ScopedRoot
        ref={setRootEl}
        className={cn(
          'lerobot-root h-full w-full bg-background text-foreground outline-none',
          wrapRoot && 'relative',
          className,
        )}
      >
        <StudioTree
          theme={theme}
          themeTokens={themeTokens}
          showToaster={showToaster}
          portalContainer={rootEl}
        >
          {children}
        </StudioTree>
      </ScopedRoot>
    </I18nProvider>
  );
};

/** @deprecated Prefer LeRobotStudioProvider */
export const LeRobotProvider = LeRobotStudioProvider;
