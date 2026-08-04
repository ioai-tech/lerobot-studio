import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { useLeRobotData, useLeRobotSelection } from '../../contexts/LeRobotContext';
import { ScrollArea } from '@/ui';
import { Separator } from '@/ui';
import { AnalysisOverview } from './analysis/AnalysisOverview';
import { AnalysisDuration } from './analysis/AnalysisDuration';
import { AnalysisTaskDistribution } from './analysis/AnalysisTaskDistribution';

export const AnalysisSidebarContent: React.FC = () => {
  const { t } = useTranslation();
  const { info, tasks } = useLeRobotData();
  const { effectiveEpisodes } = useLeRobotSelection();

  const analysis = useMemo(() => {
    if (!info || effectiveEpisodes.length === 0) return null;
    const fps = info.fps ?? 30;
    const totalFrames = effectiveEpisodes.reduce((acc, ep) => acc + (ep.length ?? 0), 0);
    const totalSec = totalFrames / fps;
    const durationsSec = effectiveEpisodes.map((ep) => (ep.length ?? 0) / fps);
    const validDurations = durationsSec.filter((d) => d > 0);
    const avgSec = validDurations.length
      ? validDurations.reduce((a, b) => a + b, 0) / validDurations.length
      : 0;
    const minSec = validDurations.length ? Math.min(...validDurations) : 0;
    const maxSec = validDurations.length ? Math.max(...validDurations) : 0;

    const lengths = effectiveEpisodes.map((ep) => ep.length ?? 0).filter((l) => l > 0);
    const minLen = lengths.length ? Math.min(...lengths) : 0;
    const maxLen = lengths.length ? Math.max(...lengths) : 0;
    const avgLen = lengths.length
      ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)
      : 0;

    const taskCounts: Record<string, number> = {};
    effectiveEpisodes.forEach((ep) => {
      const taskStr =
        (ep.tasks && ep.tasks[0]) || tasks[ep.task_index ?? 0] || t('sidebar.noDescription');
      taskCounts[taskStr] = (taskCounts[taskStr] ?? 0) + 1;
    });
    const taskEntries = Object.entries(taskCounts).sort((a, b) => b[1] - a[1]);

    return {
      episodeCount: effectiveEpisodes.length,
      totalFrames,
      totalSec,
      avgSec,
      minSec,
      maxSec,
      lengthStats: { min: minLen, max: maxLen, avg: avgLen },
      fps,
      codebaseVersion: info.codebase_version,
      robotType: info.robot_type,
      taskEntries,
    };
  }, [info, effectiveEpisodes, tasks, t]);

  if (!analysis) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4 text-center">
        <BarChart3 className="h-8 w-8 mb-2 opacity-50" aria-hidden />
        <p className="text-xs font-medium">{t('analysis.noData')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-background">
      <ScrollArea className="flex-1 w-full min-w-0">
        <div className="flex w-full min-w-0 flex-col space-y-6 px-3 py-3">
          <AnalysisOverview
            episodeCount={analysis.episodeCount}
            totalFrames={analysis.totalFrames}
            fps={analysis.fps}
            codebaseVersion={analysis.codebaseVersion}
            robotType={analysis.robotType ?? undefined}
          />
          <Separator />
          <AnalysisDuration
            totalSec={analysis.totalSec}
            avgSec={analysis.avgSec}
            minSec={analysis.minSec}
            maxSec={analysis.maxSec}
            lengthStats={analysis.lengthStats}
          />
          <Separator />
          <AnalysisTaskDistribution
            taskEntries={analysis.taskEntries}
            episodeCount={analysis.episodeCount}
          />
        </div>
      </ScrollArea>
    </div>
  );
};
