---
'@ioai/lerobot-studio': minor
---

Fixes from the s10 viewer walk.

- Auto layout never leaves a camera out while its rows have room: with four cameras two to a row, ALOHA's `cam_low` was dropped after the wrist row filled (up to six cameras are laid out; more stay in the panel menu).
- An episode opens paused on its first frame, and selecting another episode keeps the play state: paused stays paused, playing keeps playing. `shouldStartAutoplay` / `AutoplayDecisionInput` are replaced by `shouldPlayShownEpisode` / `ShownEpisodePlayInput`.
- J / K step to the next / previous episode when the segment UI is off, as ↓ / ↑ do (one key map for browse and review).
- Proposed segments in the overlay band are as tall as segment blocks, numbered, and alternate in shade, so dozens stay readable.
- A chart group reserves its plot's height: in a short panel the legend chips no longer sit on the plot or its x-axis; the groups scroll instead.
- A segment row keeps each badge (Excluded, Suggested 0.33, Check warnings 1) on one line; the Excluded badge is no longer struck through.
- A host notice puts its action under the text, so in a narrow sidebar the text keeps full lines instead of one word per line.
- A read-only inspector shows a select field's chosen value as text (`Outcome Failure`), not as disabled toggle buttons.
