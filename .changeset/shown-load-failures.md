---
'@ioai/lerobot-studio': patch
---

An episode that cannot load in a shown viewer (for example an episode of an episode set opened while offline, where the set's metadata opens but its files cannot be signed) is now named once, above the panels, with Retry: "You're offline. The data loads when the connection is back." while the browser is offline, otherwise "This episode could not be loaded." with the cause. The viewer loads it again by itself when the browser is back online, and its cameras request their files again. Before, the raw error ("Network request failed") showed in a strip laid over the first panel's title (the camera name), again in the episode list as "Error loading data", in every camera and in the chart, with no Retry and no recovery on reconnect. The same line names a data source swap that failed (the shown dataset stays), and its Retry now opens that source again; before, Retry did nothing.

A viewer unmounted while it reads (a host that shows another view) no longer logs "Failed to load batched feature data … Proxy has been released and is not useable": a released Parquet worker cancels its pending and later calls with an `AbortError`, and a cancelled read is not reported. A read that fails while the viewer is shown is still reported.

A feature whose depth flag is declared as `video.is_depth_map` (under `info` or `video_info`, as LeRobot v2.1 and older Hub datasets write it) is now a depth map for the stats and trim readers, as `info.is_depth_map` already was; any of the three flags counts, as in LeRobot's own `is_depth_map`.
