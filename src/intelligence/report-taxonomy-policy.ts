import type { DatabaseSync } from 'node:sqlite';
import { generateObject } from 'ai';
import { z } from 'zod';
import { buildAnnotationLabelIndex } from '../db/annotation-labels.js';
import {
  readIntelligenceTaxonomyPolicy,
  saveIntelligenceTaxonomyPolicy,
} from '../db/intelligence.js';
import { type ModelUsage, modelCallOptions, normalizeModelUsage } from '../llm/generate.js';
import { createLanguageModel } from '../providers.js';
import { hashJson } from '../utils/json.js';
import { resolveCategoryTranslationEnabled } from '../utils/locale-resolve.js';
import type { ReportQueryScope } from './report-scope.js';
import {
  buildReportCategoryIndex,
  type ReportTaxonomy,
  type ReportTaxonomyKind,
} from './report-taxonomy.js';

export type TaxonomyTreatment =
  | 'internal-own-account'
  | 'portfolio-movement'
  | 'account-settlement'
  | 'reportable'
  | 'uncertain';

export type TaxonomyPolicyDecision = {
  readonly kind: ReportTaxonomyKind;
  readonly id: string;
  readonly path: string;
  readonly treatment: TaxonomyTreatment;
  readonly confidence: number;
  readonly reason: string;
};

export type ReportTaxonomyPolicy = {
  readonly decisions: readonly TaxonomyPolicyDecision[];
};

const generatedPolicySchema = z.strictObject({
  decisions: z.array(
    z.strictObject({
      kind: z.enum(['category', 'label']),
      id: z.string(),
      treatment: z.enum([
        'internal-own-account',
        'portfolio-movement',
        'account-settlement',
        'reportable',
        'uncertain',
      ]),
      confidence: z.number().min(0).max(1),
      reason: z.string().max(300),
    }),
  ),
});

const storedPolicySchema = z.strictObject({
  decisions: z.array(
    z.strictObject({
      kind: z.enum(['category', 'label']),
      id: z.string(),
      path: z.string(),
      treatment: z.enum([
        'internal-own-account',
        'portfolio-movement',
        'account-settlement',
        'reportable',
        'uncertain',
      ]),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
});

const EMPTY_POLICY: ReportTaxonomyPolicy = { decisions: [] };
const TAXONOMY_POLICY_VERSION = 2;
const MIN_TREATMENT_CONFIDENCE = 0.8;

type ResolveReportTaxonomyPolicyInput = {
  readonly db: DatabaseSync;
  readonly scope: ReportQueryScope;
  readonly persist: boolean;
};

export type ReportTaxonomyPolicyResolution = {
  readonly policy: ReportTaxonomyPolicy;
  readonly source: 'empty' | 'cache' | 'generated';
  readonly generation: {
    readonly calls: 0 | 1;
    readonly usage?: ModelUsage | undefined;
    readonly durationMs?: number | undefined;
    readonly providerMetadata?: unknown;
  };
};

type GenerateTaxonomyPolicy = (input: {
  readonly scope: ReportQueryScope;
  readonly items: readonly Pick<TaxonomyPolicyDecision, 'kind' | 'id' | 'path'>[];
}) => Promise<{
  readonly decisions: z.infer<typeof generatedPolicySchema>['decisions'];
  readonly usage?: ModelUsage | undefined;
  readonly durationMs?: number | undefined;
  readonly providerMetadata?: unknown;
}>;

export function createReportTaxonomyPolicyResolver(dependencies: {
  readonly generatePolicy: GenerateTaxonomyPolicy;
}): (input: ResolveReportTaxonomyPolicyInput) => Promise<ReportTaxonomyPolicyResolution> {
  return async (input) => {
    const items = collectTaxonomyItems(input.db, input.scope.report.language);
    if (items.length === 0) {
      return { policy: EMPTY_POLICY, source: 'empty', generation: { calls: 0 } };
    }

    const { pricing: _pricing, ...policyModel } = input.scope.report.model;
    const taxonomyHash = hashJson({
      version: TAXONOMY_POLICY_VERSION,
      language: input.scope.report.language,
      model: policyModel,
      items,
    });
    const stored = readIntelligenceTaxonomyPolicy(input.db, input.scope.report.id);
    if (stored?.taxonomyHash === taxonomyHash) {
      const parsed = parseStoredPolicy(stored.policyJson);
      if (parsed) {
        return { policy: parsed, source: 'cache', generation: { calls: 0 } };
      }
    }

    const generated = await dependencies.generatePolicy({ scope: input.scope, items });
    const generatedByKey = new Map(
      generated.decisions.map((decision) => [`${decision.kind}:${decision.id}`, decision]),
    );
    const policy: ReportTaxonomyPolicy = {
      decisions: items.map((item) => {
        const decision = generatedByKey.get(`${item.kind}:${item.id}`);
        return {
          ...item,
          treatment:
            decision && decision.confidence >= MIN_TREATMENT_CONFIDENCE
              ? decision.treatment
              : 'uncertain',
          confidence: decision?.confidence ?? 0,
          reason: decision?.reason ?? 'The model returned no decision.',
        };
      }),
    };
    if (input.persist) {
      saveIntelligenceTaxonomyPolicy(input.db, {
        reportId: input.scope.report.id,
        taxonomyHash,
        policyJson: JSON.stringify(policy),
      });
    }
    return {
      policy,
      source: 'generated',
      generation: {
        calls: 1,
        ...(generated.usage ? { usage: generated.usage } : {}),
        ...(generated.durationMs === undefined ? {} : { durationMs: generated.durationMs }),
        ...(generated.providerMetadata === undefined
          ? {}
          : { providerMetadata: generated.providerMetadata }),
      },
    };
  };
}

export const resolveReportTaxonomyPolicyWithUsage = createReportTaxonomyPolicyResolver({
  generatePolicy: async ({ scope, items }) => {
    const startedAt = performance.now();
    const generated = await generateObject({
      model: createLanguageModel(scope.report.model),
      schema: generatedPolicySchema,
      system: [
        'Classify human-readable financial taxonomy paths for report analysis.',
        'Use internal-own-account only when the path clearly means money moving between accounts owned by the same person. Generic transfers to another person remain reportable.',
        'Use portfolio-movement for investments, brokerage settlements, asset redemptions, and portfolio funding.',
        'Use account-settlement for credit-card bill payments and other settlements whose underlying purchases are already recorded.',
        'Use reportable for income, expenses, taxes, purchases, services, refunds, fees, and third-party transfers.',
        'Use uncertain instead of guessing. Read the path. Never infer meaning from an opaque id.',
        'Return exactly one decision for every input item.',
      ].join(' '),
      prompt: JSON.stringify({ language: scope.report.language, items }),
      ...modelCallOptions(scope.report.model),
    });
    const usage = normalizeModelUsage(generated.usage);
    return {
      decisions: generated.object.decisions,
      durationMs: Math.round(performance.now() - startedAt),
      providerMetadata: generated.providerMetadata,
      ...(usage ? { usage } : {}),
    };
  },
});

export async function resolveReportTaxonomyPolicy(
  input: ResolveReportTaxonomyPolicyInput,
): Promise<ReportTaxonomyPolicy> {
  return (await resolveReportTaxonomyPolicyWithUsage(input)).policy;
}

export function loadStoredReportTaxonomyPolicy(
  db: DatabaseSync,
  reportId: string,
): ReportTaxonomyPolicy | null {
  const stored = readIntelligenceTaxonomyPolicy(db, reportId);
  return stored ? parseStoredPolicy(stored.policyJson) : null;
}

export function resolveTaxonomyTreatment(
  taxonomies: readonly ReportTaxonomy[],
  policy: ReportTaxonomyPolicy,
): TaxonomyTreatment {
  const decisions = new Map(
    policy.decisions.map((decision) => [
      `${decision.kind}:${decision.id}`,
      decision.confidence >= MIN_TREATMENT_CONFIDENCE ? decision.treatment : 'uncertain',
    ]),
  );
  let maxDepth = 0;
  let treatments: TaxonomyTreatment[] = [];
  for (const taxonomy of taxonomies) {
    const treatment = decisions.get(`${taxonomy.kind}:${taxonomy.id}`) ?? 'uncertain';
    if (treatment === 'internal-own-account') return treatment;
    if (taxonomy.depth > maxDepth) {
      maxDepth = taxonomy.depth;
      treatments = [treatment];
    } else if (taxonomy.depth === maxDepth) {
      treatments.push(treatment);
    }
  }
  if (treatments.includes('account-settlement')) return 'account-settlement';
  if (treatments.includes('portfolio-movement')) return 'portfolio-movement';
  if (treatments.includes('reportable')) return 'reportable';
  return 'uncertain';
}

function collectTaxonomyItems(
  db: DatabaseSync,
  language: string,
): readonly Pick<TaxonomyPolicyDecision, 'kind' | 'id' | 'path'>[] {
  const categories = [
    ...buildReportCategoryIndex(db, {
      translateNames: resolveCategoryTranslationEnabled(language),
    }).values(),
  ].flatMap((entry) =>
    entry.path.trim().length > 0
      ? [{ kind: 'category' as const, id: entry.id, path: entry.path }]
      : [],
  );
  const labels = [...buildAnnotationLabelIndex(db).values()].map((entry) => ({
    kind: 'label' as const,
    id: entry.id,
    path: entry.path,
  }));
  return [...categories, ...labels].toSorted(
    (left, right) => left.kind.localeCompare(right.kind) || left.path.localeCompare(right.path),
  );
}

function parseStoredPolicy(value: string): ReportTaxonomyPolicy | null {
  try {
    const parsed: unknown = JSON.parse(value);
    const result = storedPolicySchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
