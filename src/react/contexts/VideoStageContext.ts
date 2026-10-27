import { createContext, useContext } from 'react';
import type { VideoStage } from '../services/video/VideoStage';

/** The cameras of the viewer (internal; provided by the data provider). */
export const VideoStageContext = createContext<VideoStage | null>(null);

export function useVideoStage(): VideoStage | null {
  return useContext(VideoStageContext);
}
