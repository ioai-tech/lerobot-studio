/**
 * The play state of a newly shown episode (s10 F-14). Nothing starts on its
 * own: an episode opens paused on its first frame, as a review tool keeps the
 * item still (Roboflow), and selecting another episode keeps the play state,
 * so it plays only when playback was on when the person selected it.
 */
export interface ShownEpisodePlayInput {
  totalFrames: number;
  isLoading: boolean;
  isPlaying: boolean;
  /** The person paused since this episode was selected. */
  userPaused: boolean;
  /** The selection that brought this episode was made while playing. */
  resumeRequested: boolean;
}

export function shouldPlayShownEpisode(input: ShownEpisodePlayInput): boolean {
  if (input.totalFrames <= 0) return false;
  if (input.isLoading) return false;
  if (input.isPlaying) return false;
  if (input.userPaused) return false;
  return input.resumeRequested;
}
