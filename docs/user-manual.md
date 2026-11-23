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

### Split and review episodes

A long recording often holds several attempts. In **Edit episodes**, mark each useful range as a _segment_; export writes every segment as its own episode. An episode with no segments is exported whole.

Segments appear as numbered bands above the timeline and in the episode list. Each segment has an inclusive frame range, an optional task (empty means the episode's task), subtasks, and a review state: **To review** (striped) or **Confirmed**. Segments in one episode never overlap.

The details panel under the playback bar shows the selected segment. **In** and **Out** are times (`m:ss.cc`); Out is the end of the last frame, so neighbouring segments share a time. Type a time and press `Enter`, or `Escape` to revert. A value that is refused stays in the field, marked, with the reason. Drag a band edge on the timeline to move it; the edge stops at its neighbours.

Editing a segment never confirms it. Confirm is a separate step (`A`) and cannot be undone. After a confirm, review goes on at the next segment to review that the list shows: it is selected, its details open and the playhead waits, paused, at its start. When none is left, the status line says so. Every other change can be undone (`Ctrl/⌘+Z`) and redone (`Shift+Ctrl/⌘+Z`); the last 100 steps are kept.

Keys work as soon as the viewer opens, without a click, and while you use it; not while you type in a field, use a control of the page around the viewer, or have a dialog open. Press `?` for this list in the app.

| Key                           | Action                                                                |
| ----------------------------- | --------------------------------------------------------------------- |
| `N`                           | New segment from the playhead to the next segment or the episode end  |
| `[` / `]`                     | Set In / Out of the selected segment at the playhead                  |
| `,` / `.`                     | Move the edge nearer the playhead by one frame                        |
| `Alt+,` / `Alt+.`             | Move the edge nearer the playhead by one second                       |
| `S`                           | Split the selected segment at the playhead                            |
| `M`                           | Merge with the next segment                                           |
| `R` / `Delete`                | Delete the selected segment (Undo restores it)                        |
| `A`                           | Confirm the selected segment and go on to the next one to review      |
| `Shift+A`                     | Confirm every segment to review in the current filter (asks first)    |
| `J` / `K`                     | Next / previous segment the list shows, across episodes               |
| `G`                           | Jump to the next frame that is in no segment                          |
| `L`                           | Loop playback inside the selected segment                             |
| `Shift+[` / `Shift+]`         | Start / end a subtask at the playhead                                 |
| `Ctrl/⌘+Z` / `Shift+Ctrl/⌘+Z` | Undo / redo                                                           |
| `1`–`9`                       | Choose an option of a field that declares that key (embedded viewers) |
| `?`                           | Show the keys                                                         |

Splitting keeps the task, review state and field values on both halves and cuts a subtask that crosses the split point. A new segment (`N`) starts with the task of the segment before it (else the one after it); in an episode with no segment it keeps the episode's task. Merging keeps the first segment's task and values, joins tag lists, and is confirmed only if both segments were.

The list filter shows **All**, **To review**, or **Issues** (segments a host flagged). A suggested segment says how confident its suggester was (for example "Suggested · 82% confidence") until it is confirmed. Segments stay in the current browser session until you export.

In a short or narrow window (a 1024 × 768 laptop screen) the details panel is compact: the review actions stay in one row as icons (each names its action and key on hover), and the rarer ones (Set in / out, edge moves, Next uncovered, Loop, subtasks, Undo / Redo, Keys) are under **More actions**. Their keys work the same.

### Suggest segments from motion

Use **Select** in the episode sidebar, select episodes, and choose **Suggest segments**. Only selected episodes in the current filtered list are included. Choose either:

- **Remove fixed durations**: suggest a range that drops a number of seconds from each end of the original episode. Episodes too short for the request are skipped.
- **Suggest retained ranges**: detect movement in a position or gripper state feature, then keep a buffer before and after it. Both buffers default to **3 seconds**. Select the feature, sensitivity, and participating dimensions. Episodes that already have segments are skipped unless you enable replacing them.

Review each proposed range, removed duration, and status. Click a range to preview it in the player and adjust it, then return to the suggestions. **Add as segments to review** adds one striped segment per episode; nothing changes before that. The whole batch is one undo step. Closing without adding discards the proposals.

The detector uses short windows of numeric state data, with a noise threshold and conservative boundary padding. It keeps pauses between movements and does not analyze video or identify task semantics. Low-frequency sensor drift, very slow movements, and return-to-home movements may look like useful actions; check sensitivity and dimensions on your recordings. All-static, missing, invalid, or insufficient signals produce no suggestion. Continuous movement keeps the entire episode.

### How segments are exported

Each segment becomes one episode with its rows only: frame indices and timestamps restart at zero, subtask labels are clipped to the segment, and the episode's task is the segment's task. Episode indices are renumbered in order. Numeric statistics are recomputed; RGB/grayscale visual statistics are sampled from at most 100 evenly spaced frames per camera, including both ends. The original files remain unchanged.

For `v3.0` → `v3.0`, leave **Remove unused video segments (slower)** unchecked for a fast export: shared MP4s are copied and each segment's references point into them. Check it to cut the video too. Other version combinations cut the video. Re-encoding needs browser codec support and can change image quality or file size. Constant-frame-rate RGB/grayscale datasets are supported; incompatible timestamps, raw depth/TIFF statistics, missing frames, or failed codecs produce an export error instead of an incomplete dataset.

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
