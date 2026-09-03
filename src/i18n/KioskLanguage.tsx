import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import enTranslations from './locales/en.json';
import trTranslations from './locales/tr.json';

export const SUPPORTED_LANGUAGES = ['tr', 'en'] as const;
export type KioskLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export type TranslationParams = Record<string, string | number>;
export type TranslationKey = keyof typeof trTranslations;

const translations = { tr: trTranslations, en: enTranslations } as const;
const replaceParams = (value: string, params?: TranslationParams) => value.replace(
  /\{(\w+)\}/g,
  (match, key: string) => params?.[key] === undefined ? match : String(params[key]),
);

type KioskLanguageContextValue = {
  language: KioskLanguage;
  locale: 'tr-TR' | 'en-US';
  setLanguage: (language: KioskLanguage) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
};

const KioskLanguageContext = createContext<KioskLanguageContextValue | null>(null);

export function KioskLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<KioskLanguage>('tr');
  const setLanguage = useCallback((nextLanguage: KioskLanguage) => {
    if (!SUPPORTED_LANGUAGES.includes(nextLanguage)) return;
    setLanguageState(nextLanguage);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<KioskLanguageContextValue>(() => ({
    language,
    locale: language === 'tr' ? 'tr-TR' : 'en-US',
    setLanguage,
    t: (key, params) => replaceParams(translations[language][key], params),
  }), [language, setLanguage]);

  return <KioskLanguageContext.Provider value={value}>{children}</KioskLanguageContext.Provider>;
}

export function useKioskLanguage() {
  const context = useContext(KioskLanguageContext);
  if (!context) throw new Error('useKioskLanguage must be used inside KioskLanguageProvider');
  return context;
}
