import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@ioai/lerobot-studio-ui';
import { EpisodeSidebar } from './EpisodeSidebar';
import { AnalysisSidebarContent } from './AnalysisSidebarContent';
import { List, BarChart3 } from 'lucide-react';

export const SidebarTabs: React.FC = () => {
  const { t } = useTranslation();

  return (
    <Tabs
      defaultValue="episodes"
      className="flex h-full min-h-0 w-full min-w-0 flex-col"
    >
      <div className="w-full min-w-0 shrink-0 overflow-x-hidden px-2 pt-1 pb-1">
        <TabsList variant="line" className="grid w-full min-w-0 grid-cols-2">
          <TabsTrigger value="episodes" className="min-w-0 gap-1.5 px-2 text-xs">
            <List className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t('sidebar.tabs.episodes', 'Episodes')}</span>
          </TabsTrigger>
          <TabsTrigger value="analysis" className="min-w-0 gap-1.5 px-2 text-xs">
            <BarChart3 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t('sidebar.tabs.analysis', 'Analysis')}</span>
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent
        value="episodes"
        className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden focus-visible:outline-none"
      >
        <EpisodeSidebar />
      </TabsContent>
      <TabsContent
        value="analysis"
        className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden focus-visible:outline-none"
      >
        <AnalysisSidebarContent />
      </TabsContent>
    </Tabs>
  );
};
