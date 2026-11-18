---
'@ioai/lerobot-studio': minor
---

Charts read only what they show, and the viewer loads less up front:

- `DataSource.readRange(path, start, end?)` (optional, `Blob.slice` semantics) returning `ByteRangeResult`. The remote manifest, episode set and local folder sources implement it with HTTP Range / `File.slice`. Episode charts then read the parquet footer and only the selected columns' chunks of the row groups holding the episode; switching episodes in one file reuses the bytes. A server that ignores ranges costs one whole-file download, reused, with a named `RANGE_UNSUPPORTED` warning; an unknown size is the typed `RemoteSourceError` code `RANGE_SIZE_UNKNOWN` and falls back the same way.
- Range reads combine bytes of one file version only (same size, and same `ETag` when exposed); a changed file is opened again once, then read whole (`FILE_CHANGED`), also when it changes again while a read is being planned anew. Hostile footers (spans outside the data, oversized collections, footers over 64 MiB) are refused with `FOOTER_INVALID` before any read. `ByteRangeResult.etag` (optional) carries the version.
- Progressive charts: the time axis and the top chart group arrive first, then the other groups (placeholders with `aria-busy` meanwhile); raw-panel columns and auxiliary series are read after the charts instead of competing with them. The first chart follows the first video frame; the others are limited by their bytes on the link.
- The segment inspector, list and dialogs, the edit dialogs, and the `zh` / `ja` messages load on demand (web initial JS −23.2 KiB gzip). A lazily loaded part that fails to load (including the layout and the batch trim dialog) shows a named `CHUNK_LOAD_FAILED` notice with a retry instead of taking the viewer down; when the retry fails too, it also offers a page reload.
- Switching data sources while an episode loads drops the old source's load.
- Opening a dataset requests its metadata files (episodes, tasks, subtasks) together after `info.json`, each downloaded and parsed once, instead of one after another; the shown cameras' URLs resolve with the episode's data instead of after the panels mount, and the camera panels mount once.
- A new `dataSource` with the same timeline swaps in place: the shown dataset stays on screen while the new one opens (no loading view), cameras hold their last frame until the new file shows it, and a source that fails to open leaves the shown one in place with the error.
