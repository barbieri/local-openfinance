import type { DatabaseSync } from 'node:sqlite';
import {
  jsonSchema,
  type LanguageModel,
  Output,
  stepCountIs,
  ToolLoopAgent,
  type ToolSet,
  tool,
} from 'ai';
import {
  modelCallOptions,
  modelSupportsTemperature,
  normalizeModelUsage,
} from '../llm/generate.js';
import { createLanguageModel } from '../providers.js';
import type { ReportAgentBudget, ResolvedConfig } from '../types.js';
import {
  compactReportMemoryMarkdown,
  parseReportGenerationOutput,
  REPORT_GENERATION_OUTPUT_SCHEMA,
  reportHtmlToText,
  sanitizeReportBodyHtml,
} from './report-document.js';
import {
  buildAnalystInstructions,
  buildReportPrompt,
  buildReviewerInstructions,
  buildReviewPrompt,
} from './report-prompts.js';
import { buildReportBriefing, type ReportBriefing, type ReportQueryScope } from './report-scope.js';
import type { ScopedIntelligenceToolContext } from './tool-contract.js';
import { INTELLIGENCE_TOOLS } from './tools.js';
import type { ReportModelCall } from './usage.js';

const REQUIRE_BRIEFING_FIRST = {
  activeTools: ['briefing'],
  toolChoice: { type: 'tool' as const, toolName: 'briefing' },
};

export function maximumReportProviderCalls(budget: ReportAgentBudget): number {
  return 1 + budget.analystMaxSteps + budget.reviewerMaxSteps * budget.reviewerRounds;
}

export type GeneratedReport = {
  readonly subject: string;
  readonly markdown: string;
  readonly html: string;
  readonly memoryAfter: string;
  readonly modelCalls: readonly ReportModelCall[];
};

export type ReportAgentDependencies = {
  readonly resolveModel: (scope: ReportQueryScope) => LanguageModel;
};

export type GenerateReportWithAgent = (input: {
  readonly db: DatabaseSync;
  readonly resolved: ResolvedConfig;
  readonly scope: ReportQueryScope;
  readonly instructions: string;
  readonly memoryBefore: string;
  readonly briefing: ReportBriefing;
}) => Promise<GeneratedReport>;

export function createReportAgent(dependencies: ReportAgentDependencies): GenerateReportWithAgent {
  return async ({ db, resolved, scope, instructions, memoryBefore, briefing }) => {
    const modelCalls: ReportModelCall[] = [];
    const model = dependencies.resolveModel(scope);
    const tools = buildIntelligenceAgentTools({ db, resolved, scope, briefing });
    const analyst = new ToolLoopAgent({
      model,
      instructions: buildAnalystInstructions(instructions),
      tools,
      output: Output.object({ schema: REPORT_GENERATION_OUTPUT_SCHEMA }),
      stopWhen: stepCountIs(scope.report.agentBudget.analystMaxSteps),
      prepareStep: ({ stepNumber }) => (stepNumber === 0 ? REQUIRE_BRIEFING_FIRST : {}),
      ...modelOptions(scope),
    });
    const analystResult = await analyst.generate({
      prompt: buildReportPrompt({ scope, instructions, memoryBefore }),
    });
    modelCalls.push(...collectAgentSteps(scope, 'analyst', null, analystResult.steps));
    const draft = parseReportGenerationOutput(analystResult.output);

    const reviewer = new ToolLoopAgent({
      model,
      instructions: buildReviewerInstructions(),
      tools,
      output: Output.object({ schema: REPORT_GENERATION_OUTPUT_SCHEMA }),
      stopWhen: stepCountIs(scope.report.agentBudget.reviewerMaxSteps),
      prepareStep: ({ stepNumber }) => (stepNumber === 0 ? REQUIRE_BRIEFING_FIRST : {}),
      ...modelOptions(scope),
    });
    let reviewedOutput = draft;
    for (let round = 1; round <= scope.report.agentBudget.reviewerRounds; round += 1) {
      const reviewerResult = await reviewer.generate({
        prompt: buildReviewPrompt({
          candidate: reviewedOutput,
          instructions,
          scope,
          round: round as 1 | 2,
        }),
      });
      modelCalls.push(...collectAgentSteps(scope, 'reviewer', round, reviewerResult.steps));
      reviewedOutput = parseReportGenerationOutput(reviewerResult.output);
    }

    const html = sanitizeReportBodyHtml(reviewedOutput.bodyHtml, resolved.config.web.publicBaseUrl);
    return {
      subject: reviewedOutput.subject,
      markdown: reportHtmlToText(html),
      html,
      memoryAfter: compactReportMemoryMarkdown(
        reviewedOutput.memoryMarkdown,
        scope.report.language,
      ),
      modelCalls,
    };
  };
}

function collectAgentSteps(
  scope: ReportQueryScope,
  phase: Extract<ReportModelCall['phase'], 'analyst' | 'reviewer'>,
  reviewRound: number | null,
  steps: readonly {
    readonly stepNumber: number;
    readonly model: { readonly provider: string; readonly modelId: string };
    readonly usage?: import('../llm/generate.js').ModelUsage | undefined;
    readonly performance?: { readonly stepTimeMs?: number | undefined } | undefined;
    readonly finishReason?: { readonly unified?: string | undefined } | string | undefined;
    readonly toolCalls?: readonly { readonly toolName: string }[] | undefined;
    readonly providerMetadata?: unknown;
  }[],
): readonly ReportModelCall[] {
  return steps.map((step) => ({
    provider: step.model.provider,
    model: step.model.modelId,
    phase,
    reviewRound,
    stepNumber: step.stepNumber,
    usage: normalizeModelUsage(step.usage),
    durationMs:
      step.performance?.stepTimeMs === undefined ? null : Math.round(step.performance.stepTimeMs),
    reasoningEffort: scope.report.model.reasoningEffort,
    maxOutputTokens: scope.report.model.maxOutputTokens,
    finishReason:
      typeof step.finishReason === 'string' ? step.finishReason : step.finishReason?.unified,
    toolNames: step.toolCalls?.map((call) => call.toolName) ?? [],
    providerMetadata: step.providerMetadata,
  }));
}

export const generateReportWithAgent = createReportAgent({
  resolveModel: (scope) => createLanguageModel(scope.report.model),
});

function modelOptions(scope: ReportQueryScope): {
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly providerOptions?: {
    readonly openai: {
      readonly reasoningEffort: NonNullable<ResolvedConfig['config']['model']['reasoningEffort']>;
    };
  };
} {
  const temperature = modelSupportsTemperature(scope.report.model)
    ? scope.report.model.temperature
    : undefined;
  return {
    ...(temperature === undefined ? {} : { temperature }),
    ...modelCallOptions(scope.report.model),
  };
}

export function buildIntelligenceAgentTools(context: ScopedIntelligenceToolContext): ToolSet {
  const resolvedContext = context.briefing
    ? context
    : { ...context, briefing: buildReportBriefing(context.db, context.resolved, context.scope) };
  return Object.fromEntries(
    Object.entries(INTELLIGENCE_TOOLS).map(([name, definition]) => {
      return [
        name,
        tool({
          description: definition.description,
          inputSchema: jsonSchema(definition.inputSchema),
          execute: async (input) => definition.execute(resolvedContext, input),
        }),
      ];
    }),
  );
}
