---
'@ioai/lerobot-studio': patch
---

The camera and image panels' debug details (shown at the top left while the panel is hovered) scroll when they are longer than the panel allows: with the mouse wheel, by dragging their scrollbar, or with a touchpad. Before, the overlay showed a scrollbar but let every pointer event through to the panel, so its last rows could not be reached. Hidden, it still lets clicks through to the panel; scrolling past its end no longer scrolls the page, and its scrollbar is thin.
