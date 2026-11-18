// Writes the type of the message keys a host may replace: every key of the
// English catalog (the one owner of the keys) except the internal ones in
// src/react/i18n/internalMessages.json. Run after changing either file:
//   npm run i18n:keys
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'src/react/locales/en.json');
const internalPath = path.join(root, 'src/react/i18n/internalMessages.json');
const outputPath = path.join(root, 'src/react/i18n/messageKeys.generated.ts');

/** Dotted keys of a nested catalog, in catalog order. */
export function catalogKeys(catalog, parent = '') {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const dotted = parent ? `${parent}.${key}` : key;
    if (typeof value === 'string') return [dotted];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return catalogKeys(value, dotted);
    }
    return [];
  });
}

export function renderMessageKeys(catalog, internal) {
  const lines = catalogKeys(catalog)
    .filter((key) => !Object.hasOwn(internal, key))
    .map((key) => `  | '${key}'`);
  return [
    '// Generated from src/react/locales/en.json and src/react/i18n/internalMessages.json',
    '// by scripts/generate-message-keys.mjs. Do not edit: run `npm run i18n:keys`.',
    '',
    '/** A built-in message a host may replace (see `LEROBOT_MESSAGE_KEYS`). */',
    'export type LeRobotMessageKey =',
    `${lines.join('\n')};`,
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const internal = JSON.parse(fs.readFileSync(internalPath, 'utf8'));
  fs.writeFileSync(outputPath, renderMessageKeys(catalog, internal));
  console.log(`Wrote ${path.relative(root, outputPath)}`);
}
