/**
 * The number people read for a dataset episode: 1-based (`#1` is
 * `episode_index` 0). The `episode_index` itself is a technical detail, shown
 * only where the data's own fields are (raw values, the episode's metadata).
 */
export function episodeNumber(episodeIndex: number): number {
  return episodeIndex + 1;
}
