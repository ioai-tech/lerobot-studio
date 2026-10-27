---
'@ioai/lerobot-studio': minor
---

Playback fixes from end-to-end acceptance on long multi-camera recordings and curated episode sets:

- The timeline never runs ahead of the cameras: while a camera switches to another episode (or has no picture yet), the playing clock holds, and every camera starts together. A camera that is still not ready after 8 s of playing (paused time does not count) stops holding the others; it shows its placeholder and joins the playing clock when ready, aimed ahead of it, so the timeline never moves back for it. A camera whose switch fails (a missing file) stops holding at once, and leaves playback once it gives up. A new selection holds the clock again, also for a camera that came late for the previous one. A camera switching episodes lets go of the old file's download, so the new file gets the browser's connections.
- Choosing an episode while paused keeps playback paused on the new episode's first frame; choosing one while playing plays on. The first episode still starts on its own, and another episode chosen before the previous one could autoplay keeps that autoplay.
- Presigned video URLs are renewed from the expiry of the URL each video element actually uses, a URL cached by the loader is reused only while the source still signs the file the same way (never past its own expiry), a prefetched next episode whose URL is about to expire loads again, and a renewal that cannot wait for its rendezvous any longer swaps at once, at the clock's frame (never jumping the timeline forward).
- Retry on a camera that failed before showing anything loads it again; after a failed episode switch it loads the episode switched to, not the one before. Each automatic retry costs one request (a probe) until the server answers.
- The playback bar, the subtask dialog and the chart's time axis count episode time from 0:00, also for episodes far into a long recording; the chart never keeps another episode's time range.
- The Original planner reads each file's bit rate from its own duration (never an episode's end time) and estimates the link from its best recent measurement; a stall drops the readings above what the link carried, so Original does not come back a minute later and stall again.
- The Raw panel shows the frame playback stops on; a layout change while playing does not leave cameras paused; Esc leaves a camera's full screen.
