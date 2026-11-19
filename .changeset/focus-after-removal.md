---
'@ioai/lerobot-studio': patch
---

Keys keep working after the focused control goes away. Deleting the focused segment (R or the Delete button), a merge or undo that removes the focused row, a host removing a segment, or a focused button becoming disabled (Confirm once confirmed) used to leave focus on the page body, outside the viewer, so J, Ctrl+Z and every other key did nothing until the next click. One rule now covers every such path: focus moves to the next item of the same list (segment list or track), else the previous one, else the viewer root.
