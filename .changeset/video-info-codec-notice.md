---
'@ioai/lerobot-studio': patch
---

A camera whose codec the dataset declares under `video_info` (LeRobot v2.1 and older Hub datasets, for example `lerobot/aloha_static_coffee` or `lerobot/droid_100`) now gets the named "This browser cannot play AV1 video (camera)" notice where the browser cannot decode that codec, as datasets declaring it under `info` already did. Before, the codec check read only `info`, so such a camera was treated as playable and, in a browser without AV1 (for example Safari on a Mac without AV1 hardware decode), stayed on "Waiting for video file…" with no notice. The declared size used for the check and for the camera layout is read from either key too.
