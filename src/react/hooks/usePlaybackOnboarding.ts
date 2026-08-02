import { useState, useCallback } from 'react';
import { safeStorage } from '@/platform';

const ONBOARDING_KEY = 'lerobot-studio-onboarding-playback-v1';
const LAST_PLAYING_KEY = 'lerobot-studio-playback-last-playing';

export function usePlaybackOnboarding() {
  const [guideOpen, setGuideOpen] = useState(() => {
    return safeStorage.getItem(ONBOARDING_KEY) !== 'true';
  });

  const [shouldAutoplay] = useState<boolean | null>(() => {
    const lastPlaying = safeStorage.getItem(LAST_PLAYING_KEY);
    return lastPlaying !== 'false';
  });

  const dismissGuide = useCallback(() => {
    setGuideOpen(false);
    safeStorage.setItem(ONBOARDING_KEY, 'true');
  }, []);

  const markUserPlayState = useCallback(
    (isPlaying: boolean) => {
      safeStorage.setItem(LAST_PLAYING_KEY, String(isPlaying));
      // Once user interacts, we can also consider onboarding as "acknowledged" if it was open
      if (guideOpen) {
        dismissGuide();
      }
    },
    [guideOpen, dismissGuide],
  );

  return {
    guideOpen,
    dismissGuide,
    shouldAutoplay,
    markUserPlayState,
  };
}
