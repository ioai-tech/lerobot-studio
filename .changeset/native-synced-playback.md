---
'@ioai/lerobot-studio': minor
---

Play videos natively instead of seeking every frame. While playing, every video panel runs `play()` and the first one is the clock: the frame index, charts and overlays follow its `currentTime`. The other cameras are kept within about a frame by nudging `playbackRate` (±5%), and seek only when more than 0.5 s off. When any camera runs out of buffered data, all of them pause and the panel shows "Buffering…" until every camera can play again, so the timeline never runs ahead of the picture. Paused, scrubbing and frame stepping still seek exactly; datasets without video keep the timer.
