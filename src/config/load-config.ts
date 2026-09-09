import { readFile } from 'node:fs/promises';
import type { ErrorObject } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { FormatsPlugin } from 'ajv-formats';
import * as addFormatsModule from 'ajv-formats';
import configSchema from '../../schemas/config.schema.json' with { type: 'json' };
import { isDefaultPromptReference } from '../llm/default-prompts.js';
import type { AppConfig, ReportConfig, ResolvedAppConfig, ResolvedConfig } from '../types.js';
import { hashJson, parseJsonObject } from '../utils/json.js';
import { defaultDatabasePath, resolveFromConfig, topicIdFromConfigPath } from '../utils/paths.js';

export const DEFAULT_REPORT_AGENT_BUDGET = {
  analystMaxSteps: 8,
  reviewerMaxSteps: 4,
  reviewerRounds: 2,
} as const;

const ajv = new Ajv2020({ allErrors: true });
const addFormats = addFormatsModule.default as unknown as FormatsPlugin;
addFormats(ajv);

const validateConfig = ajv.compile(configSchema);

export const DEFAULT_SYNC = {
  forceBeforeFetch: false,
  forceUpsert: false,
  connections: [] as const,
  lookbackDays: 7,
  pageSize: 100,
} as const;

export const DEFAULT_ANNOTATION = {
  similarityThreshold: 0.82,
  pushCategoriesUpstream: false,
} as const;

export const DEFAULT_REPORT = {
  accountIds: [] as const,
  includeUnannotated: true,
} as const;

export const DEFAULT_INTELLIGENCE = {
  suggestionConfidenceThreshold: 0.82,
  minReportedItemAmountCents: 10_000,
  rareLookbackYears: 3,
} as const;

export const DEFAULT_SMTP = {
  port: 587,
  secure: false,
} as const;

const RESERVED_REPORT_IDS = new Set(['chat', 'memory', 'run', 'history']);
const DEFAULT_REPORT_LANGUAGE = 'pt-BR';

export class ConfigValidationError extends Error {
  readonly configPath: string;
  readonly validationErrors: readonly ErrorObject[];

  constructor(configPath: string, validationErrors: readonly ErrorObject[]) {
    super(`Invalid config ${configPath}: ${ajv.errorsText([...validationErrors])}`);
    this.name = 'ConfigValidationError';
    this.configPath = configPath;
    this.validationErrors = validationErrors;
  }
}

export async function loadConfig(configPath: string): Promise<ResolvedConfig> {
  const text = await readFile(configPath, 'utf8');
  const raw = parseJsonObject(text, configPath);
  const config = validateRawConfig(raw, configPath);

  return {
    config: resolveConfigPaths(config, configPath),
    configPath,
    configHash: hashJson(config),
    topicId: topicIdFromConfigPath(configPath),
  };
}

export function validateRawConfig(raw: Record<string, unknown>, configPath: string): AppConfig {
  if (!validateConfig(raw)) {
    throw new ConfigValidationError(configPath, [...(validateConfig.errors ?? [])]);
  }

  validateReportIds(raw as AppConfig, configPath);
  validateReasoningEffort(raw as AppConfig, configPath);

  return raw as AppConfig;
}

function validateReasoningEffort(config: AppConfig, configPath: string): void {
  const models = [
    config.model,
    config.chatModel,
    ...(config.reports ?? []).map((report) => report.model),
  ];
  if (models.some((model) => model?.reasoningEffort !== undefined && model.provider !== 'openai')) {
    throw new ConfigValidationError(configPath, [
      {
        instancePath: '',
        schemaPath: '#/$defs/analysisModel/properties/reasoningEffort',
        keyword: 'provider',
        params: {},
        message: 'reasoningEffort is valid only for provider openai',
      },
    ]);
  }
}

function resolveConfigPaths(config: AppConfig, configPath: string): ResolvedAppConfig {
  const { notify: _notify, ...configWithoutNotify } = config;
  return {
    ...configWithoutNotify,
    storage: {
      databasePath: config.storage?.databasePath
        ? resolveFromConfig(configPath, config.storage.databasePath)
        : defaultDatabasePath(configPath),
    },
    sync: {
      forceBeforeFetch: config.sync?.forceBeforeFetch ?? DEFAULT_SYNC.forceBeforeFetch,
      forceUpsert: config.sync?.forceUpsert ?? DEFAULT_SYNC.forceUpsert,
      connections: config.sync?.connections ?? DEFAULT_SYNC.connections,
      lookbackDays: config.sync?.lookbackDays ?? DEFAULT_SYNC.lookbackDays,
      pageSize: config.sync?.pageSize ?? DEFAULT_SYNC.pageSize,
    },
    annotation: {
      embedding: config.annotation?.embedding,
      classifier: config.annotation?.classifier,
      similarityThreshold:
        config.annotation?.similarityThreshold ?? DEFAULT_ANNOTATION.similarityThreshold,
      pushCategoriesUpstream:
        config.annotation?.pushCategoriesUpstream ?? DEFAULT_ANNOTATION.pushCategoriesUpstream,
    },
    report: {
      accountIds: config.report.accountIds ?? DEFAULT_REPORT.accountIds,
      includeUnannotated: config.report.includeUnannotated ?? DEFAULT_REPORT.includeUnannotated,
    },
    reports: (config.reports ?? []).map((report) => resolveReport(report, config, configPath)),
    web: {
      publicBaseUrl: config.web?.publicBaseUrl,
    },
    intelligence: resolveIntelligence(config.intelligence),
    chatModel: config.chatModel,
    notify: {
      smtp: resolveSmtp(config.notify?.smtp),
    },
  };
}

function resolveReport(
  report: ReportConfig,
  config: AppConfig,
  configPath: string,
): ResolvedAppConfig['reports'][number] {
  return {
    id: report.id,
    name: report.name,
    schedule: report.schedule,
    window: report.window,
    prompts: report.prompts.map((prompt) =>
      isDefaultPromptReference(prompt) ? prompt : resolveFromConfig(configPath, prompt),
    ),
    language: report.language ?? DEFAULT_REPORT_LANGUAGE,
    send: report.send ?? 'always',
    model: report.model ?? config.model,
    agentBudget: {
      analystMaxSteps:
        report.agentBudget?.analystMaxSteps ?? DEFAULT_REPORT_AGENT_BUDGET.analystMaxSteps,
      reviewerMaxSteps:
        report.agentBudget?.reviewerMaxSteps ?? DEFAULT_REPORT_AGENT_BUDGET.reviewerMaxSteps,
      reviewerRounds:
        report.agentBudget?.reviewerRounds ?? DEFAULT_REPORT_AGENT_BUDGET.reviewerRounds,
    },
    accountIds: report.accountIds ?? config.report.accountIds ?? DEFAULT_REPORT.accountIds,
    includeUnannotated:
      report.includeUnannotated ??
      config.report.includeUnannotated ??
      DEFAULT_REPORT.includeUnannotated,
  };
}

function validateReportIds(config: AppConfig, configPath: string): void {
  const ids = new Set<string>();
  for (const [index, report] of (config.reports ?? []).entries()) {
    if (RESERVED_REPORT_IDS.has(report.id)) {
      throw new ConfigValidationError(configPath, [
        {
          instancePath: `/reports/${index}/id`,
          schemaPath: '#/$defs/report/properties/id/not',
          keyword: 'not',
          params: {},
          message: 'must not use a reserved report route name',
        },
      ]);
    }
    if (ids.has(report.id)) {
      throw new ConfigValidationError(configPath, [
        {
          instancePath: `/reports/${index}/id`,
          schemaPath: '#/properties/reports/uniqueReportIds',
          keyword: 'uniqueReportIds',
          params: { id: report.id },
          message: 'must be unique',
        },
      ]);
    }
    ids.add(report.id);
  }
}

function resolveIntelligence(
  intelligence: AppConfig['intelligence'] | undefined,
): ResolvedAppConfig['intelligence'] {
  return {
    suggestionConfidenceThreshold:
      intelligence?.suggestionConfidenceThreshold ??
      DEFAULT_INTELLIGENCE.suggestionConfidenceThreshold,
    minReportedItemAmountCents:
      intelligence?.minReportedItemAmountCents ?? DEFAULT_INTELLIGENCE.minReportedItemAmountCents,
    rareLookbackYears: intelligence?.rareLookbackYears ?? DEFAULT_INTELLIGENCE.rareLookbackYears,
  };
}

function resolveSmtp(
  smtp: NonNullable<AppConfig['notify']>['smtp'] | undefined,
): ResolvedAppConfig['notify']['smtp'] {
  if (!smtp) {
    return undefined;
  }
  return {
    host: smtp.host,
    port: smtp.port ?? DEFAULT_SMTP.port,
    secure: smtp.secure ?? DEFAULT_SMTP.secure,
    from: smtp.from,
    to: typeof smtp.to === 'string' ? [smtp.to] : smtp.to,
    auth: smtp.auth,
  };
}
