---
'@ioai/lerobot-studio': minor
---

Read episode data with HTTP Range requests. A `DataSource` may now implement `getSize` and `readRange`; the remote manifest source (one `Range: bytes=` request per read, refusing servers that ignore Range) and both local directory sources do. The parquet worker then fetches only the footer, the row groups of the selected episode and the requested column chunks (hyparquet) instead of downloading and decoding the whole data file, so a 150 MB data file with one 22-minute episode opens with about 7 MB read; sources without `readRange` keep the whole-file path. Wide numeric datasets also load less up front: the episode read and the chart's default selection take whole features in `info.json` order up to 64 dimensions, and any other feature is read when it is ticked in the chart filter.
