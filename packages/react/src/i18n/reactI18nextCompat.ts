import { useTranslationBridge } from './core';

type TranslationValues = Record<string, unknown>;

export type CompatTFunction = (
  key: string,
  defaultMessageOrValues?: string | TranslationValues,
  valuesArg?: TranslationValues,
) => string;

export interface CompatTranslationResult {
  t: CompatTFunction;
  i18n: {
    language: string;
    changeLanguage: (locale: string) => Promise<void>;
  };
}

export function useTranslation(): CompatTranslationResult {
  const { t, i18n } = useTranslationBridge();
  return { t, i18n };
}
