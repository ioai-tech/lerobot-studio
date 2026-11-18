---
'@ioai/lerobot-studio': minor
---

Split and review episodes with segments. A segment is an inclusive frame range inside an episode with a task, subtasks, host-declared field values and a review state (to review / confirmed); export writes each segment as its own episode, and an episode without segments exports whole. Keyboard-first review (`N`, `[`/`]`, `,`/`.`, `S`, `M`, `R`, `A`, `Shift+A`, `J`/`K`, `G`, `L`, `Ctrl/⌘+Z`, `?`), typed undo/redo with inverse changes, In/Out time fields, and a segment list with All / To review / Issues filters.

`LeRobotViewer` gains `annotation` (host-controlled `value`, `onChange` with typed `AnnotationChange` ops, `saveState`, `createSegmentId`), `readOnly` (always wins: no edit control, no edit key), `fields` (`select` with `1`–`9` option keys, `tags`, `text`) and `messages` (replace built-in segment copy by key). `applyChange` is exported as the reference reducer.

Breaking for the standalone app: per-episode trimming is replaced by segments; **Batch trim** becomes **Suggest segments** and adds suggested segments to review. Export option `trimRanges` and `subtaskOverlay` are replaced by `segments`, and a new **Fill gaps as "unlabeled"** option labels uncovered frames instead of refusing the export.
