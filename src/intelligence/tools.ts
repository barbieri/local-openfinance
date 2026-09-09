import type { DatabaseSync } from 'node:sqlite';
import { buildAnnotationLabelIndex } from '../db/annotation-labels.js';
import { intelligenceMemorySeed, readIntelligenceMemory } from '../db/intelligence.js';
import type { ResolvedConfig } from '../types.js';
import { HOLDING_INTELLIGENCE_TOOLS } from './holding-tools.js';
import { IntelligenceToolError } from './intelligence-tool-error.js';
import type { LocalDatePeriod } from './period.js';
import { buildReportPeriodHref } from './report-analysis.js';
import { buildReportBriefing, resolveReportQueryScope } from './report-scope.js';
import { buildReportCategoryIndex } from './report-taxonomy.js';
import {
  defineIntelligenceTool,
  optionalEnum,
  parseNoArguments,
  readToolArguments,
  requireAllowedArguments,
  requireString,
  type ScopedIntelligenceToolContext,
} from './tool-contract.js';
import { TRANSACTION_INTELLIGENCE_TOOLS } from './transaction-tools.js';

const MAX_MEMORY_CHARS = 50_000;

const GENERAL_INTELLIGENCE_TOOLS = {
  briefing: defineIntelligenceTool({
    description:
      'Load the bounded deterministic report packet with differences, candidate findings, taxonomy profiles, exclusions, chart periods, and net worth.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    parse: parseNoArguments,
    execute: ({ db, resolved, scope, briefing }) => {
      const value = briefing ?? buildReportBriefing(db, resolved, scope);
      return { period: value.period, analysis: value.analysis, netWorth: value.netWorth };
    },
  }),
  memory: defineIntelligenceTool({
    description: 'Load the durable markdown memory for this report only.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    parse: parseNoArguments,
    execute: ({ db, scope }) => {
      const memory = readIntelligenceMemory(
        db,
        scope.report.id,
        intelligenceMemorySeed(scope.report.language),
      );
      return {
        ...memory,
        markdown: memory.markdown.slice(0, MAX_MEMORY_CHARS),
        truncated: memory.markdown.length > MAX_MEMORY_CHARS,
      };
    },
  }),
  report_link: defineIntelligenceTool({
    description:
      'Build a Transactions page link for one category or label inside this report period. Use it when citing an aggregate period claim.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'id'],
      properties: {
        kind: { type: 'string', enum: ['category', 'label'] },
        id: { type: 'string', minLength: 1 },
      },
    },
    parse: (input) => {
      const args = readToolArguments(input);
      requireAllowedArguments(args, ['kind', 'id']);
      return {
        kind: optionalEnum(args, 'kind', ['category', 'label'] as const, 'category'),
        id: requireString(args, 'id'),
      };
    },
    execute: ({ db, resolved, scope }, input) => {
      const exists =
        input.kind === 'category'
          ? buildReportCategoryIndex(db).has(input.id)
          : buildAnnotationLabelIndex(db).has(input.id);
      if (!exists) throw new IntelligenceToolError(`${input.kind} not found`);
      return {
        href: buildReportPeriodHref({
          publicBaseUrl: resolved.config.web.publicBaseUrl,
          period: scope.period,
          kind: input.kind,
          id: input.id,
        }),
      };
    },
  }),
} as const;

export const INTELLIGENCE_TOOLS = {
  ...GENERAL_INTELLIGENCE_TOOLS,
  ...TRANSACTION_INTELLIGENCE_TOOLS,
  ...HOLDING_INTELLIGENCE_TOOLS,
} as const;

export type IntelligenceToolName = keyof typeof INTELLIGENCE_TOOLS;

export type IntelligenceToolContext = {
  readonly db: DatabaseSync;
  readonly resolved: ResolvedConfig;
  readonly now?: Date | undefined;
  readonly timeZone?: string | undefined;
  readonly period?: LocalDatePeriod | undefined;
};

export { IntelligenceToolError };

export function isIntelligenceToolName(name: string): name is IntelligenceToolName {
  return Object.hasOwn(INTELLIGENCE_TOOLS, name);
}

export function executeIntelligenceTool(
  context: IntelligenceToolContext,
  reportId: string,
  name: IntelligenceToolName,
  input: unknown,
): unknown {
  const scope = resolveReportQueryScope(context.resolved, reportId, context);
  return {
    reportId,
    period: scope.period,
    result: executeScopedIntelligenceTool(
      { db: context.db, resolved: context.resolved, scope },
      name,
      input,
    ),
  };
}

export function executeScopedIntelligenceTool(
  context: ScopedIntelligenceToolContext,
  name: IntelligenceToolName,
  input: unknown,
): unknown {
  const needsBriefing = Object.hasOwn(TRANSACTION_INTELLIGENCE_TOOLS, name);
  const resolvedContext =
    needsBriefing && !context.briefing
      ? { ...context, briefing: buildReportBriefing(context.db, context.resolved, context.scope) }
      : context;
  return INTELLIGENCE_TOOLS[name].execute(resolvedContext, input);
}
