---
'@ioai/lerobot-studio': minor
---

Charts read only what they show, and the viewer loads less up front:

- `DataSource.readRange(path, start, end?)` (optional, `Blob.slice` semantics) returning `ByteRangeResult`. The remote manifest, episode set and local folder sources implement it with HTTP Range / `File.slice`. Episode charts then read the parquet footer and only the selected columns' chunks of the row groups holding the episode; switching episodes in one file reuses the bytes. A server that ignores ranges costs one whole-file download, reused, with a named `RANGE_UNSUPPORTED` warning; an unknown size is the typed `RemoteSourceError` code `RANGE_SIZE_UNKNOWN` and falls back the same way.
- Progressive charts: the time axis and the top chart group arrive first, then the other groups (placeholders with `aria-busy` meanwhile); raw-panel columns are read after the charts instead of competing with them.
- The segment inspector, list and dialogs, the edit dialogs, and the `zh` / `ja` messages load on demand (web initial JS −23 KiB gzip).
