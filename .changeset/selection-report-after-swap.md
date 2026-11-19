---
'@ioai/lerobot-studio': patch
---

`onSelectionChange` reports the last time also when it changed while a selection was on its way (a deep link or a data-source swap): the report held back meanwhile is made once the selection lands or is dropped, even when no frame change follows. Before, a swap that landed where it was could leave the host with an earlier time.
