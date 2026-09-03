export type RuntimeKioskLanguage = 'tr' | 'en';

let translationEnabled = false;

export const setKioskRuntimeTranslationEnabled = (enabled: boolean) => {
  translationEnabled = enabled;
};

export const setKioskRuntimeLanguage = (language: RuntimeKioskLanguage) => {
  document.documentElement.dataset.kioskLanguage = language;
};

export const shouldTranslateKioskRuntime = () => translationEnabled
  && document.documentElement.dataset.kioskLanguage === 'en';
