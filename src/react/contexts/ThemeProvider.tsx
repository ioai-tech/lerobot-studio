import React, { useEffect, useState } from 'react';
import { ThemeContext, type Theme, type ThemeProviderProps } from './ThemeContext';
import { safeStorage } from '@/platform';

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  controlledTheme,
  rootElement,
}) => {
  const isControlled = controlledTheme !== undefined;

  const [theme, setThemeState] = useState<Theme>(() => {
    if (isControlled) {
      return controlledTheme;
    }
    const saved = safeStorage.getItem('theme') as Theme;
    return saved || 'system';
  });

  // 计算有效主题：受控时使用受控值，否则使用内部状态
  const effectiveTheme = isControlled ? controlledTheme : theme;

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => {
    if (effectiveTheme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return effectiveTheme as 'light' | 'dark';
  });

  useEffect(() => {
    const updateTheme = () => {
      let actualTheme: 'light' | 'dark';

      if (effectiveTheme === 'system') {
        actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } else {
        actualTheme = effectiveTheme as 'light' | 'dark';
      }

      setResolvedTheme(actualTheme);

      if (rootElement) {
        rootElement.classList.toggle('dark', actualTheme === 'dark');
      }

      // Update only this viewer's dockview instance.
      const dockviewContainer = rootElement?.querySelector('.dockview-react');
      if (dockviewContainer) {
        dockviewContainer.classList.remove('dockview-theme-light', 'dockview-theme-dark');
        dockviewContainer.classList.add(
          actualTheme === 'dark' ? 'dockview-theme-dark' : 'dockview-theme-light',
        );
      }
    };

    updateTheme();

    if (effectiveTheme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', updateTheme);
      return () => mediaQuery.removeEventListener('change', updateTheme);
    }
  }, [effectiveTheme, rootElement]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    if (!isControlled) {
      safeStorage.setItem('theme', newTheme);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme: effectiveTheme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
