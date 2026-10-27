import { createContext, useContext } from 'react';

/** Which rendition a VideoPanel plays: a host-provided preview copy or the dataset's own video. */
export type VideoVariant = 'preview' | 'original';

export interface VideoVariantContextValue {
  /** `info.video_path`-style template of the preview copy; null when the host has none. */
  previewVideoPath: string | null;
  variant: VideoVariant;
  setVariant: (variant: VideoVariant) => void;
}

export const VideoVariantContext = createContext<VideoVariantContextValue>({
  previewVideoPath: null,
  variant: 'original',
  setVariant: () => undefined,
});

export function useVideoVariant(): VideoVariantContextValue {
  return useContext(VideoVariantContext);
}
