---
'@ioai/lerobot-studio': patch
---

Fix two embedding problems. Narrow containers (under 600px wide, measured on the viewer container rather than the window) now default to a single stacked column of panels that scrolls, and the chart panel toolbar wraps instead of clipping its line-chart and split-view controls; the desktop layout is unchanged. Every `<video>` (and the frame-extraction video and image decoder) now sets `crossOrigin="anonymous"`, so the media request and the later CORS `fetch()` of the same presigned URL share one CORS cache entry instead of the `fetch()` being blocked by a cached no-cors response; no credentials are sent.
