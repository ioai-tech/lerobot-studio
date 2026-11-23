---
'@ioai/lerobot-studio': patch
---

Every form control the viewer renders now has an id or a name and a label, so Chrome no longer reports "A form field element should have an id or name attribute" on a page that embeds the viewer (the sidebar's episode search and duration filters were reported). The `Input` and `Textarea` primitives give themselves a `useId` id when the caller passes none; the rows-per-page select and the subtask name field no longer use fixed ids, so two viewers on one page never share an id. The two duration bounds are announced apart ("Minimum duration (s)", "Maximum duration (s)"; new message keys `sidebar.durationMin` and `sidebar.durationMax`), and the panel filter searches, the bulk task editor, the remote archive URL, the task dialog fields and the chart's action/state toggles have labels. The tri-state box drawn in a filter row is now only a picture: the row button carries the state as `aria-pressed`, and the box leaves the tab order.
