import React, { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useLeRobotData,
  useLeRobotPlayback,
  useLeRobotSelection,
  useLeRobotSubtask,
  useLeRobotUi,
} from '../../contexts/LeRobotContext';
import { EditSubtaskDialog } from '../dialogs/EditSubtaskDialog';
import { useLoading } from '../../contexts/LoadingContext';
import { shouldStartAutoplay } from '@/core';
import { PlaybackProgressSlider } from './PlaybackProgressSlider';
import { Button } from '@/ui';
import { Badge } from '@/ui';
import { Separator } from '@/ui';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/ui';
import { Play, Pause, ChevronLeft, ChevronRight, Repeat, Repeat1, Shuffle } from 'lucide-react';

function frameTimeSeconds(timestamp: number | undefined, frameIndex: number, fps: number): number {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) return timestamp;
  return frameIndex / Math.max(fps, 1);
}

export const PlaybackBar: React.FC = () => {
  const { t } = useTranslation();
  const {
    currentFrames,
    currentFrameIndex,
    setFrameIndex,
    isPlaying,
    setPlaying,
    playbackMode,
    setPlaybackMode,
    playbackSpeed,
    setPlaybackSpeed,
  } = useLeRobotPlayback();
  const { info, subscribeFrameIndex, getFrameIndex, isLoading } = useLeRobotData();
  const { selectedEpisodeIndex } = useLeRobotSelection();
  const {
    canAnnotate,
    currentSegments,
    knownLabels,
    pendingRange,
    cancelPending,
    commitPending,
    replaceEpisodeSegments,
    updateSegment,
    endAtPlayhead,
    beginPendingRange,
    removeSegment,
  } = useLeRobotSubtask();
  const { subtaskDialogOpen, setSubtaskDialogOpen, episodeEditMode } = useLeRobotUi();
  const annotationEnabled = canAnnotate && episodeEditMode;
  const [renameIndex, setRenameIndex] = useState<number | null>(null);

  const { tasks } = useLoading();
  const activeTask = tasks.find(
    (t) => t.phase !== 'ready' && t.phase !== 'idle' && t.phase !== 'error',
  );

  const totalFrames = currentFrames.length;
  const fps = info?.fps || 30;

  // 自动播放逻辑
  const didAutoPlayRef = useRef<string | null>(null);
  const userPausedRef = useRef(false);
  useEffect(() => {
    const currentId = `${selectedEpisodeIndex}-${totalFrames}`;
    if (
      shouldStartAutoplay({
        totalFrames,
        isLoading,
        isPlaying,
        userPaused: userPausedRef.current,
        currentId,
        lastAutoPlayId: didAutoPlayRef.current,
      })
    ) {
      didAutoPlayRef.current = currentId;
      setPlaying(true);
    }
  }, [totalFrames, isLoading, isPlaying, setPlaying, selectedEpisodeIndex]);

  useEffect(() => {
    userPausedRef.current = false;
    setRenameIndex(null);
    setSubtaskDialogOpen(false);
  }, [selectedEpisodeIndex, setSubtaskDialogOpen]);

  useEffect(() => {
    if (isLoading) {
      didAutoPlayRef.current = null;
    }
  }, [isLoading]);

  useEffect(() => {
    if (annotationEnabled) return;
    setRenameIndex(null);
    cancelPending();
    setSubtaskDialogOpen(false);
  }, [annotationEnabled, cancelPending, setSubtaskDialogOpen]);

  useEffect(() => {
    if (isPlaying || isLoading || totalFrames <= 0) return;
    const currentId = `${selectedEpisodeIndex}-${totalFrames}`;
    if (didAutoPlayRef.current === currentId) {
      userPausedRef.current = true;
    }
  }, [isPlaying, isLoading, selectedEpisodeIndex, totalFrames]);

  const nextMode = () => {
    if (playbackMode === 'sequential') setPlaybackMode('shuffle');
    else if (playbackMode === 'shuffle') setPlaybackMode('loop');
    else setPlaybackMode('sequential');
  };

  const getModeIcon = () => {
    switch (playbackMode) {
      case 'loop':
        return <Repeat1 className="h-4 w-4" />;
      case 'shuffle':
        return <Shuffle className="h-4 w-4" />;
      case 'sequential':
        return <Repeat className="h-4 w-4" />;
    }
  };

  const speeds = [0.25, 0.5, 1, 2, 4];
  const nextSpeed = () => {
    const idx = speeds.indexOf(playbackSpeed);
    const next = speeds[(idx + 1) % speeds.length];
    setPlaybackSpeed(next);
  };

  const getModeLabel = () => {
    switch (playbackMode) {
      case 'loop':
        return t('playback.mode.loop');
      case 'shuffle':
        return t('playback.mode.shuffle');
      case 'sequential':
        return t('playback.mode.sequential');
    }
  };

  const totalTime = useMemo(() => {
    if (totalFrames === 0) return 0;
    if (currentFrames[totalFrames - 1]?.timestamp !== undefined) {
      return currentFrames[totalFrames - 1].timestamp;
    }
    return totalFrames / fps;
  }, [totalFrames, currentFrames, fps]);

  const handlePlayPauseClick = useCallback(() => {
    if (subtaskDialogOpen) return;
    if (isPlaying) {
      userPausedRef.current = true;
      setRenameIndex(null);
      setPlaying(false);
      if (annotationEnabled && endAtPlayhead(getFrameIndex())) {
        setSubtaskDialogOpen(true);
      }
      return;
    }
    userPausedRef.current = false;
    setPlaying(true);
  }, [
    annotationEnabled,
    endAtPlayhead,
    getFrameIndex,
    isPlaying,
    setPlaying,
    setSubtaskDialogOpen,
    subtaskDialogOpen,
  ]);

  useEffect(() => {
    if (!subtaskDialogOpen) return;
    userPausedRef.current = true;
    setPlaying(false);
  }, [subtaskDialogOpen, setPlaying]);

  const dialogStartFrame =
    pendingRange?.startFrame ??
    (renameIndex != null ? currentSegments[renameIndex]?.startFrame : 0) ??
    0;
  const dialogEndFrame =
    pendingRange?.endFrame ??
    (renameIndex != null ? currentSegments[renameIndex]?.endFrame : 0) ??
    0;

  // Render placeholder if no data and not loading
  if (totalFrames === 0 && !isLoading && !activeTask) {
    return (
      <div className="h-16 border-t bg-background/50 px-6 flex items-center justify-center text-muted-foreground italic text-sm">
        {t('playback.noData')}
      </div>
    );
  }

  // Render skeleton if loading
  if (isLoading || activeTask) {
    return (
      <div
        className="h-16 border-t bg-background text-foreground px-4 flex items-center gap-4 animate-pulse motion-reduce:animate-none pointer-events-none opacity-60"
        role="status"
        aria-live="polite"
        aria-label={activeTask?.message || t('common.loading')}
      >
        <div className="flex items-center gap-1">
          <div className="h-8 w-8 rounded bg-muted" />
          <div className="h-8 w-12 rounded bg-muted" />
          <div className="h-8 w-8 rounded bg-muted" />
          <div className="h-9 w-9 rounded-full bg-muted" />
          <div className="h-8 w-8 rounded bg-muted" />
        </div>
        <Separator orientation="vertical" className="h-8 mx-2 bg-border" />
        <div className="flex-1 flex flex-col justify-center gap-2">
          <div className="flex justify-between">
            <div className="h-3 w-24 bg-muted rounded" />
            <div className="h-3 w-16 bg-muted rounded" />
          </div>
          <div className="h-1.5 w-full bg-muted rounded-full" />
        </div>
        <Separator orientation="vertical" className="h-8 mx-2 bg-border" />
        <div className="flex items-center gap-4">
          <div className="h-8 w-12 bg-muted rounded" />
          <div className="h-8 w-16 bg-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-16 border-t bg-background text-foreground px-4 py-2 flex items-center gap-4">
      {/* Left: Navigation Controls */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${playbackMode !== 'sequential' ? 'text-primary' : 'text-muted-foreground'} hover:text-foreground`}
                onClick={nextMode}
                disabled={isLoading}
                aria-label={t('playback.mode.toggle')}
              />
            }
          >
            {getModeIcon()}
          </TooltipTrigger>
          <TooltipContent>{getModeLabel()}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 font-mono text-xs"
                onClick={nextSpeed}
                disabled={isLoading || totalFrames === 0}
                aria-label={t('playback.speed')}
              />
            }
          >
            {playbackSpeed}x
          </TooltipTrigger>
          <TooltipContent>{t('playback.speed')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setFrameIndex(Math.max(0, getFrameIndex() - 1))}
                disabled={isLoading || subtaskDialogOpen}
                aria-label={t('panels.keyboardShortcuts.prevFrame.action')}
              />
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </TooltipTrigger>
          <TooltipContent>{t('panels.keyboardShortcuts.prevFrame.action')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="default"
                size="icon"
                className="h-9 w-9 rounded-full transition-all"
                onClick={handlePlayPauseClick}
                disabled={isLoading || totalFrames === 0 || subtaskDialogOpen}
                aria-label={t('panels.keyboardShortcuts.playPause.action')}
              />
            }
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
          </TooltipTrigger>
          <TooltipContent>
            {annotationEnabled && isPlaying
              ? t('subtask.pauseToLabel', 'Pause to label')
              : t('panels.keyboardShortcuts.playPause.action')}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setFrameIndex(Math.min(totalFrames - 1, getFrameIndex() + 1))}
                disabled={isLoading || subtaskDialogOpen}
                aria-label={t('panels.keyboardShortcuts.nextFrame.action')}
              />
            }
          >
            <ChevronRight className="h-4 w-4" />
          </TooltipTrigger>
          <TooltipContent>{t('panels.keyboardShortcuts.nextFrame.action')}</TooltipContent>
        </Tooltip>
      </div>

      <Separator orientation="vertical" className="h-8 mx-2 bg-border" />

      <PlaybackProgressSlider
        currentFrames={currentFrames}
        fps={fps}
        totalFrames={totalFrames}
        totalTime={totalTime}
        initialFrameIndex={currentFrameIndex}
        isDisabled={isLoading || !!activeTask || subtaskDialogOpen}
        setFrameIndex={setFrameIndex}
        getFrameIndex={getFrameIndex}
        subscribeFrameIndex={subscribeFrameIndex}
        segments={currentSegments}
        pendingRange={annotationEnabled ? pendingRange : null}
        editRanges={annotationEnabled && !subtaskDialogOpen}
        knownLabels={knownLabels}
        onReplaceSegments={(next) => {
          try {
            replaceEpisodeSegments(next);
          } catch (error) {
            console.warn('Could not save subtask ranges', error);
          }
        }}
        onDeleteSegment={removeSegment}
        onFillGap={
          annotationEnabled
            ? (startFrame, endFrame) => {
                setRenameIndex(null);
                userPausedRef.current = true;
                setPlaying(false);
                if (beginPendingRange(startFrame, endFrame)) {
                  setSubtaskDialogOpen(true);
                }
              }
            : undefined
        }
        onRenameSegment={
          annotationEnabled
            ? (index) => {
                cancelPending();
                setRenameIndex(index);
                userPausedRef.current = true;
                setPlaying(false);
                setSubtaskDialogOpen(true);
              }
            : undefined
        }
      />

      <Separator orientation="vertical" className="h-8 mx-2 bg-border" />

      {/* Right: Meta Info */}
      <div className="flex items-center gap-4 pr-2">
        <div className="flex flex-col items-end">
          <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider">
            {t('playback.meta.fps')}
          </span>
          <Badge variant="secondary" className="text-[10px] h-4.5 px-1 py-0 font-mono">
            {fps}
          </Badge>
        </div>
        <div className="flex flex-col items-end min-w-[60px]">
          <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider">
            {t('playback.meta.version')}
          </span>
          <span className="text-[10px] font-mono text-foreground/80">
            {info?.codebase_version || 'N/A'}
          </span>
        </div>
      </div>
      <EditSubtaskDialog
        open={subtaskDialogOpen}
        onOpenChange={(open) => {
          setSubtaskDialogOpen(open);
          if (!open) {
            cancelPending();
            setRenameIndex(null);
          }
        }}
        startFrame={dialogStartFrame}
        endFrame={dialogEndFrame}
        startSeconds={frameTimeSeconds(
          currentFrames[dialogStartFrame]?.timestamp,
          dialogStartFrame,
          fps,
        )}
        endSeconds={frameTimeSeconds(currentFrames[dialogEndFrame]?.timestamp, dialogEndFrame, fps)}
        initialLabel={
          pendingRange
            ? ''
            : ((renameIndex != null ? currentSegments[renameIndex]?.label : '') ?? '')
        }
        knownLabels={knownLabels}
        onSave={(label) => {
          if (renameIndex != null && !pendingRange) {
            updateSegment(renameIndex, { ...currentSegments[renameIndex], label });
            setRenameIndex(null);
            return;
          }
          commitPending(label, { startFrame: dialogStartFrame, endFrame: dialogEndFrame });
        }}
      />
    </div>
  );
};
