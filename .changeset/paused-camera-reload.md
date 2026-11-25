---
'@ioai/lerobot-studio': patch
---

A camera that played and is then paused stops downloading. Chromium could go on reading the whole file it had played with `preload="auto"` after the viewer switched a paused camera to `preload="metadata"`. It read at full rate while `buffered` and `networkState` showed nothing, and held one of the browser's six connections to the storage host (in a test with six 32 MB cameras, all 192 MB arrived while paused). On pause, each camera now reloads its file at the shown frame: the running response ends and only that frame's bounded read follows. The shown frame stays on screen meanwhile, and the camera lands on the same frame. Cameras opened paused, and seeks while paused, already read only what the frame needs and are unchanged.
