---
'@ioai/lerobot-studio': minor
---

Add `createEpisodeSetDataSource(manifest, { refresh })` and `EPISODE_SET_PREVIEW_VIDEO_PATH`: play episodes of several single-episode recordings (a curated dataset version) as one LeRobot v3 dataset, straight from each recording's presigned files. `info.json` and the episode rows are built in memory; every recording gets its own virtual `chunk/file` slot, so Range reads, native playback and preview copies (per recording, original as fallback) work unchanged. A `DataSource` may supply episode rows through the new optional `readEpisodeRows()` instead of `meta/episodes/*.parquet`; their row ranges are rows of the episode's own data file. A refresh is matched to the recordings by id: a recording it leaves out keeps its current URLs, and its order does not matter.
