import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { IntlProvider, useIntl } from 'react-intl';
import {
  coerceLocale,
  detectInitialLocale,
  getLoadedMessages,
  loadMessages,
  persistLocale,
  type MessageMap,
  type SupportedLocale,
} from './messages';
import { LEROBOT_MESSAGE_KEYS } from './messageKeys';

/** Only the documented keys can be replaced; internal copy is not API. */
const HOST_MESSAGE_KEYS: ReadonlySet<string> = new Set(LEROBOT_MESSAGE_KEYS);

type TranslationValues = Record<string, unknown>;
type TFunction = (
  key: string,
  defaultMessageOrValues?: string | TranslationValues,
  valuesArg?: TranslationValues,
) => string;

interface I18nContextValue {
  locale: SupportedLocale;
  setLocale: (locale: string) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function reportIntlError(error: unknown, isDevelopment = import.meta.env.DEV) {
  if (isDevelopment) {
    console.error('[i18n] react-intl formatting error:', error);
  }
}

function TranslateBridge({ children }: { children: React.ReactNode }) {
  const intl = useIntl();
  const { locale, setLocale } = useI18nController();

  const t = useCallback<TFunction>(
    (key, defaultMessageOrValues, valuesArg) => {
      const defaultMessage =
        typeof defaultMessageOrValues === 'string' ? defaultMessageOrValues : undefined;
      const values =
        (typeof defaultMessageOrValues === 'string' ? valuesArg : defaultMessageOrValues) ??
        undefined;
      return intl.formatMessage(
        { id: key, defaultMessage },
        values as Record<string, string | number | boolean | null | undefined> | undefined,
      );
    },
    [intl],
  );

  const i18n = useMemo(
    () => ({
      language: locale,
      changeLanguage: async (nextLocale: string) => {
        setLocale(nextLocale);
      },
    }),
    [locale, setLocale],
  );

  const value = useMemo(() => ({ t, i18n }), [t, i18n]);

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

interface TranslationContextValue {
  t: TFunction;
  i18n: {
    language: SupportedLocale;
    changeLanguage: (locale: string) => Promise<void>;
  };
}

const TranslationContext = createContext<TranslationContextValue | null>(null);

export function I18nProvider({
  children,
  forcedLanguage,
  messages,
}: {
  children: React.ReactNode;
  forcedLanguage?: string;
  /** Host copy that replaces built-in messages (already in the current language). */
  messages?: Partial<Record<string, string>>;
}) {
  const [locale, setLocaleState] = useState<SupportedLocale>(() =>
    coerceLocale(forcedLanguage ?? detectInitialLocale()),
  );
  // Messages of the shown locale. A locale that is not loaded yet keeps the
  // previous messages until its chunk arrives (on first render: nothing is
  // shown for that moment, rather than English that then changes).
  const [shown, setShown] = useState<{ locale: SupportedLocale; messages: MessageMap } | null>(
    () => {
      const messages = getLoadedMessages(locale);
      return messages ? { locale, messages } : null;
    },
  );
  useEffect(() => {
    if (shown?.locale === locale) return;
    let cancelled = false;
    loadMessages(locale).then(
      (messages) => {
        if (!cancelled) setShown({ locale, messages });
      },
      (error) => {
        console.error(`[i18n] could not load the ${locale} messages`, error);
        if (!cancelled) setShown({ locale, messages: getLoadedMessages('en')! });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [locale, shown?.locale]);

  const setLocale = useCallback((nextLocaleRaw: string) => {
    const nextLocale = coerceLocale(nextLocaleRaw);
    persistLocale(nextLocale);
    setLocaleState(nextLocale);
  }, []);

  useEffect(() => {
    if (!forcedLanguage) return;
    const nextLocale = coerceLocale(forcedLanguage);
    if (nextLocale !== locale) {
      setLocale(nextLocale);
    }
  }, [forcedLanguage, locale, setLocale]);

  const shownLocale = shown?.locale ?? locale;
  const value = useMemo<I18nContextValue>(
    () => ({ locale: shownLocale, setLocale }),
    [shownLocale, setLocale],
  );
  const localeMessages = useMemo(() => {
    const base = shown?.messages ?? {};
    if (!messages) return base;
    const overrides = Object.fromEntries(
      Object.entries(messages)
        .filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string' && HOST_MESSAGE_KEYS.has(entry[0]),
        )
        .map(([key, text]) => [key, text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, '{$1}')]),
    );
    return { ...base, ...overrides };
  }, [shown?.messages, messages]);

  if (!shown) return null;

  return (
    <I18nContext.Provider value={value}>
      <IntlProvider locale={shownLocale} messages={localeMessages} onError={reportIntlError}>
        <TranslateBridge>{children}</TranslateBridge>
      </IntlProvider>
    </I18nContext.Provider>
  );
}

export function useI18nController() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18nController must be used within I18nProvider');
  }
  return context;
}

export function useTranslationBridge() {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error('useTranslationBridge must be used within I18nProvider');
  }
  return context;
}
