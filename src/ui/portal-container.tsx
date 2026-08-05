import * as React from 'react';

const PortalContainerContext = React.createContext<HTMLElement | null>(null);

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: React.ReactNode;
}) {
  return (
    <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>
  );
}

/**
 * Resolve the portal mount node for overlays.
 * Prefer the nearest Studio root provided via context so multi-instance embeds
 * keep Dialog/Menu/Tooltip inside CSS-scoped `#lerobot-root` trees.
 */
export function usePortalContainer(): HTMLElement | null {
  const fromContext = React.useContext(PortalContainerContext);
  if (fromContext) return fromContext;
  if (typeof document === 'undefined') return null;
  return document.getElementById('lerobot-root');
}
