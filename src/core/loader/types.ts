export interface NumericalColumnData {
  values: Float64Array;
  rows: number;
  width: number;
}

export type NumericalColumnMap = Record<string, NumericalColumnData>;

/** Minimal loader surface used by analysis / playback planners. */
export interface EpisodeTableLoader {
  getInfo(): { features: Record<string, unknown> } | undefined | null;
  loadEpisodeTable(episodeIndex: number, columns?: string[]): Promise<unknown>;
}
