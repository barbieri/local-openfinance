import process from 'node:process';
import { anthropic } from '@ai-sdk/anthropic';
import { gateway } from '@ai-sdk/gateway';
import { google } from '@ai-sdk/google';
import { createOpenAI, openai } from '@ai-sdk/openai';
import { xai } from '@ai-sdk/xai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { opencode } from 'ai-sdk-provider-opencode-sdk';
import { createOllama } from 'ollama-ai-provider-v2';
import type { ModelConfig } from './types.js';

export type ProviderFactory = (model: string) => LanguageModel;
export type EmbeddingProviderFactory = (model: string) => EmbeddingModel;

export type LlmConfig = Pick<ModelConfig, 'provider' | 'model' | 'baseUrl'>;

export type LlmProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'openrouter'
  | 'opencode'
  | 'openai-compatible'
  | 'gateway'
  | 'ollama';

type AiSdkProvider = {
  readonly languageModel: ProviderFactory;
  readonly embeddingModel?: EmbeddingProviderFactory | undefined;
};

const builtInFactories: Record<LlmProvider, (config: LlmConfig) => AiSdkProvider> = {
  openai: () => ({
    languageModel: (model) => openai(model),
    embeddingModel: (model) => openai.embeddingModel(model),
  }),
  anthropic: () => ({
    languageModel: (model) => anthropic(model),
  }),
  google: () => ({
    languageModel: (model) => google(model),
    embeddingModel: (model) => google.embeddingModel(model),
  }),
  xai: () => ({
    languageModel: (model) => xai(model),
  }),
  openrouter: () => ({
    languageModel: (model) => openrouter(model),
    embeddingModel: (model) => openrouter.textEmbeddingModel(model),
  }),
  opencode: () => ({
    languageModel: (model) => opencode(model),
  }),
  'openai-compatible': (config) => {
    const provider = createOpenAI(config.baseUrl ? { baseURL: config.baseUrl } : undefined);
    return {
      languageModel: (model) => provider(model),
      embeddingModel: (model) => provider.embeddingModel(model),
    };
  },
  gateway: () => ({
    languageModel: (model) => gateway(model as Parameters<typeof gateway>[0]),
    embeddingModel: (model) =>
      gateway.embeddingModel(model as Parameters<typeof gateway.embeddingModel>[0]),
  }),
  ollama: (config) => {
    const provider = createOllama({ baseURL: ollamaBaseUrl(config) });
    return {
      languageModel: (model) => provider.completion(model),
      embeddingModel: (model) => provider.textEmbeddingModel(model),
    };
  },
};

export function createLanguageModel(llm: LlmConfig): LanguageModel {
  return createProvider(llm).languageModel(llm.model);
}

export function createEmbeddingModel(config: LlmConfig): EmbeddingModel {
  const provider = createProvider(config);
  if (!provider.embeddingModel) {
    throw new Error(`Provider "${config.provider}" does not support embeddings through AI SDK`);
  }

  return provider.embeddingModel(config.model);
}

export function supportedProviderIds(): readonly string[] {
  return Object.keys(builtInFactories);
}

export function providerSupportsEmbeddings(providerId: string): boolean {
  const builtIn = builtInFactories[providerId as LlmProvider];
  if (!builtIn) {
    return false;
  }
  return builtIn({ provider: providerId, model: '' }).embeddingModel !== undefined;
}

function createProvider(config: LlmConfig): AiSdkProvider {
  const builtIn = builtInFactories[config.provider as LlmProvider];
  if (!builtIn) {
    throw new Error(
      `Unknown AI SDK provider "${config.provider}". Built-in: ${supportedProviderIds().join(', ')}`,
    );
  }

  return builtIn(config);
}

function ollamaBaseUrl(config: Pick<LlmConfig, 'baseUrl'>): string {
  const env: { readonly OLLAMA_URL?: string | undefined } = process.env;
  const baseUrl = config.baseUrl ?? env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
}
