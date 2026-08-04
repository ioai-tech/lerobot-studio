import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { IntlProvider, useIntl } from 'react-intl';
import {
  coerceLocale,
  detectInitialLocale,
  messagesByLocale,
  persistLocale,
  type SupportedLocale,
} from './messages';

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
}: {
  children: React.ReactNode;
  forcedLanguage?: string;
}) {
  const [locale, setLocaleState] = useState<SupportedLocale>(() =>
    coerceLocale(forcedLanguage ?? detectInitialLocale()),
  );

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

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale }), [locale, setLocale]);

  return (
    <I18nContext.Provider value={value}>
      <IntlProvider locale={locale} messages={messagesByLocale[locale]} onError={reportIntlError}>
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
