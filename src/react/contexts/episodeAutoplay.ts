/** The selection whose autoplay is still to happen, and whether it should play. */
export interface EpisodeAutoplayIntent {
  episode: number | null;
  play: boolean;
}

/**
 * The autoplay intent of a new selection: the first episode autoplays; a later one plays on when
 * chosen while playing, or while the previous selection still waited to autoplay (a quick
 * reselection while it loads keeps that intent).
 */
export function nextEpisodeAutoplay(
  previous: EpisodeAutoplayIntent,
  episode: number,
  playing: boolean,
): EpisodeAutoplayIntent {
  return { episode, play: previous.episode === null || previous.play || playing };
}
