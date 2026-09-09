import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  DEFAULT_UI_LOCALE,
  detectBrowserUiLocale,
  type UiLocale,
} from '../../../utils/locale-resolve.js';
import enUS from '../locales/en-US.json';
import ptBR from '../locales/pt-BR.json';

const UI_LOCALE_STORAGE_KEY = 'local-openfinance.ui-locale';

export function detectLocale(): UiLocale {
  try {
    const stored = globalThis.sessionStorage?.getItem(UI_LOCALE_STORAGE_KEY);
    if (stored === 'en-US' || stored === 'pt-BR') {
      return stored;
    }
  } catch {
    return detectBrowserUiLocale();
  }
  return detectBrowserUiLocale();
}

export function setUiLocale(locale: UiLocale): void {
  void i18n.changeLanguage(locale);
  try {
    globalThis.sessionStorage?.setItem(UI_LOCALE_STORAGE_KEY, locale);
  } catch {
    return;
  }
}

export async function initI18n(): Promise<void> {
  await i18n.use(initReactI18next).init({
    resources: {
      'en-US': { translation: enUS },
      'pt-BR': { translation: ptBR },
    },
    lng: detectLocale(),
    fallbackLng: DEFAULT_UI_LOCALE,
    interpolation: { escapeValue: false },
  });
}

export { i18n };
