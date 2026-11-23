import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/ui';
import { Button } from '@/ui';
import { cn } from '@/ui';

interface EpisodeSearchProps {
  searchTerm: string;
  showAdvanced: boolean;
  onSearchTermChange: (value: string) => void;
  onToggleAdvanced: () => void;
}

export const EpisodeSearch: React.FC<EpisodeSearchProps> = ({
  searchTerm,
  showAdvanced,
  onSearchTermChange,
  onToggleAdvanced,
}) => {
  const { t } = useTranslation();

  return (
    <div className="group relative flex min-w-0 items-center gap-1 overflow-hidden">
      <div className="relative min-w-0 flex-1 basis-0">
        <Search
          className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40 transition-colors group-focus-within:text-primary/50"
          aria-hidden
        />
        <Input
          placeholder={t('sidebar.searchPlaceholder')}
          className="h-9 min-w-0 w-full border-transparent bg-muted/50 pl-9 text-xs placeholder:text-muted-foreground/40"
          value={searchTerm}
          onChange={(e) => onSearchTermChange(e.target.value)}
          aria-label={t('sidebar.searchPlaceholder')}
        />
      </div>
      <Button
        variant={showAdvanced ? 'secondary' : 'ghost'}
        size="sm"
        className={cn('h-9 w-9 shrink-0 p-0', showAdvanced && 'text-primary')}
        onClick={onToggleAdvanced}
        title={t('sidebar.advanced', 'Advanced')}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  );
};
