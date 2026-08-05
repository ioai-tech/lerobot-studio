import React from 'react';
import { Toaster as SonnerToaster } from '@/ui';
import { useTheme } from '../../contexts/ThemeContext';

export const Toaster: React.FC = () => {
  const { resolvedTheme } = useTheme();
  return <SonnerToaster theme={resolvedTheme} position="top-center" richColors closeButton />;
};
