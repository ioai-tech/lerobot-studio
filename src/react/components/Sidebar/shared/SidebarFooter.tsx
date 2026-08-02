import React from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, MessageCircle } from 'lucide-react';

export const SidebarFooter: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="shrink-0 border-t border-border/50 px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <a
          href="https://github.com/ioai-tech/lerobot-studio"
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          title={t('sidebar.website', 'Project repository')}
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">GitHub</span>
        </a>
        <a
          href="https://github.com/ioai-tech/lerobot-studio/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          title={t('sidebar.feedback', 'Feedback')}
        >
          <MessageCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t('sidebar.feedback')}</span>
        </a>
      </div>
    </div>
  );
};
