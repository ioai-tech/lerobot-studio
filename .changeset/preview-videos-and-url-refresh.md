---
'@ioai/lerobot-studio': minor
---

Add `previewVideoPath` to `LeRobotViewer`: a template, in the syntax of `info.video_path`, of a lighter preview copy of every video with the same frames and timestamps. Video panels play the preview where the file exists, and the playback bar offers a Preview / Original switch that keeps the current frame. `createRemoteManifestDataSource(files, { refresh })` renews presigned URLs shortly before the earliest `expiresAt` and after a request is refused with 400/401/403, without reloading the viewer; a video that fails mid-playback (an expired URL) resumes from the same time with a fresh URL. The playback engine is now created once per viewer, so a dependency change during playback no longer stops the videos silently. The Raw panel's default selection follows the chart's 64-dimension budget, and a feature subscription no longer reads columns the episode load is already reading.
