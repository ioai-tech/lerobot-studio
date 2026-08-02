import React from 'react';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from '@ioai/lerobot-studio-ui';

export interface ExportButtonProps {
  onClick: () => void;
  disabled?: boolean;
  /** Optional class name for the button (e.g. "w-full justify-start rounded-none h-9" for sidebar style). */
  className?: string;
}

/**
 * Reusable export button with tooltip and i18n.
 * Used in Navbar and in app integration (e.g. studio detail toolbar).
 */
export const ExportButton: React.FC<ExportButtonProps> = ({
  onClick,
  disabled = false,
  className,
}) => {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 gap-2 text-xs font-medium text-muted-foreground hover:text-foreground',
              className,
            )}
            onClick={onClick}
            disabled={disabled}
          />
        }
      >
        <Download className="h-4 w-4" />
        <span className="hidden sm:inline">{t('navbar.export', 'Export')}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t('navbar.export', 'Export dataset')}</TooltipContent>
    </Tooltip>
  );
};
