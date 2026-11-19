import type { BrowserCommand } from 'vitest/node';

const watched = new WeakSet<object>();

/**
 * Browser command: print every request the test browser could not complete
 * (the network error, e.g. net::ERR_NETWORK_CHANGED or net::ERR_ABORTED) and
 * every 5xx answer (e.g. Vite's 504 "Outdated Optimize Dep"), so a test file
 * that fails to load ("Failed to fetch dynamically imported module") shows
 * its network cause in the run's output. Attaches once per browser context.
 */
export const logNetworkFailures: BrowserCommand<[]> = (ctx) => {
  if (ctx.provider.name !== 'playwright' || !('context' in ctx)) return;
  const context = ctx.context;
  if (watched.has(context)) return;
  watched.add(context);
  context.on('requestfailed', (request) => {
    console.warn(
      `[browser network] ${request.method()} ${request.url()} failed: ${
        request.failure()?.errorText ?? 'unknown error'
      }`,
    );
  });
  context.on('response', (response) => {
    if (response.status() < 500) return;
    console.warn(
      `[browser network] ${response.request().method()} ${response.url()} answered ${response.status()} ${response.statusText()}`,
    );
  });
};

declare module 'vitest/browser' {
  interface BrowserCommands {
    logNetworkFailures: () => Promise<void>;
  }
}
