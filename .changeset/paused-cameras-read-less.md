---
'@ioai/lerobot-studio': patch
---

A paused camera stops reading its file once the shown frame is in. Cameras read ahead (`preload="auto"`) only while playing; paused, or while the episode's data loads, they use `preload="metadata"`. Before, every paused camera kept reading ahead and held one of the browser's six HTTP/1.1 connections to the storage host that all cameras share, so with four or more cameras a seek's range reads could queue behind them.
