import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { catalogKeys, renderMessageKeys } from '../scripts/generate-message-keys.mjs';
import en from '../src/react/locales/en.json';
import internalMessages from '../src/react/i18n/internalMessages.json';
import { selectHostMessages } from '../src/react/i18n/hostMessages';
import { LEROBOT_MESSAGE_KEYS } from '../src/react/i18n/messageKeys';

const internal: Record<string, string> = internalMessages;
const replaceable = new Set<string>(LEROBOT_MESSAGE_KEYS);

describe('message keys a host may replace', () => {
  it('cover every message of the English catalog, or name it internal with a reason', () => {
    const keys = catalogKeys(en) as string[];
    expect(keys.length).toBeGreaterThan(700);
    const stragglers = keys.filter((key) => !replaceable.has(key) && !(key in internal));
    expect(stragglers).toEqual([]);
    const both = keys.filter((key) => replaceable.has(key) && key in internal);
    expect(both).toEqual([]);
    expect(LEROBOT_MESSAGE_KEYS.length + Object.keys(internal).length).toBe(keys.length);
  });

  it('list as internal only real catalog keys, each with its reason', () => {
    const keys = new Set(catalogKeys(en) as string[]);
    for (const [key, reason] of Object.entries(internal)) {
      expect(keys.has(key), key).toBe(true);
      expect(reason.trim().length, key).toBeGreaterThan(10);
    }
  });

  it('match the generated LeRobotMessageKey type (run `npm run i18n:keys` if this fails)', () => {
    const file = path.resolve(__dirname, '../src/react/i18n/messageKeys.generated.ts');
    expect(fs.readFileSync(file, 'utf8')).toBe(renderMessageKeys(en, internal));
  });

  it('include the copy outside segments that hosts rename (export, batch trim, sidebar)', () => {
    for (const key of [
      'segments.title',
      'export.title',
      'batchTrim.title',
      'sidebar.episodesCount',
      'panels.welcome.title',
    ]) {
      expect(replaceable.has(key), key).toBe(true);
    }
    const warn = vi.fn();
    expect(
      selectHostMessages({ 'export.title': 'Export takes', 'seo.title': 'Never shown' }, warn),
    ).toEqual({ 'export.title': 'Export takes' });
    expect(warn).toHaveBeenCalledWith(
      'lerobot-studio: messages["seo.title"] ignored: not a replaceable message key',
    );
  });
});
