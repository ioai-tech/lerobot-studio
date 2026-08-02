import React from 'react';
import { Button } from '@ioai/lerobot-studio-ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@ioai/lerobot-studio-ui';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const LanguageToggle: React.FC = () => {
  const { i18n, t } = useTranslation();

  const languages = [
    { code: 'zh', labelKey: 'common.languages.zh' },
    { code: 'en', labelKey: 'common.languages.en' },
    { code: 'ja', labelKey: 'common.languages.ja' },
  ];

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-foreground"
                  aria-label={t('common.language')}
                />
              }
            />
          }
        >
          <Globe className="h-4 w-4" />
          <span className="sr-only">{t('common.language')}</span>
        </TooltipTrigger>
        <TooltipContent>{t('common.language')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => i18n.changeLanguage(lang.code)}
            className={i18n.language === lang.code ? 'bg-accent' : ''}
          >
            <span>{t(lang.labelKey)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
