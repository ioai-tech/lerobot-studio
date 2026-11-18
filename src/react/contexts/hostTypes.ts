/**
 * Declarative host chrome: the viewer renders these in its own style, focus
 * order, theme and narrow layout. Hosts pass data and callbacks, never React
 * elements. Every `label` / `text` is display text (localize it first).
 */

/** Icons a toolbar button may show. */
export type LeRobotToolbarIcon = 'sparkles' | 'refresh' | 'external' | 'download' | 'none';

/** A button that runs a host action. */
export interface LeRobotToolbarButton {
  /** Item type. */
  kind: 'button';
  /** Unique within its extension. */
  id: string;
  /** Button text. */
  label: string;
  /** Icon before the text. @defaultValue 'none' */
  icon?: LeRobotToolbarIcon;
  /** Called on press (not while `disabled` or `busy`). */
  onSelect: () => void;
  /** The button does nothing; give `disabledReason` so people know why. */
  disabled?: boolean;
  /** Why the button is disabled: shown as its tooltip and linked with `aria-describedby`. */
  disabledReason?: string;
  /** Shows a spinner and blocks repeated presses while the host works. */
  busy?: boolean;
  /** `primary` for the main action. @defaultValue 'default' */
  variant?: 'primary' | 'default';
}

/** A segmented switch between a few values (for example two renditions of the same frames). */
export interface LeRobotToolbarToggle {
  /** Item type. */
  kind: 'toggle';
  /** Unique within its extension. */
  id: string;
  /** Accessible name of the group. */
  label: string;
  /** The values to choose from, in order. */
  options: Array<{ value: string; label: string }>;
  /** The chosen value. */
  value: string;
  /** Called with the value a person chooses. */
  onChange: (value: string) => void;
  /** No option can be chosen. */
  disabled?: boolean;
}

/** A link to a host page. */
export interface LeRobotToolbarLink {
  /** Item type. */
  kind: 'link';
  /** Unique within its extension. */
  id: string;
  /** Link text. */
  label: string;
  /** Link target. */
  href: string;
  /** Opens in a new tab with `rel="noopener noreferrer"` and an external icon. */
  external?: boolean;
}

/** One toolbar item. */
export type LeRobotToolbarItem = LeRobotToolbarButton | LeRobotToolbarToggle | LeRobotToolbarLink;

/** A status line the host shows inside the viewer (a running job, a refusal, a hint). */
export interface LeRobotNotice {
  /** Unique within its extension. */
  id: string;
  /** `error` notices are announced at once; others when the person pauses. */
  severity: 'info' | 'warn' | 'error';
  /** Notice text. */
  text: string;
  /** `'indeterminate'` or a fraction from 0 to 1. */
  progress?: 'indeterminate' | number;
  /** One action: a link (`href`) or a callback (`onSelect`). */
  action?: { label: string; href?: string; onSelect?: () => void };
}

/** One host's contributions; several extensions render in order. */
export interface LeRobotExtension {
  /** Unique among extensions. */
  id: string;
  /** Buttons, toggles and links, in order. */
  toolbar?: LeRobotToolbarItem[];
  /** Status lines, in order. */
  notices?: LeRobotNotice[];
}

/** Where to open: applied once, after the dataset loads. */
export interface LeRobotInitialSelection {
  /** Dataset `episode_index`; the segment's episode or the first episode when omitted. */
  episodeIndex?: number;
  /** Select this segment (and start at its first frame unless `timeS` is set). */
  segmentId?: string;
  /** Seconds from the episode start; the playhead lands on the frame that contains it. */
  timeS?: number;
}

/** What the person is looking at (reported once an episode is open). */
export interface LeRobotSelection {
  /** Dataset `episode_index` of the open episode. */
  episodeIndex: number | null;
  /** The selected segment, if any. */
  segmentId: string | null;
  /** Seconds from the episode start of the frame at the playhead. */
  timeS: number;
}

/** CSS values for the viewer's theme variables (any valid CSS value). */
export interface LeRobotThemeColors {
  /** `--primary`: buttons, the playhead, selection. */
  primary?: string;
  /** `--primary-foreground`: text on `primary`. */
  primaryForeground?: string;
  /** `--radius`: base corner radius, e.g. `0.5rem`. */
  radius?: string;
  /** `font-family` of the viewer root. */
  fontFamily?: string;
}

/**
 * Host design tokens, set on the viewer root. They apply in both color
 * schemes; `dark` overrides them while the viewer is dark (`theme`).
 */
export interface LeRobotThemeTokens extends LeRobotThemeColors {
  /** Values that replace the others while the viewer is dark. */
  dark?: LeRobotThemeColors;
}
