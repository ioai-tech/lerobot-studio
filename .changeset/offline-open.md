---
'@ioai/lerobot-studio': minor
---

An open that cannot reach the data now ends in a named, retryable state.

- Offline before the dataset is shown, the viewer shows "You're offline" with Retry at once (no spinner), even while reads are still waiting. A host with `onFatalError` receives the new code `NETWORK_OFFLINE` (`recoverable: true`). When the browser is back online the viewer opens the dataset again by itself.
- A metadata file that cannot be read (network error, HTTP status) is named `DATASET_READ_FAILED: could not read <path>` with its cause. It used to read as a format failure ("could not be parsed as Parquet").
- Retry now resolves a URL data source again; before, it did nothing after a failed preflight.
- A short panel area (for example 1024 × 768 with the segment inspector open) keeps the cameras their share of the height; the charts' 200 px floor gives way instead of shrinking the cameras to a strip.
