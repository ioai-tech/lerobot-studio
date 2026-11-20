---
'@ioai/lerobot-studio': minor
---

An open that cannot reach the data now ends in a named, retryable state.

- Offline before the dataset is shown, the viewer shows "You're offline" with Retry at once (no spinner), even while reads are still waiting, and keeps opening: the dataset appears if the reads succeed (`navigator.onLine` can be wrong). An open that fails while offline is reported to `onFatalError` as the new code `NETWORK_OFFLINE` (`recoverable: true`). When the browser is back online the viewer opens the dataset again by itself.
- A metadata file that the dataset has but that cannot be read (network error, HTTP status) is named `DATASET_READ_FAILED: could not read <path>` with its cause, for every metadata read (v2 JSONL, v3 Parquet, `info.json`). It used to read as a format failure ("could not be parsed as Parquet", "does not exist or cannot be read"). `onFatalError` now carries the original failure as `cause`.
- **Behaviour change for hosts:** `onFatalError` is called only while no dataset is shown. A load failure with a dataset on screen (an episode whose data cannot be read) stays inside the viewer as its error line; it used to be reported as fatal, so a host that replaces the viewer on a fatal error blanked a working view.
- Every built-in data source reports a file missing from the dataset with one typed error, `fileNotFoundError(path)` (a `DOMException` named `NotFoundError`, now exported for custom sources); the viewer reports a missing required file as a validation failure, any other read error as `DATASET_READ_FAILED`.
- Retry now resolves a URL data source again; before, it did nothing after a failed preflight.
- A short panel area (for example 1024 × 768 with the segment inspector open) keeps the cameras their share of the height; the charts' 200 px floor gives way instead of shrinking the cameras to a strip.
