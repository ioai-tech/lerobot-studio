---
'@ioai/lerobot-studio': minor
---

Playback fixes from end-to-end acceptance on long multi-camera recordings and curated episode sets:

- The timeline never runs ahead of the cameras: while a camera switches to another episode (or has no picture yet), the playing clock holds, and every camera starts together. A camera that is still not ready after 8 s stops holding the others; it shows its placeholder and joins when ready. A camera switching episodes lets go of the old file's download, so the new file gets the browser's connections.
- Choosing an episode while paused keeps playback paused on the new episode's first frame; choosing one while playing plays on. The first episode still starts on its own.
- Presigned video URLs are renewed from the expiry of the URL each video element actually uses, a prefetched next episode whose URL is about to expire loads again, and a renewal that cannot wait for its rendezvous any longer swaps at once.
- Retry on a camera that failed before showing anything loads it again; each automatic retry costs one request (a probe) until the server answers.
- The playback bar, the subtask dialog and the chart's time axis count episode time from 0:00, also for episodes far into a long recording; the chart never keeps another episode's time range.
- The Original planner reads each file's bit rate from its own duration (never an episode's end time) and estimates the link from its best recent measurement.
- The Raw panel shows the frame playback stops on; a layout change while playing does not leave cameras paused; Esc leaves a camera's full screen.
