import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDrive, Archive, Globe2, AlertTriangle, RotateCcw } from 'lucide-react';
import { RemoteArchiveOpenForm } from './open/RemoteArchiveOpenForm';
import type { ParsedSourceUrl } from '../utils/sourceUrlTypes';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@ioai/lerobot-studio-ui';
import { Button } from '@ioai/lerobot-studio-ui';

interface DatasetSourceSelectorProps {
  onOpenDirectory: () => void;
  onOpenLocalArchive: () => void;
  onOpenRemoteArchive: (url?: string) => void;
  requested?: ParsedSourceUrl | null;
  onRequestUrl?: (rawUrl: string | null, mode: 'push' | 'replace') => void;
  onRestoreFromUrl?: (requested: ParsedSourceUrl) => void;
  className?: string;
}

export const DatasetSourceSelector: React.FC<DatasetSourceSelectorProps> = ({
  onOpenDirectory,
  onOpenLocalArchive,
  onOpenRemoteArchive,
  requested,
  onRequestUrl,
  onRestoreFromUrl,
  className = '',
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string>('dir');

  // Sync with requested URL intent
  useEffect(() => {
    if (requested) {
      let newTab = '';
      if (requested.kind === 'directory') newTab = 'dir';
      else if (requested.kind === 'localArchive') newTab = 'local';
      else if (requested.kind === 'remoteArchive') newTab = 'remote';

      if (newTab) {
        setActiveTab((prev) => (prev !== newTab ? newTab : prev));
      }
    }
  }, [requested]);

  const handleTabChange = (val: string) => {
    setActiveTab(val);
    if (requested) onRequestUrl?.(null, 'replace');
  };

  const renderRestoreBanner = (kind: 'directory' | 'localArchive') => {
    if (!requested || requested.kind !== kind || !requested.restorable) return null;
    return (
      <div className="text-xs text-amber-700 dark:text-amber-300 border border-border rounded-md p-3 bg-muted/20 flex gap-3">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
        <div className="space-y-2 flex-1">
          <div className="space-y-1">
            <p className="font-medium text-foreground">
              {kind === 'directory'
                ? t('panels.welcome.urlIntent')
                : t('panels.welcome.urlIntentFile')}
            </p>
            <p className="text-muted-foreground">
              {t('panels.welcome.restoreHint')}
              {requested.hint ? ` (${t('panels.welcome.suggest')}: ${requested.hint})` : ''}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            className="gap-2"
            onClick={() => onRestoreFromUrl?.(requested)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('panels.welcome.restoreButton')}
          </Button>
        </div>
      </div>
    );
  };

  const renderLegacyIntentBanner = (kind: 'directory' | 'localArchive') => {
    if (!requested || requested.kind !== kind || requested.restorable) return null;
    return (
      <div className="text-xs text-amber-700 dark:text-amber-300 border border-border rounded-md p-3 bg-muted/20 flex gap-3">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">
            {kind === 'directory'
              ? t('panels.welcome.urlIntent')
              : t('panels.welcome.urlIntentFile')}
          </p>
          <p className="text-muted-foreground">
            {t('panels.welcome.urlIntentHint')}
            {requested.hint ? ` (${t('panels.welcome.suggest')}: ${requested.hint})` : ''}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className={`space-y-6 ${className}`}>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-muted/10 p-1">
          <TabsTrigger value="dir" className="gap-2">
            <HardDrive className="h-4 w-4" />
            <span className="hidden sm:inline">{t('navbar.openLocalDir')}</span>
            <span className="sm:hidden">Dir</span>
          </TabsTrigger>
          <TabsTrigger value="local" className="gap-2">
            <Archive className="h-4 w-4" />
            <span className="hidden sm:inline">{t('navbar.openLocalArchive')}</span>
            <span className="sm:hidden">Zip</span>
          </TabsTrigger>
          <TabsTrigger value="remote" className="gap-2">
            <Globe2 className="h-4 w-4" />
            <span className="hidden sm:inline">{t('navbar.openRemoteArchive')}</span>
            <span className="sm:hidden">URL</span>
          </TabsTrigger>
        </TabsList>

        <div className="mt-6 min-h-[180px]">
          <TabsContent value="dir" className="space-y-4 focus-visible:outline-none">
            {renderRestoreBanner('directory')}
            {renderLegacyIntentBanner('directory')}
            <div
              className="group border border-border rounded-lg p-8 text-center bg-muted/10 hover:bg-muted/20 transition-colors cursor-pointer"
              onClick={onOpenDirectory}
            >
              <div className="flex flex-col items-center gap-3">
                <div className="p-3 rounded-full bg-muted/30 group-hover:bg-primary/10 transition-colors">
                  <HardDrive className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">{t('navbar.openLocalDir')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('panels.welcome.dragDropHint', { type: t('panels.welcome.dragDropFolder') })}
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="local" className="space-y-4 focus-visible:outline-none">
            {renderRestoreBanner('localArchive')}
            {renderLegacyIntentBanner('localArchive')}
            <div
              className="group border border-border rounded-lg p-8 text-center bg-muted/10 hover:bg-muted/20 transition-colors cursor-pointer"
              onClick={onOpenLocalArchive}
            >
              <div className="flex flex-col items-center gap-3">
                <div className="p-3 rounded-full bg-muted/30 group-hover:bg-primary/10 transition-colors">
                  <Archive className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">{t('navbar.openLocalArchive')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('panels.welcome.dragDropHint', {
                      type: t('panels.welcome.dragDropArchive'),
                    })}
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="remote" className="space-y-4 focus-visible:outline-none">
            <div className="p-1">
              <RemoteArchiveOpenForm
                initialUrl={requested?.kind === 'remoteArchive' ? requested.raw : ''}
                onSubmit={onOpenRemoteArchive}
              />
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};
