import { LEROBOT_MESSAGE_KEYS } from './messageKeys';

/** Only the documented keys can be replaced; internal copy is not API. */
const HOST_MESSAGE_KEYS: ReadonlySet<string> = new Set(LEROBOT_MESSAGE_KEYS);

/** Keys already warned about, so a re-render does not repeat the warning. */
const warned = new Set<string>();

function describe(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

/**
 * The host's `messages` overrides the viewer applies: documented keys with
 * an ICU string (`{{name}}` placeholders become `{name}`). Anything else
 * keeps the built-in copy, with one `console.warn` per key saying why
 * (an unknown key, or a value that is not a string, such as a precompiled
 * message array).
 */
export function selectHostMessages(
  messages: Readonly<Record<string, unknown>>,
  warn: (message: string) => void = (message) => console.warn(message),
): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(messages)) {
    if (value === undefined) continue; // not set
    if (!HOST_MESSAGE_KEYS.has(key)) {
      if (!warned.has(`unknown:${key}`)) {
        warned.add(`unknown:${key}`);
        warn(`lerobot-studio: messages["${key}"] ignored: not a replaceable message key`);
      }
      continue;
    }
    if (typeof value !== 'string') {
      if (!warned.has(`type:${key}`)) {
        warned.add(`type:${key}`);
        warn(
          `lerobot-studio: messages["${key}"] ignored: expected an ICU string, got ${describe(value)}`,
        );
      }
      continue;
    }
    overrides[key] = value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, '{$1}');
  }
  return overrides;
}
