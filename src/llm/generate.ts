import { generateText } from 'ai';
import { logger } from '../logger.js';
import { createLanguageModel } from '../providers.js';
import type { ModelConfig } from '../types.js';

export type ModelUsage = {
  readonly inputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly totalTokens?: number | undefined;
  readonly reasoningTokens?: number | undefined;
  readonly cachedInputTokens?: number | undefined;
  readonly inputTokenDetails?:
    | {
        readonly noCacheTokens?: number | undefined;
        readonly cacheReadTokens?: number | undefined;
        readonly cacheWriteTokens?: number | undefined;
      }
    | undefined;
  readonly outputTokenDetails?:
    | {
        readonly textTokens?: number | undefined;
        readonly reasoningTokens?: number | undefined;
      }
    | undefined;
  readonly raw?: unknown;
};

export type GenerateModelTextResult = {
  readonly text: string;
  readonly usage?: ModelUsage | undefined;
  readonly providerMetadata?: unknown;
};

export type GenerateModelText = (input: {
  readonly config: { readonly model: ModelConfig };
  readonly system: string;
  readonly prompt: string;
}) => Promise<GenerateModelTextResult>;

export const generateModelText: GenerateModelText = async ({ config, system, prompt }) => {
  const baseModel = createLanguageModel(config.model);
  const temperature = modelSupportsTemperature(config.model) ? config.model.temperature : undefined;
  if (config.model.temperature !== undefined && temperature === undefined) {
    logger.debug(
      {
        provider: config.model.provider,
        model: config.model.model,
        temperature: config.model.temperature,
      },
      'omitting temperature for reasoning model',
    );
  }

  const options = {
    model: baseModel,
    system,
    prompt,
    ...(temperature === undefined ? {} : { temperature }),
    ...modelCallOptions(config.model),
  };
  const result = await generateText(options);
  return {
    text: result.text,
    usage: normalizeModelUsage(result.totalUsage ?? result.usage),
    providerMetadata: result.providerMetadata,
  };
};

export function normalizeModelUsage(usage: ModelUsage | undefined): ModelUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return stripUndefined({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.reasoningTokens ?? usage.outputTokenDetails?.reasoningTokens,
    cachedInputTokens: usage.cachedInputTokens ?? usage.inputTokenDetails?.cacheReadTokens,
    inputTokenDetails: stripUndefined({
      noCacheTokens: usage.inputTokenDetails?.noCacheTokens,
      cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens,
      cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
    }),
    outputTokenDetails: stripUndefined({
      textTokens: usage.outputTokenDetails?.textTokens,
      reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
    }),
    raw: usage.raw,
  });
}

export function modelCallOptions(model: ModelConfig): {
  readonly maxOutputTokens?: number;
  readonly providerOptions?: {
    readonly openai: { readonly reasoningEffort: NonNullable<ModelConfig['reasoningEffort']> };
  };
} {
  return {
    ...(model.maxOutputTokens === undefined ? {} : { maxOutputTokens: model.maxOutputTokens }),
    ...(model.provider === 'openai' && model.reasoningEffort !== undefined
      ? { providerOptions: { openai: { reasoningEffort: model.reasoningEffort } } }
      : {}),
  };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as T;
}

export function modelSupportsTemperature(
  modelConfig: Pick<ModelConfig, 'model' | 'provider'>,
): boolean {
  return !isKnownReasoningModel(modelConfig);
}

function isKnownReasoningModel(modelConfig: Pick<ModelConfig, 'model' | 'provider'>): boolean {
  const provider = modelConfig.provider.toLowerCase();
  const model = modelConfig.model.toLowerCase();
  if (!['openai', 'openai-compatible', 'openrouter'].includes(provider)) {
    return false;
  }

  return /^(?:gpt-5(?:[.-]|$)|o\d+(?:[.-]|$))/.test(model);
}
