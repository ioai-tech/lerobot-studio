# User Guide

> **Language / 语言：** [English](./user-manual.md) | [简体中文](/zh-CN/user-manual)

This guide is for viewing and checking LeRobot datasets in the standalone app at [lerobot.studio](https://lerobot.studio).

## Open a dataset

Choose the option that matches your data:

| Option             | Use it for                                     |
| ------------------ | ---------------------------------------------- |
| **Local folder**   | An unpacked LeRobot dataset on your computer   |
| **Local archive**  | A `.zip`, `.tar`, `.tar.gz`, or `.tgz` dataset |
| **Remote archive** | An HTTP(S) URL to one of those archives        |

You can also open a shared link that contains `?url=...`.

Local folders and archives are processed in your browser. They are not uploaded to a cloud service. When you open a remote URL, the browser requests data from that URL's server.

### Recent datasets

The **Open** menu keeps a list of recent datasets. If you previously granted browser access to a local folder or file, the app may ask you to grant access again before reopening it.

## Browse episodes

Select an episode in the left sidebar. Use search and filters to find a task or a shorter/longer episode.

The playback bar lets you:

- play or pause;
- drag the timeline to a frame;
- step through frames with the arrow buttons;
- change playback speed; and
- switch between sequential, random, and loop playback.

Keyboard shortcuts:

| Key                        | Action                              |
| -------------------------- | ----------------------------------- |
| `Space`                    | Play/pause. In Edit, pause to label |
| `←` / `→`                  | Previous or next frame              |
| `Shift` + `←` / `→`        | Move 10 frames                      |
| `Cmd` / `Ctrl` + `←` / `→` | Move 5 frames                       |
| `↑` / `↓`                  | Previous or next episode            |
| `Home` / `End`             | First or last frame                 |

## Read the data

The default layout keeps video, charts, and raw features on the same frame.

- **Video / Image** shows camera data.
- **Chart** shows numeric features over time. Choose which features to plot.
- **Raw** shows the source values for the current frame.
- **Analysis** in the sidebar shows dataset totals, duration distribution, and task distribution.

You can add panels, split the layout to the right or below, and close panels you do not need.

Video playback depends on the video codec and your browser. If a video cannot play, charts and raw data may still be available.

## Check the dataset

Open **Dataset health check** from the app menu to inspect common format problems, such as missing metadata, invalid episode counts, or missing files. You can export the report as CSV.

## Edit episodes

For fully supported datasets (`v2.1` and `v3.0`), you can change episode task descriptions, select multiple episodes, and delete or restore episodes within the current session.

These edits stay in the current browser session until you export a dataset. The app does not overwrite your original files.

### Annotate subtasks

Writable `v3.0` can be labeled in **Edit**. `v2.1` can show existing `subtask_index` values but cannot add labels.

- Pause (`Space`) to name the range from the previous end (or frame 0) to the playhead.
- Episode end stays here and offers the last unlabeled gap.
- Click an unlabeled bar region to name that gap.
- Drag edges, double-click to rename, or hover to delete.

Colored ranges show whenever subtasks exist, including outside Edit. Official unlabeled frames (`subtask_index = -1`) stay empty. Missing `meta/subtasks.parquet` falls back to `Subtask N`.

`v3.0` export includes subtasks only when **Include subtasks** is checked. That option requires every exported frame labeled and never writes `-1`. Extra official columns such as `task_index_high_level` are kept.

Verified Hub examples and download commands: [Data formats — Official Hub examples](./data-formats.md#official-hub-examples).

Newer minor versions in the `v2` and `v3` families may open in read-only mode. `v2.0`, other major versions, and datasets without a version are not opened.

### Trim an episode

In **Edit episodes**, choose **Trim episode** in the playback bar. Each episode can retain one continuous range. Drag either boundary, enter frame numbers, or use **Set start here** / **Set end here** at the playhead. Frame numbers start at zero and both endpoints are included. **Play retained range only** stops at the selected end; **Reset trim** restores the full episode.

Trims stay in the current browser session, including when switching episodes. Export writes only retained data rows, resets episode frame indices and timestamps, and clips subtask labels to the same range. Subtask coverage is checked only on retained frames. Numeric statistics are recomputed; RGB/grayscale visual statistics are sampled from at most 100 evenly spaced retained frames per camera, including both endpoints. The original files remain unchanged.

For `v3.0` → `v3.0`, leave **Remove unused video segments (slower)** unchecked for a fast export: shared MP4s are copied and their references point to the retained range. Check it to physically trim the video too. Other version combinations physically trim edited episodes. Re-encoding needs browser codec support and can change image quality or file size. The first version supports constant-frame-rate RGB/grayscale datasets; incompatible timestamps, raw depth/TIFF statistics, missing frames, or failed codecs produce an export error instead of an incomplete dataset.

### Batch trimming and motion suggestions

Use **Select** in the episode sidebar, select episodes, and choose **Batch trim**. Only selected episodes in the current filtered list are included. Choose either:

- **Remove fixed durations**: remove a specified number of seconds from each end of the original episode. Repeating the calculation does not accumulate removals. Episodes too short for the requested removal are skipped.
- **Suggest retained ranges**: detect movement in a position or gripper state feature, then retain a buffer before and after it. Both buffers default to **3 seconds** and are independently adjustable. Select the feature, sensitivity, and participating dimensions; existing trims are skipped unless you enable overwriting.

Calculate the ranges and review each episode's proposed interval, removed duration, and status. Click a range to preview it in the player and adjust its frame boundaries. **Return to batch trim** keeps those adjustments in the proposal; only **Apply selected ranges** changes the export selection. **Undo this batch** restores the previous trims while this dialog remains open, without overwriting subsequent edits. Changing calculation settings or starting another calculation clears that undo history. Closing without applying discards the proposals.

The detector uses short windows of numeric state data, with a noise threshold and conservative boundary padding. It keeps pauses between movements and does not analyze video or identify task semantics. Low-frequency sensor drift, very slow movements, and robot return-to-home movements may be indistinguishable from useful actions; sensitivity and dimension selection need checking on your recordings. All-static, missing, invalid, or insufficient signals produce no reliable suggestion. Continuous movement retains the entire episode. Cancellation discards pending proposals; an in-flight data read may finish in the background.

Batch ranges use the same export path as manual trimming, including subtask clipping, recomputed statistics, and **Remove unused video segments (slower)**.

## Export a dataset

Export is available in the standalone app for supported `v2.1` and `v3.0` datasets.

- **ZIP** works in supported browsers.
- **Folder** export requires the browser folder picker, which is usually available in Chromium-based browsers.
- You can export as LeRobot `v2.1` or `v3.0`.
- `v3.0` has an **Include subtasks** option, off by default. Turn it on to write `subtask_index` and `meta/subtasks.parquet`; every exported episode must then be fully labeled.

The exported dataset includes your current episode edits. The React npm package does not include the export engine.

For `v3.0` → `v3.0`, export copies each referenced shared MP4 once and preserves its episode timestamps. It rewrites the retained Parquet rows and split ranges without re-encoding videos. Deleted episodes are no longer read by the dataset, but their footage can remain inside a shared video file; files with no remaining references are omitted. Enable **Remove unused video segments (slower)** to physically trim unused footage. Trimming may re-encode video and increase output size; deleting an episode does not guarantee a smaller ZIP.

## Language and theme

Use the controls in the top bar to switch between English, Simplified Chinese, and Japanese, or choose light, dark, and system theme modes.

## Next steps

- Remote archive does not open? See [CORS and HTTP Range](./cors.md) and [Troubleshooting](./troubleshooting.md).
- Need the supported versions and browser limits? See [Data formats](./data-formats.md) and [Browser support](./browser.md).
- Need to add the viewer to your product? See [Embedding](./embedding.md).
