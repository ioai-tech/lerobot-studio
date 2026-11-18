import enRaw from '../locales/en.json';

export type SupportedLocale = 'en' | 'zh' | 'ja';
export type MessageMap = Record<string, string>;

const SUPPORTED_LOCALES: SupportedLocale[] = ['en', 'zh', 'ja'];
const STORAGE_KEY = 'lerobot.language';
const LEGACY_STORAGE_KEY = 'i18nextLng';

const ICU_PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function normalizeLocale(value?: string | null): SupportedLocale {
  if (!value) return 'en';
  const lower = value.toLowerCase();
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('ja')) return 'ja';
  if (lower.startsWith('en')) return 'en';
  return 'en';
}

function flattenMessages(input: Record<string, unknown>, parentKey = ''): MessageMap {
  const result: MessageMap = {};
  for (const [key, value] of Object.entries(input)) {
    const nextKey = parentKey ? `${parentKey}.${key}` : key;
    if (typeof value === 'string') {
      result[nextKey] = value.replace(ICU_PLACEHOLDER_RE, '{$1}');
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenMessages(value as Record<string, unknown>, nextKey));
    }
  }
  return result;
}

export function detectInitialLocale(): SupportedLocale {
  if (typeof window === 'undefined') return 'en';
  const langQuery = new URLSearchParams(window.location.search).get('lang');
  if (langQuery) return normalizeLocale(langQuery);
  const stored =
    window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
  return normalizeLocale(stored ?? window.navigator.language);
}

export function persistLocale(locale: SupportedLocale) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, locale);
  // 兼容历史 key，保证已有逻辑读取一致。
  window.localStorage.setItem(LEGACY_STORAGE_KEY, locale);
}

export function isSupportedLocale(value: string): value is SupportedLocale {
  return SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

export function coerceLocale(value?: string | null): SupportedLocale {
  return normalizeLocale(value);
}

const enMessages = flattenMessages(enRaw as Record<string, unknown>);

/**
 * English ships with the viewer (it is every locale's fallback); the other
 * locales are separate chunks, loaded when they become the active language.
 */
const LOCALE_LOADERS: Record<
  Exclude<SupportedLocale, 'en'>,
  () => Promise<{ default: unknown }>
> = {
  zh: () => import('../locales/zh.json'),
  ja: () => import('../locales/ja.json'),
};

const loadedMessages = new Map<SupportedLocale, MessageMap>([['en', enMessages]]);
const pendingMessages = new Map<SupportedLocale, Promise<MessageMap>>();

/** Messages of `locale` when already loaded (English always is), else null. */
export function getLoadedMessages(locale: SupportedLocale): MessageMap | null {
  return loadedMessages.get(locale) ?? null;
}

/** Load the messages of `locale` (English fallback included); loads once. */
export function loadMessages(locale: SupportedLocale): Promise<MessageMap> {
  const loaded = loadedMessages.get(locale);
  if (loaded) return Promise.resolve(loaded);
  let pending = pendingMessages.get(locale);
  if (!pending) {
    pending = LOCALE_LOADERS[locale as Exclude<SupportedLocale, 'en'>]()
      .then((module) => {
        const messages = {
          ...enMessages,
          ...flattenMessages(module.default as Record<string, unknown>),
        };
        loadedMessages.set(locale, messages);
        return messages;
      })
      .finally(() => pendingMessages.delete(locale));
    pendingMessages.set(locale, pending);
  }
  return pending;
}
