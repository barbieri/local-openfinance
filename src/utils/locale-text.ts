import enUS from '../locales/en-US.json' with { type: 'json' };
import ptBR from '../locales/pt-BR.json' with { type: 'json' };

export type LocaleTextKey = keyof typeof enUS;

type SupportedLocale = 'en-US' | 'pt-BR';

const catalogs: Readonly<Record<SupportedLocale, Readonly<Record<LocaleTextKey, string>>>> = {
  'en-US': enUS,
  'pt-BR': ptBR,
};

export function localText(language: string, key: LocaleTextKey): string {
  const locale: SupportedLocale = language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US';
  return catalogs[locale][key];
}
