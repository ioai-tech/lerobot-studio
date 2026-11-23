---
'@ioai/lerobot-studio': patch
---

Reviewing segments is one smooth loop (walk 2026-11-23 on 1.7.0):

- Keys work right after the viewer opens, before any click. Before, focus was on the page (`<body>`) and `J`, `A`, `N`, `S` and `[` did nothing although the viewer said "Press N…". A key pressed on the page itself now reaches the viewer that opened or was used last among the shown ones (one key, one viewer, with several on a page); a field, a focused control of the host page or an open modal dialog keeps its keys. On the page, a key with Ctrl, ⌘ or Alt (a host's Ctrl+K, the browser's Alt+←), a key composing text (IME) and a key on an editable page are never taken. The new `keyboardScope` prop (`'auto'` default, `'page'`, `'viewer'`, type `LeRobotKeyboardScope`) lets a host choose. Space and the arrows follow the same rule, so a key on the page no longer plays every viewer of the page at once.
- `A` (and Confirm) confirms the segment, then selects the next segment to review that the list shows: its details open and the playhead waits, paused, at its start; the status line says "Next to review: #n." or that nothing is left. Before, with the To review filter, the confirmed segment left the list but stayed selected, with its details and playhead, while focus jumped to the next row. Focus now follows the selection whenever a row of the list has it, and `J` / `K` step only through the segments the filter shows.
- A suggested segment reads "Suggested · 25% confidence" instead of a bare "Suggested 0.25", and a confirmed row no longer repeats it (its details still do).
- At 1024 × 768 the details panel is compact: In, Out and Task on one line, the actions in one row of icons (each names its action and key), the rarer actions under More actions. The cameras keep usable frames and the chart its plot; before, the action bar wrapped to three rows and the chart collapsed to its header.
- A new segment (`N`) starts with the task of the segment it continues (the one before it, else the one after it), as both halves of a split do; with no segment in the episode it keeps the episode's task. Fields marked with the new `AnnotationField.inherit` carry over too.
- Episodes are numbered for people from 1 (`#1` is `episode_index` 0) in the episode list, its search and labels, loading messages, Suggest segments and export messages; the index stays in the episode's own fields. Messages that named the episode with `{{index}}` now use `{{number}}` (the index is still passed as `index`).
- The raw panel's media label is translated (视频 / 图像, 動画 / 画像).
