import { describe, expect, it } from 'vitest';
import { modelCallOptions, modelSupportsTemperature } from '../src/llm/generate.js';

describe('analysis model options', () => {
  it('omits temperature for OpenAI reasoning model families', () => {
    expect(
      modelSupportsTemperature({
        provider: 'openai-compatible',
        model: 'gpt-5.4-mini',
      }),
    ).toBe(false);
    expect(
      modelSupportsTemperature({
        provider: 'openai',
        model: 'o4-mini',
      }),
    ).toBe(false);
  });

  it('keeps temperature for non-reasoning model families', () => {
    expect(
      modelSupportsTemperature({
        provider: 'openai',
        model: 'gpt-4.1-mini',
      }),
    ).toBe(true);
    expect(
      modelSupportsTemperature({
        provider: 'anthropic',
        model: 'claude-test',
      }),
    ).toBe(true);
  });

  it('maps OpenAI reasoning effort at the provider boundary', () => {
    expect(
      modelCallOptions({
        provider: 'openai',
        model: 'gpt-5.6-luna',
        maxOutputTokens: 8_000,
        reasoningEffort: 'low',
      }),
    ).toEqual({
      maxOutputTokens: 8_000,
      providerOptions: { openai: { reasoningEffort: 'low' } },
    });
  });
});
