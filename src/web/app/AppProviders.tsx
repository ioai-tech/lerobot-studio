import React from 'react';
import { ErrorBoundary, LeRobotStudioProvider } from '@';

/**
 * Web shell providers. Reuses the library composition root so embed and SPA
 * share the same i18n/theme/loading/toast/portal stack.
 *
 * `wrapRoot={false}` because the root index.html already mounts `#lerobot-root`.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <LeRobotStudioProvider showToaster={false} wrapRoot={false} className="h-full w-full">
        {/* Inner boundary keeps crash UI inside the themed `.lerobot-root`. */}
        <ErrorBoundary>{children}</ErrorBoundary>
      </LeRobotStudioProvider>
    </ErrorBoundary>
  );
}
