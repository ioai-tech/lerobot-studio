import zhRaw from '../locales/zh.json';
import enRaw from '../locales/en.json';
import jaRaw from '../locales/ja.json';

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
const zhMessages = flattenMessages(zhRaw as Record<string, unknown>);
const jaMessages = flattenMessages(jaRaw as Record<string, unknown>);

export const messagesByLocale: Record<SupportedLocale, MessageMap> = {
  en: enMessages,
  zh: {
    ...enMessages,
    ...zhMessages,
  },
  ja: {
    ...enMessages,
    ...jaMessages,
  },
};
