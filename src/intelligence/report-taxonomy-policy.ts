import type { DatabaseSync } from 'node:sqlite';
import { generateObject } from 'ai';
import { z } from 'zod';
import { buildAnnotationLabelIndex } from '../db/annotation-labels.js';
import {
  readIntelligenceTaxonomyOverrides,
  readIntelligenceTaxonomyPolicy,
  saveIntelligenceTaxonomyOverride,
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
import {
  REPORT_TAXONOMY_KINDS,
  TAXONOMY_TREATMENTS,
  type TaxonomyTreatment,
} from './taxonomy-treatment.js';

export type { TaxonomyTreatment } from './taxonomy-treatment.js';

export type TaxonomyPolicyDecision = {
  readonly kind: ReportTaxonomyKind;
  readonly id: string;
  readonly path: string;
  readonly treatment: TaxonomyTreatment;
  readonly confidence: number;
  readonly reason: string;
  readonly source?: 'generated' | 'user';
  readonly generated?: {
    readonly treatment: TaxonomyTreatment;
    readonly confidence: number;
    readonly reason: string;
  };
};

export type ReportTaxonomyPolicy = {
  readonly generatedAt?: string;
  readonly decisions: readonly TaxonomyPolicyDecision[];
};

const generatedPolicySchema = z.strictObject({
  decisions: z.array(
    z.strictObject({
      kind: z.enum(REPORT_TAXONOMY_KINDS),
      id: z.string(),
      treatment: z.enum(TAXONOMY_TREATMENTS),
      confidence: z.number().min(0).max(1),
      reason: z.string().max(300),
    }),
  ),
});

const storedPolicySchema = z.strictObject({
  generatedAt: z.string().optional(),
  decisions: z.array(
    z.strictObject({
      kind: z.enum(REPORT_TAXONOMY_KINDS),
      id: z.string(),
      path: z.string(),
      treatment: z.enum(TAXONOMY_TREATMENTS),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
      source: z.enum(['generated', 'user']).optional(),
      generated: z
        .strictObject({
          treatment: z.enum(TAXONOMY_TREATMENTS),
          confidence: z.number().min(0).max(1),
          reason: z.string(),
        })
        .optional(),
    }),
  ),
});

const EMPTY_POLICY: ReportTaxonomyPolicy = { generatedAt: '', decisions: [] };
const TAXONOMY_POLICY_VERSION = 3;
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
    const items = collectTaxonomyItems(input.db, input.scope.language);
    if (items.length === 0) {
      return { policy: EMPTY_POLICY, source: 'empty', generation: { calls: 0 } };
    }

    const { pricing: _pricing, ...policyModel } = input.scope.report.model;
    const taxonomyHash = hashJson({
      version: TAXONOMY_POLICY_VERSION,
      language: input.scope.language,
      model: policyModel,
      items,
    });
    const stored = readIntelligenceTaxonomyPolicy(input.db, input.scope.report.id);
    if (stored?.taxonomyHash === taxonomyHash) {
      const parsed = parseStoredGeneratedPolicy(stored.policyJson);
      if (parsed) {
        return {
          policy: composePolicy(input.db, input.scope.report.id, parsed),
          source: 'cache',
          generation: { calls: 0 },
        };
      }
    }

    const generated = await dependencies.generatePolicy({ scope: input.scope, items });
    const generatedPolicy = buildGeneratedPolicy(items, generated.decisions);
    if (input.persist) {
      saveIntelligenceTaxonomyPolicy(input.db, {
        reportId: input.scope.report.id,
        taxonomyHash,
        policyJson: JSON.stringify(generatedPolicy),
      });
    }
    return {
      policy: composePolicy(input.db, input.scope.report.id, generatedPolicy),
      source: 'generated',
      generation: presentPolicyGeneration(generated),
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
      prompt: JSON.stringify({ language: scope.language, items }),
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
  const generated = stored ? parseStoredGeneratedPolicy(stored.policyJson) : null;
  return generated ? composePolicy(db, reportId, generated) : null;
}

export function saveReportTaxonomyPolicyOverride(
  db: DatabaseSync,
  reportId: string,
  kind: ReportTaxonomyKind,
  id: string,
  treatment: TaxonomyTreatment,
): ReportTaxonomyPolicy | null {
  const stored = readIntelligenceTaxonomyPolicy(db, reportId);
  const generated = stored ? parseStoredGeneratedPolicy(stored.policyJson) : null;
  if (!generated || !hasDecision(generated, kind, id)) return null;
  saveIntelligenceTaxonomyOverride(db, {
    reportId,
    kind,
    taxonomyId: id,
    treatment,
  });
  return composePolicy(db, reportId, generated);
}

export function removeReportTaxonomyPolicyOverride(
  db: DatabaseSync,
  reportId: string,
  kind: ReportTaxonomyKind,
  id: string,
): ReportTaxonomyPolicy | null {
  const stored = readIntelligenceTaxonomyPolicy(db, reportId);
  const generated = stored ? parseStoredGeneratedPolicy(stored.policyJson) : null;
  if (!generated || !hasDecision(generated, kind, id)) return null;
  saveIntelligenceTaxonomyOverride(db, {
    reportId,
    kind,
    taxonomyId: id,
    treatment: null,
  });
  return composePolicy(db, reportId, generated);
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
  const leaves = taxonomies.filter(
    (candidate) =>
      !taxonomies.some(
        (other) =>
          other.kind === candidate.kind &&
          other.id !== candidate.id &&
          other.path.startsWith(`${candidate.path} > `),
      ),
  );
  const treatments = leaves.map(
    (taxonomy) => decisions.get(`${taxonomy.kind}:${taxonomy.id}`) ?? 'uncertain',
  );
  if (treatments.includes('internal-own-account')) return 'internal-own-account';
  if (treatments.includes('account-settlement')) return 'account-settlement';
  if (treatments.includes('portfolio-movement')) return 'portfolio-movement';
  if (treatments.includes('reportable')) return 'reportable';
  return 'uncertain';
}

function presentPolicyGeneration(generated: Awaited<ReturnType<GenerateTaxonomyPolicy>>) {
  return {
    calls: 1 as const,
    ...(generated.usage ? { usage: generated.usage } : {}),
    ...(generated.durationMs === undefined ? {} : { durationMs: generated.durationMs }),
    ...(generated.providerMetadata === undefined
      ? {}
      : { providerMetadata: generated.providerMetadata }),
  };
}

function buildGeneratedPolicy(
  items: readonly Pick<TaxonomyPolicyDecision, 'kind' | 'id' | 'path'>[],
  generated: z.infer<typeof generatedPolicySchema>['decisions'],
): ReportTaxonomyPolicy {
  const generatedByKey = new Map(
    generated.map((decision) => [`${decision.kind}:${decision.id}`, decision]),
  );
  return {
    generatedAt: new Date().toISOString(),
    decisions: items.map((item) => {
      const decision = generatedByKey.get(`${item.kind}:${item.id}`);
      const generatedDecision = {
        ...item,
        treatment:
          decision && decision.confidence >= MIN_TREATMENT_CONFIDENCE
            ? decision.treatment
            : 'uncertain',
        confidence: decision?.confidence ?? 0,
        reason: decision?.reason ?? 'The model returned no decision.',
        source: 'generated' as const,
      };
      return generatedDecision;
    }),
  };
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

function parseStoredGeneratedPolicy(value: string): ReportTaxonomyPolicy | null {
  try {
    const parsed: unknown = JSON.parse(value);
    const result = storedPolicySchema.safeParse(parsed);
    if (!result.success) return null;
    return {
      generatedAt: result.data.generatedAt ?? '',
      decisions: result.data.decisions.map((decision) => {
        const baseline = decision.source === 'user' ? decision.generated : decision;
        return {
          kind: decision.kind,
          id: decision.id,
          path: decision.path,
          treatment: baseline?.treatment ?? 'uncertain',
          confidence: baseline?.confidence ?? 0,
          reason: baseline?.reason ?? '',
          source: 'generated' as const,
        };
      }),
    };
  } catch {
    return null;
  }
}

function composePolicy(
  db: DatabaseSync,
  reportId: string,
  generatedPolicy: ReportTaxonomyPolicy,
): ReportTaxonomyPolicy {
  const overrides = new Map(
    readIntelligenceTaxonomyOverrides(db, reportId).map((override) => [
      `${override.kind}:${override.taxonomyId}`,
      override.treatment,
    ]),
  );
  return {
    ...generatedPolicy,
    decisions: generatedPolicy.decisions.map((decision) => {
      const treatment = overrides.get(`${decision.kind}:${decision.id}`);
      if (treatment == null) return decision;
      return {
        ...decision,
        treatment,
        confidence: 1,
        reason: '',
        source: 'user' as const,
        generated: {
          treatment: decision.treatment,
          confidence: decision.confidence,
          reason: decision.reason,
        },
      };
    }),
  };
}

function hasDecision(policy: ReportTaxonomyPolicy, kind: ReportTaxonomyKind, id: string): boolean {
  return policy.decisions.some((decision) => decision.kind === kind && decision.id === id);
}
