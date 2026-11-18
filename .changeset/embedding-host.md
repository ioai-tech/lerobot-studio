---
'@ioai/lerobot-studio': minor
---

Embedding for hosts:

- `markers` on `LeRobotViewer`: ranges or ticks on the time axis by severity, with tooltips; a segment that overlaps a `warn` or `fail` marker is in the Issues filter and shows an issue count.
- `overlaySegments`: read-only segments (for example another process's proposals) in a thin band above the segment track, with an `overlay.legend` message.
- `extensions`: declarative host toolbar items (button, toggle, link) and notices with progress, rendered in the viewer's style; disabled and busy buttons stay focusable, and a disabled button's reason is its tooltip and `aria-describedby`.
- `initialSelection` (episode, segment, time; lands paused on the frame) and `onSelectionChange` (episode and segment at once, time at most 4 per second). A new `dataSource` with the same timeline keeps the episode, segment and frame.
- `themeTokens` (`primary`, `primaryForeground`, `radius`, `fontFamily`, with `dark` overrides) on the viewer root.
- `auxiliarySeries` accept `timeColumn: null` with `timeUnit: 'frame'` (row `i` is frame `i`); `null` with another unit is refused with `ROW_TIME_NEEDS_FRAME_UNIT`.
- `messages` may also replace `overlay.*` and `markers.*` copy.
- Layout: cameras get the height first (their row takes what the frames need, at least 62 % of the panel area, charts keep 200 px) in the arrangement that shows the biggest frames; the rows are sized in place, so window or host-notice size changes never re-mount the cameras (the previous sizing read the wrong grid fields and never applied). Charts show placeholders laid out like the final charts while loading.
- One time axis: the slider, segment and subtask tracks, markers, overlay band and charts place frame `k` of `N` at `k / N`; the total time is the end of the last frame.
- Below 768 px of viewer width, editable segments show "Editing needs a wider window" instead of edit controls; playback and lists still work.
