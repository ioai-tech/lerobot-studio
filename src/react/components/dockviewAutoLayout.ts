/**
 * The automatic panel layout as one serialized dockview grid: built in a single `fromJSON` (no
 * add-then-rebalance double build), with equal widths per row, visual rows sharing two thirds of the
 * height and chart + raw below.
 */

import type { SerializedDockview } from 'dockview-react';

export interface AutoPanel {
  id: string;
  component: 'video' | 'image' | 'chart' | 'raw';
  title: string;
  params: Record<string, unknown>;
}

export interface AutoLayoutInput {
  /** Visual panels per row (one or two rows). */
  visualRows: AutoPanel[][];
  /** Chart and raw panels. */
  bottom: AutoPanel[];
  /** Narrow containers: one column of panels. */
  stacked: boolean;
  width: number;
  height: number;
}

type GridNode = SerializedDockview['grid']['root'];

function leaf(panel: AutoPanel, size: number): GridNode {
  return {
    type: 'leaf',
    data: { id: `group-${panel.id}`, views: [panel.id], activeView: panel.id },
    size,
  };
}

function row(panels: AutoPanel[], height: number, width: number): GridNode {
  if (panels.length === 1) return leaf(panels[0], height);
  const each = width / panels.length;
  return {
    type: 'branch',
    data: panels.map((panel) => leaf(panel, each)),
    size: height,
  };
}

/** The arrangement only: equal signatures need no rebuild (a width change inside a breakpoint). */
export function autoLayoutSignature(
  input: Pick<AutoLayoutInput, 'visualRows' | 'bottom' | 'stacked'>,
): string {
  return JSON.stringify({
    stacked: input.stacked,
    rows: input.visualRows.map((panels) => panels.map((panel) => panel.id)),
    bottom: input.bottom.map((panel) => panel.id),
  });
}

export function buildAutoLayout(input: AutoLayoutInput): SerializedDockview {
  const width = Math.max(1, Math.round(input.width));
  const height = Math.max(1, Math.round(input.height));
  const visual = input.visualRows.filter((panels) => panels.length > 0);
  const all = [...visual.flat(), ...input.bottom];

  let children: GridNode[];
  if (input.stacked) {
    const each = height / Math.max(1, all.length);
    children = all.map((panel) => leaf(panel, each));
  } else if (visual.length === 0) {
    children = [row(input.bottom, height, width)];
  } else {
    const bottomHeight = input.bottom.length > 0 ? height / 3 : 0;
    const rowHeight = (height - bottomHeight) / visual.length;
    children = visual.map((panels) => row(panels, rowHeight, width));
    if (input.bottom.length > 0) children.push(row(input.bottom, bottomHeight, width));
  }

  const panels: SerializedDockview['panels'] = {};
  for (const panel of all) {
    panels[panel.id] = {
      id: panel.id,
      contentComponent: panel.component,
      tabComponent: 'default',
      title: panel.title,
      params: panel.params,
    };
  }

  return {
    grid: {
      root: { type: 'branch', data: children, size: width },
      width,
      height,
      orientation: 'VERTICAL' as SerializedDockview['grid']['orientation'],
    },
    panels,
    activeGroup: all[0] ? `group-${all[0].id}` : undefined,
  };
}
