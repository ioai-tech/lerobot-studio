---
'@ioai/lerobot-studio': minor
---

Data foundations for hosted datasets:

- `createRemoteManifestDataSource(files, { refresh, expiresAt, episodeScope })` and `RemoteFileEntry.expiresAt`: one coalesced URL refresh on 401/403 or near expiry, then one retry; a second failure is a typed `RemoteSourceError`. A refresh owns the new expiry (`refresh` may return `{ files, expiresAt }`), near-expiry refreshes are rate-limited and background refreshes back off. Videos switch to the new URL in place.
- `createEpisodeSetDataSource(manifest, { resolve, refresh, previewVideoPath })`: episodes from many one-episode LeRobot v3 recordings, signed lazily (the first read resolves the recording and the next two; a failing prefetch never blocks the selected one); typed `EpisodeSetError`. `DataSource.focusEpisode` hints which episode is being opened.
- `episodeScope` for v2.1 and v3.0: only scoped episodes are listed; the health report marks the rest `not_evaluated`.
- `auxiliarySeries` / `onAuxiliarySeriesWarning` on `LeRobotViewer`: native-rate time series from separate parquet files (exact nanosecond timestamps), aligned to the playhead and shown in the charts and raw panel.
- Playback runs on one clock (pausing lands the slider, charts and every camera on the same frame): cameras follow it (rate trim, hard seek only past 0.5 s), the chart playhead moves without repainting, and a camera whose declared codec the browser cannot decode shows a named notice.
- Charts: one chart per feature, titled by key, dimension names from `info.features`, units when declared, the first 8 dimensions shown by default, min/max-per-pixel drawing of every sample.
- The embedded root is a labelled `region` landmark instead of an unlabelled container; the viewer never renders `main`.
- v3 `meta/episodes` may declare `data/file_from_index`.
