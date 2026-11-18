import { useLayoutEffect } from 'react';
import type { LeRobotThemeColors, LeRobotThemeTokens } from './hostTypes';

const PROPERTIES: Record<keyof LeRobotThemeColors, string> = {
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  radius: '--radius',
  fontFamily: 'font-family',
};

/** CSS properties for the viewer root: the base tokens, with `dark` on top in the dark scheme. */
export function themeTokenProperties(
  tokens: LeRobotThemeTokens | undefined,
  scheme: 'light' | 'dark',
): Record<string, string> {
  if (!tokens) return {};
  const { dark, ...base } = tokens;
  const merged: LeRobotThemeColors = scheme === 'dark' ? { ...base, ...dark } : base;
  const out: Record<string, string> = {};
  for (const [key, property] of Object.entries(PROPERTIES) as Array<
    [keyof LeRobotThemeColors, string]
  >) {
    const value = merged[key];
    if (typeof value === 'string' && value.trim() !== '') out[property] = value.trim();
  }
  return out;
}

/** Sets the host's theme tokens on the viewer root and removes them when they go away. */
export function useThemeTokens(
  root: HTMLElement | null,
  tokens: LeRobotThemeTokens | undefined,
  scheme: 'light' | 'dark',
): void {
  const key = JSON.stringify(themeTokenProperties(tokens, scheme));
  useLayoutEffect(() => {
    if (!root) return;
    const properties = JSON.parse(key) as Record<string, string>;
    for (const [property, value] of Object.entries(properties)) {
      root.style.setProperty(property, value);
    }
    return () => {
      for (const property of Object.keys(properties)) root.style.removeProperty(property);
    };
  }, [root, key]);
}
