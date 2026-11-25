---
'@ioai/lerobot-studio': patch
---

The chart panel draws one chart again, as in 1.4: every numeric feature (`action`, `observation.state`, each `observation.*` such as three `observation.pose.*`) and every auxiliary series share one plot on the episode's time axis. Before, each feature got its own chart with a row of legend chips, so a dataset with several `observation.*` features stacked charts in a panel that scrolled with the browser's default scrollbar. The panel no longer scrolls and has no legend: the filter menu at its top left picks the features and lines to draw (auxiliary series are listed after the dataset's features), and hovering a line in it fades the others. Every dimension is drawn by default, as in 1.4 (before, the first 8 of each feature).

Hovering the chart shows the time, the frame and the values of the 12 lines nearest the pointer (the rest are counted), read from the full-resolution samples; a click still seeks. An action and the state of the same joint share a color (action dashed, state solid); features that reuse names (each pose's `x`, `y`, `z` …) get their own colors, and state lines are dotted once the palette wraps. The filter menu's color dots match the lines. A missing auxiliary column is named over the chart. While its data loads, the panel shows one plot placeholder.
