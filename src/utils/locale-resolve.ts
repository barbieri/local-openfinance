export const DEFAULT_UI_LOCALE = 'en-US' as const;
export const DEFAULT_CONTENT_LOCALE = 'en' as const;

export const SUPPORTED_UI_LOCALES = ['en-US', 'pt-BR'] as const;
export type UiLocale = (typeof SUPPORTED_UI_LOCALES)[number];

export const SUPPORTED_CONTENT_LOCALES = ['en', 'pt'] as const;
export type ContentLocale = (typeof SUPPORTED_CONTENT_LOCALES)[number];

export function normalizeLocaleLanguage(locale: string | undefined | null): string | null {
  const trimmed = locale?.trim();
  if (!trimmed) {
    return null;
  }
  const primary = trimmed.split(/[-_]/)[0]?.toLowerCase();
  return primary && primary.length > 0 ? primary : null;
}

export function resolveContentLocale(locale?: string | null): ContentLocale {
  const language = normalizeLocaleLanguage(locale);
  if (language === 'pt') {
    return 'pt';
  }
  return DEFAULT_CONTENT_LOCALE;
}

export function resolveUiLocale(locale?: string | null): UiLocale {
  const trimmed = locale?.trim();
  if (!trimmed) {
    return DEFAULT_UI_LOCALE;
  }

  const normalizedTag = trimmed.replaceAll('_', '-').toLowerCase();
  if (normalizedTag === 'pt-br' || normalizedTag === 'pt') {
    return 'pt-BR';
  }
  if (normalizedTag === 'en-us' || normalizedTag === 'en') {
    return 'en-US';
  }

  return resolveContentLocale(trimmed) === 'pt' ? 'pt-BR' : DEFAULT_UI_LOCALE;
}

export function detectBrowserUiLocale(): UiLocale {
  if (typeof navigator === 'undefined') {
    return DEFAULT_UI_LOCALE;
  }
  return resolveUiLocale(navigator.language);
}

/**
 * Prefer upstream translated category/MCC fields when true.
 * Omitted locale keeps legacy CLI behavior (translate when available).
 */
export function resolveCategoryTranslationEnabled(locale?: string): boolean {
  if (!locale?.trim()) {
    return true;
  }
  return resolveContentLocale(locale) === 'pt';
}

export function parseRequestLocale(value: string | undefined): UiLocale {
  return resolveUiLocale(value);
}
