import { describe, expect, it } from 'vitest';
import { providerSupportsEmbeddings, supportedProviderIds } from '../src/providers.js';

describe('providers', () => {
  it('lists built-in provider ids', () => {
    expect(supportedProviderIds()).toContain('openai');
    expect(supportedProviderIds()).toContain('ollama');
  });

  it('marks embedding capability per provider', () => {
    expect(providerSupportsEmbeddings('openai')).toBe(true);
    expect(providerSupportsEmbeddings('anthropic')).toBe(false);
    expect(providerSupportsEmbeddings('ollama')).toBe(true);
  });
});
