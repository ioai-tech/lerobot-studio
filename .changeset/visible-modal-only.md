---
'@ioai/lerobot-studio': patch
---

Keys pressed on the page reach the viewer again on a host page that keeps a closed modal mounted. Only a modal a person can see now keeps the page's keys: an `aria-modal="true"` element or a `<dialog>` opened with `showModal()` counts while it is rendered and visible, and not while it, or an ancestor, is `aria-hidden="true"`, `inert`, `display: none` (`hidden`) or `visibility: hidden`, as a closed keepMounted drawer, a hidden portal or a dialog kept for its exit transition is. Before, any such element anywhere on the page swallowed every page key (`J`, `K`, `A`, `N`, Shift+. and the rest did nothing). A shown modal still keeps its keys. A non-modal `<dialog>` (`show()`) no longer takes the page's keys; it keeps only the keys pressed while focus is inside it.

A camera panel's region is announced by the name its tab shows: the host's `cameraLabels` name, else the last part of the feature key. Before, the region kept the key's last part while the tab showed the host's name. The panel's own title follows the same name.
