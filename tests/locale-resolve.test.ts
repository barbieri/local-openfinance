import { describe, expect, it } from 'vitest';
import {
  detectBrowserUiLocale,
  normalizeLocaleLanguage,
  parseRequestLocale,
  resolveCategoryTranslationEnabled,
  resolveContentLocale,
  resolveUiLocale,
} from '../src/utils/locale-resolve.js';

describe('locale-resolve', () => {
  it('normalizes BCP-47 tags to a primary language subtag', () => {
    expect(normalizeLocaleLanguage('pt-BR')).toBe('pt');
    expect(normalizeLocaleLanguage('en-US')).toBe('en');
    expect(normalizeLocaleLanguage('PT_br')).toBe('pt');
    expect(normalizeLocaleLanguage('  ')).toBeNull();
  });

  it('resolves content locales with fallback to English', () => {
    expect(resolveContentLocale('pt-BR')).toBe('pt');
    expect(resolveContentLocale('pt')).toBe('pt');
    expect(resolveContentLocale('en-US')).toBe('en');
    expect(resolveContentLocale('fr-FR')).toBe('en');
    expect(resolveContentLocale(undefined)).toBe('en');
  });

  it('resolves UI locales used by the web app', () => {
    expect(resolveUiLocale('pt-BR')).toBe('pt-BR');
    expect(resolveUiLocale('pt-br')).toBe('pt-BR');
    expect(resolveUiLocale('pt')).toBe('pt-BR');
    expect(resolveUiLocale('en-US')).toBe('en-US');
    expect(resolveUiLocale('en')).toBe('en-US');
    expect(resolveUiLocale('fr')).toBe('en-US');
    expect(resolveUiLocale(undefined)).toBe('en-US');
  });

  it('parses API locale query values', () => {
    expect(parseRequestLocale('pt-BR')).toBe('pt-BR');
    expect(parseRequestLocale(undefined)).toBe('en-US');
  });

  it('enables category translation only for Portuguese content locales', () => {
    expect(resolveCategoryTranslationEnabled(undefined)).toBe(true);
    expect(resolveCategoryTranslationEnabled('pt-BR')).toBe(true);
    expect(resolveCategoryTranslationEnabled('pt')).toBe(true);
    expect(resolveCategoryTranslationEnabled('en-US')).toBe(false);
    expect(resolveCategoryTranslationEnabled('en')).toBe(false);
  });

  it('detects browser UI locale through the same resolver', () => {
    expect(typeof detectBrowserUiLocale()).toBe('string');
  });
});
