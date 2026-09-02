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

## Export a dataset

Export is available in the standalone app for supported `v2.1` and `v3.0` datasets.

- **ZIP** works in supported browsers.
- **Folder** export requires the browser folder picker, which is usually available in Chromium-based browsers.
- You can export as LeRobot `v2.1` or `v3.0`.
- `v3.0` has an **Include subtasks** option, off by default. Turn it on to write `subtask_index` and `meta/subtasks.parquet`; every exported episode must then be fully labeled.

The exported dataset includes your current episode edits. The React npm package does not include the export engine.

## Language and theme

Use the controls in the top bar to switch between English, Simplified Chinese, and Japanese, or choose light, dark, and system theme modes.

## Next steps

- Remote archive does not open? See [CORS and HTTP Range](./cors.md) and [Troubleshooting](./troubleshooting.md).
- Need the supported versions and browser limits? See [Data formats](./data-formats.md) and [Browser support](./browser.md).
- Need to add the viewer to your product? See [Embedding](./embedding.md).
