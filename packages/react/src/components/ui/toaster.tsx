import React from 'react';
import { Toaster as SonnerToaster } from '@ioai/lerobot-studio-ui';
import { useTheme } from '../../contexts/ThemeContext';

export const Toaster: React.FC = () => {
  const { resolvedTheme } = useTheme();
  return <SonnerToaster theme={resolvedTheme} position="top-center" richColors closeButton />;
};
