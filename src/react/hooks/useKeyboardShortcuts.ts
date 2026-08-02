import { useEffect, useCallback, useRef } from 'react';
import { useLeRobot } from '../contexts/LeRobotContext';
import { usePortalContainer } from '@/ui';

/**
 * 全局键盘快捷键处理Hook
 * 提供类似视频播放器的快捷键操作
 */
export const useKeyboardShortcuts = (enabled: boolean = true) => {
  const portalContainer = usePortalContainer();
  const {
    episodes,
    selectedEpisodeIndex,
    selectEpisode,
    setFrameIndex,
    togglePlay,
    getFrameIndex,
    currentFrames,
    isLoading,
  } = useLeRobot();

  // 使用ref存储，避免闭包问题
  const enabledRef = useRef(enabled);
  const episodesRef = useRef(episodes);
  const selectedEpisodeIndexRef = useRef(selectedEpisodeIndex);
  const currentFramesRef = useRef(currentFrames);
  const isLoadingRef = useRef(isLoading);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    episodesRef.current = episodes;
  }, [episodes]);

  useEffect(() => {
    selectedEpisodeIndexRef.current = selectedEpisodeIndex;
  }, [selectedEpisodeIndex]);

  useEffect(() => {
    currentFramesRef.current = currentFrames;
  }, [currentFrames]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // 如果快捷键被禁用，或者正在加载，则忽略
      if (!enabledRef.current || isLoadingRef.current) return;

      const target = e.target as HTMLElement;
      if (!portalContainer?.contains(target)) return;
      const isInputElement =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // 如果在输入框中，只允许空格键（用于播放/暂停），其他快捷键忽略
      if (isInputElement && e.key !== ' ') {
        return;
      }

      // 阻止默认行为（避免页面滚动等）
      const preventDefaultKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '];
      if (preventDefaultKeys.includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }

      const currentEpisodes = episodesRef.current;
      const currentSelectedIndex = selectedEpisodeIndexRef.current;
      const currentFrames = currentFramesRef.current;
      const currentFrameIndex = getFrameIndex();
      const totalFrames = currentFrames.length;

      switch (e.key) {
        case 'ArrowUp': {
          // 切换到上一个episode
          if (currentEpisodes.length === 0) return;

          const currentEpisode = currentEpisodes.find(
            (ep) => ep.episode_index === currentSelectedIndex,
          );

          if (!currentEpisode) {
            // 如果没有选中的，选择第一个
            if (currentEpisodes.length > 0) {
              selectEpisode(currentEpisodes[0].episode_index);
            }
            return;
          }

          const currentIndex = currentEpisodes.findIndex(
            (ep) => ep.episode_index === currentEpisode.episode_index,
          );

          if (currentIndex > 0) {
            const prevEpisode = currentEpisodes[currentIndex - 1];
            selectEpisode(prevEpisode.episode_index);
          }
          break;
        }

        case 'ArrowDown': {
          // 切换到下一个episode
          if (currentEpisodes.length === 0) return;

          const currentEpisode = currentEpisodes.find(
            (ep) => ep.episode_index === currentSelectedIndex,
          );

          if (!currentEpisode) {
            // 如果没有选中的，选择第一个
            if (currentEpisodes.length > 0) {
              selectEpisode(currentEpisodes[0].episode_index);
            }
            return;
          }

          const currentIndex = currentEpisodes.findIndex(
            (ep) => ep.episode_index === currentEpisode.episode_index,
          );

          if (currentIndex < currentEpisodes.length - 1) {
            const nextEpisode = currentEpisodes[currentIndex + 1];
            selectEpisode(nextEpisode.episode_index);
          }
          break;
        }

        case 'ArrowLeft': {
          // 后退一帧
          // Shift: 10帧
          // Ctrl/Cmd: 5帧
          if (totalFrames === 0) return;

          let step = 1;
          if (e.shiftKey) {
            step = 10;
          } else if (e.ctrlKey || e.metaKey) {
            step = 5;
          }

          const newIndex = Math.max(0, currentFrameIndex - step);
          setFrameIndex(newIndex);
          break;
        }

        case 'ArrowRight': {
          // 前进一帧
          // Shift: 10帧
          // Ctrl/Cmd: 5帧
          if (totalFrames === 0) return;

          let step = 1;
          if (e.shiftKey) {
            step = 10;
          } else if (e.ctrlKey || e.metaKey) {
            step = 5;
          }

          const newIndex = Math.min(totalFrames - 1, currentFrameIndex + step);
          setFrameIndex(newIndex);
          break;
        }

        case ' ': {
          // 空格键：播放/暂停
          // 如果在输入框中，不处理
          if (isInputElement) return;

          e.preventDefault();
          if (totalFrames > 0) {
            togglePlay();
          }
          break;
        }

        case 'Home': {
          // Home键：跳转到第一帧
          if (totalFrames > 0) {
            setFrameIndex(0);
          }
          break;
        }

        case 'End': {
          // End键：跳转到最后一帧
          if (totalFrames > 0) {
            setFrameIndex(totalFrames - 1);
          }
          break;
        }
      }
    },
    [selectEpisode, setFrameIndex, togglePlay, getFrameIndex, portalContainer],
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);
};
