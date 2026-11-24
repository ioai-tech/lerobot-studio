---
'@ioai/lerobot-studio': patch
---

Host APIs for a review console (walk 2026-11-23):

- **Navigable marker rows.** `TimelineMarker.lane` and the new `markerLanes` prop (`TimelineMarkerLane[]`: `id`, `label`, `navigable`) split the marker lane into named rows, top to bottom; markers without a declared row stay in the default row below them, unchanged. A `navigable` row shows its position (`3 / 39`) with Previous / Next buttons, and `Shift+.` / `Shift+,` (unbound until now) step through it: the playhead pauses on the next / previous marker's first frame and the row announces "Possible faces 3 of 39" (or that there is none further). Markers on the same frame are each a step. The keys follow the page-key rules of every viewer key and are left to the page while the shown episode has no navigable row. The `?` sheet lists them. New message keys `markers.lane.*`.
- **Display hints.** `Segment.taskHint` is shown muted in the segment list and details while `task` is `null` (instead of the inherited-task copy) and as the task input's placeholder; `SegmentSubtask.labelHint` does the same for an empty subtask label on the subtask track and in the rename dialog, and makes an empty label valid (an export counts its frames as unlabeled). Hints are never a value: every change sent to `onChange` and every export leaves them out.
- **Camera names.** The new `cameraLabels` prop (`Record<featureKey, name>`) names camera panels and the codec notice; new labels rename shown panels without a new layout. Without a label a camera keeps the last part of its key; with one, the key stays in the panel title's tooltip and the camera's technical details (new message keys `panels.video.debug.feature`, `panels.image.debug.feature`).
- The export progress line "Data episode N" numbers episodes from 1, like the rest of the viewer.
