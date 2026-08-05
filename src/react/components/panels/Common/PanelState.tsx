import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/ui';

interface PanelStateProps {
  message: string;
  className?: string;
}

export const PanelLoadingState: React.FC<PanelStateProps> = ({ message, className }) => {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex h-full min-h-0 w-full items-center justify-center text-muted-foreground',
        className,
      )}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2
          className="h-6 w-6 animate-spin motion-reduce:animate-none will-change-transform"
          aria-hidden
        />
        <p className="text-[10px] font-medium uppercase tracking-widest opacity-50">{message}</p>
      </div>
    </div>
  );
};

export const PanelEmptyState: React.FC<PanelStateProps> = ({ message, className }) => {
  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full items-center justify-center text-muted-foreground',
        className,
      )}
    >
      <p className="text-[10px] font-medium uppercase tracking-widest opacity-50">{message}</p>
    </div>
  );
};
