import internalMessages from './internalMessages.json';
import type { LeRobotMessageKey } from './messageKeys.generated';
import { getLoadedMessages } from './messages';

export type { LeRobotMessageKey } from './messageKeys.generated';

/**
 * Built-in messages a host may replace through `messages` (for example to
 * call segments "Episodes"): every message an embedded viewer can show, in
 * every area (segments, sidebar, panels, charts, export, batch trim, health,
 * dialogs…). Only copy that the standalone app alone shows is not listed.
 * Values are ICU messages in the viewer's current language; `{{name}}`
 * placeholders are accepted too.
 */
export const LEROBOT_MESSAGE_KEYS: readonly LeRobotMessageKey[] = Object.freeze(
  Object.keys(getLoadedMessages('en') ?? {}).filter(
    (key) => !Object.hasOwn(internalMessages, key),
  ) as LeRobotMessageKey[],
);

/** Host copy keyed by built-in message key. */
export type LeRobotMessages = Partial<Record<LeRobotMessageKey, string>>;
