import type { DatabaseSync } from 'node:sqlite';
import {
  loadAssistSuggestions,
  type StoredAssistSuggestion,
} from '../annotation/assist-suggestions.js';
import { isConfirmedTransactionClassification } from '../annotation/classification-policy.js';
import { buildAnnotationLabelIndex } from '../db/annotation-labels.js';
import { listEnrichedTransactionPage } from '../db/enriched-transactions.js';
import { allSql } from '../db/sqlite-query.js';
import type { EnrichedTransaction } from '../db/transaction-details.js';
import { createTransactionWebListFilters } from '../db/transaction-query.js';
import { readPaymentDocumentsFromRawJson } from '../openfinance/payment-document.js';
import type { ResolvedConfig } from '../types.js';
import { resolveCategoryTranslationEnabled } from '../utils/locale-resolve.js';
import { cleanText, normalizeCompare } from './report-analysis-helpers.js';
import type {
  ReportClassificationSource,
  ReportFact,
  ReportFactDirection,
} from './report-analysis-types.js';
import type { ReportQueryScope } from './report-scope.js';
import {
  buildReportCategoryIndex,
  categoryLevels,
  labelLevels,
  type ReportTaxonomy,
  type ReportTaxonomyIndexes,
  transactionTaxonomies,
} from './report-taxonomy.js';
import { type ReportTaxonomyPolicy, resolveTaxonomyTreatment } from './report-taxonomy-policy.js';

const MAX_HISTORY_ROWS = 20_000;

export type LoadedReportFacts = {
  readonly facts: readonly ReportFact[];
  readonly excluded: {
    readonly internal: { readonly structural: number; readonly semantic: number };
    readonly portfolio: number;
    readonly settlements: number;
  };
};

type LoadReportFactsInput = {
  readonly db: DatabaseSync;
  readonly resolved: ResolvedConfig;
  readonly scope: ReportQueryScope;
  readonly policy: ReportTaxonomyPolicy;
  readonly historyStart: string;
};

type FactResolutionContext = {
  readonly accountTypes: ReadonlyMap<string, string>;
  readonly annotationSources: ReadonlyMap<string, string>;
  readonly suggestions: ReadonlyMap<string, StoredAssistSuggestion>;
  readonly indexes: ReportTaxonomyIndexes;
};

type ExclusionKind = 'structuralInternal' | 'semanticInternal' | 'portfolio' | 'settlements';

type FactTreatmentResult =
  | { readonly fact: ReportFact; readonly exclusion?: ExclusionKind | undefined }
  | { readonly fact?: undefined; readonly exclusion: ExclusionKind };

export function loadReportFacts(input: LoadReportFactsInput): LoadedReportFacts {
  const rows = loadScopedRows(input);
  return collectReportFacts(input, rows, loadFactResolutionContext(input, rows));
}

function loadScopedRows(input: LoadReportFactsInput): readonly EnrichedTransaction[] {
  const { db, scope } = input;
  const page = listEnrichedTransactionPage(
    db,
    createTransactionWebListFilters({
      accountIds: scope.report.accountIds.length > 0 ? scope.report.accountIds : 'all',
      classification: scope.report.includeUnannotated ? 'all' : 'classified',
      startDate: input.historyStart,
      endDate: scope.period.end,
      transfers: 'all',
      useCreditPurchaseDate: true,
    }),
    {
      limit: MAX_HISTORY_ROWS,
      offset: 0,
      sort: 'date:asc',
      timeZone: scope.timeZone,
      locale: scope.report.language,
    },
  );
  if (page.total > page.rows.length) {
    throw new Error(`Report history exceeds the ${MAX_HISTORY_ROWS}-transaction analysis limit.`);
  }
  return page.rows;
}

function loadFactResolutionContext(
  input: LoadReportFactsInput,
  rows: readonly EnrichedTransaction[],
): FactResolutionContext {
  const { db, scope } = input;
  const accountTypes = new Map(
    allSql<{ readonly id: string; readonly type: string }>(db, 'SELECT id, type FROM accounts').map(
      (row) => [row.id, row.type],
    ),
  );
  const annotationSources = new Map(
    allSql<{ readonly entry_id: string; readonly source: string }>(
      db,
      "SELECT entry_id, source FROM entry_annotations WHERE entry_type = 'transaction'",
    ).map((row) => [row.entry_id, row.source]),
  );
  const suggestions = loadAssistSuggestions(db, unconfirmedEntryIds(rows));
  const indexes: ReportTaxonomyIndexes = {
    categories: buildReportCategoryIndex(db, {
      translateNames: resolveCategoryTranslationEnabled(scope.report.language),
    }),
    labels: buildAnnotationLabelIndex(db),
  };
  return { accountTypes, annotationSources, suggestions, indexes };
}

function unconfirmedEntryIds(rows: readonly EnrichedTransaction[]): readonly string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (
      !isConfirmedTransactionClassification({
        categoryOverrideId: row.category_override_id,
        annotation: row.annotation,
      })
    ) {
      ids.push(row.id);
    }
  }
  return ids;
}

function collectReportFacts(
  input: LoadReportFactsInput,
  rows: readonly EnrichedTransaction[],
  context: FactResolutionContext,
): LoadedReportFacts {
  const { scope } = input;
  const facts: ReportFact[] = [];
  const excluded: Record<ExclusionKind, number> = {
    structuralInternal: 0,
    semanticInternal: 0,
    portfolio: 0,
    settlements: 0,
  };

  for (const row of rows) {
    const result = resolveFactTreatment(input, row, context);
    if (result.fact) facts.push(result.fact);
    if (
      result.exclusion &&
      row.local_date >= scope.period.start &&
      row.local_date <= scope.period.end
    ) {
      excluded[result.exclusion] += 1;
    }
  }

  return {
    facts,
    excluded: {
      internal: {
        structural: excluded.structuralInternal,
        semantic: excluded.semanticInternal,
      },
      portfolio: excluded.portfolio,
      settlements: excluded.settlements,
    },
  };
}

function resolveFactTreatment(
  input: LoadReportFactsInput,
  row: EnrichedTransaction,
  context: FactResolutionContext,
): FactTreatmentResult {
  const resolvedFact = resolveFact({
    row,
    suggestion: context.suggestions.get(row.id) ?? null,
    accountType: context.accountTypes.get(row.account_id) ?? 'BANK',
    annotationSource: context.annotationSources.get(row.id),
    indexes: context.indexes,
    threshold: input.resolved.config.intelligence.suggestionConfidenceThreshold,
    publicBaseUrl: input.resolved.config.web.publicBaseUrl,
  });
  if (row.transfer_group?.kind === 'internal_transfer') {
    return { exclusion: 'structuralInternal' };
  }
  const treatment = resolveTaxonomyTreatment(resolvedFact.taxonomies, input.policy);
  if (treatment === 'internal-own-account') return { exclusion: 'semanticInternal' };
  const effectiveTreatment = treatment === 'uncertain' ? 'reportable' : treatment;
  if (effectiveTreatment === 'portfolio-movement') {
    return { fact: { ...resolvedFact, treatment: effectiveTreatment }, exclusion: 'portfolio' };
  }
  if (effectiveTreatment === 'account-settlement') {
    return { fact: { ...resolvedFact, treatment: effectiveTreatment }, exclusion: 'settlements' };
  }
  return { fact: { ...resolvedFact, treatment: effectiveTreatment } };
}

function resolveFact(input: {
  readonly row: EnrichedTransaction;
  readonly suggestion: StoredAssistSuggestion | null;
  readonly accountType: string;
  readonly annotationSource: string | undefined;
  readonly indexes: ReportTaxonomyIndexes;
  readonly threshold: number;
  readonly publicBaseUrl: string | undefined;
}): Omit<ReportFact, 'treatment'> {
  const { row } = input;
  const signed = row.amount_in_account_currency_cents;
  const direction = resolveDirection(input.accountType, signed);
  const confirmed = isConfirmedTransactionClassification({
    categoryOverrideId: row.category_override_id,
    annotation: row.annotation,
  });
  const suggestion = confirmed ? null : input.suggestion;
  const assumed = isUsableSuggestion(suggestion, input.threshold);
  const proposed = assumed ? suggestion.proposal : null;
  const confirmedTaxonomies = confirmed ? transactionTaxonomies(row, input.indexes) : [];
  const suggestedTaxonomies = suggestedTaxonomiesFor(proposed, input.indexes);
  const taxonomies = confirmedTaxonomies.length > 0 ? confirmedTaxonomies : suggestedTaxonomies;
  const classification = resolveClassificationSource(confirmed, input.annotationSource, assumed);
  const party = resolveParty(row, direction);
  const installment =
    row.installment_number && row.total_installments
      ? `${row.installment_number}/${row.total_installments}`
      : undefined;
  const detail = resolveDetail(row.display_description ?? row.description, party, installment);
  const base = input.publicBaseUrl?.replace(/\/+$/u, '');
  return {
    id: row.id,
    date: row.local_date,
    cents: Math.abs(signed),
    currency: row.account_currency,
    direction,
    account: row.account_display_name,
    party,
    ...(detail ? { detail } : {}),
    ...(installment ? { installment } : {}),
    ...(installment && row.credit_card?.purchase_total_cents
      ? { installmentPurchaseCents: Math.abs(row.credit_card.purchase_total_cents) }
      : {}),
    taxonomies,
    classification,
    ...(assumed && suggestion?.confidence !== null
      ? { suggestionScore: suggestion.confidence }
      : {}),
    href: `${base ? `${base}/` : ''}#/transaction/${encodeURIComponent(row.id)}`,
  };
}

function resolveDirection(accountType: string, signedCents: number): ReportFactDirection {
  if (accountType === 'CREDIT') return signedCents >= 0 ? 'expense' : 'refund';
  return signedCents < 0 ? 'expense' : 'income';
}

function isUsableSuggestion(
  suggestion: StoredAssistSuggestion | null,
  threshold: number,
): suggestion is StoredAssistSuggestion & {
  readonly proposal: NonNullable<StoredAssistSuggestion['proposal']>;
  readonly confidence: number;
} {
  return Boolean(
    suggestion?.status === 'ok' &&
      suggestion.reviewStatus === 'pending' &&
      suggestion.proposal &&
      suggestion.confidence !== null &&
      suggestion.confidence >= threshold,
  );
}

function suggestedTaxonomiesFor(
  proposal: StoredAssistSuggestion['proposal'],
  indexes: ReportTaxonomyIndexes,
): readonly ReportTaxonomy[] {
  if (!proposal) return [];
  const categoryId = proposal.subCategoryId ?? proposal.categoryId ?? proposal.categoryOverrideId;
  return [
    ...(categoryId ? categoryLevels(categoryId, indexes.categories) : []),
    ...proposal.labelIds.flatMap((id) => labelLevels(id, indexes.labels)),
  ];
}

function resolveClassificationSource(
  hasAnnotation: boolean,
  annotationSource: string | undefined,
  assumed: boolean,
): ReportClassificationSource {
  if (hasAnnotation) return annotationSource === 'suggested' ? 'accepted-suggestion' : 'confirmed';
  return assumed ? 'assumed-suggestion' : 'unclassified';
}

function resolveParty(row: EnrichedTransaction, direction: ReportFactDirection): string {
  const documents = readPaymentDocumentsFromRawJson(row.raw_json);
  const sourceMerchant = cleanText(row.merchant_name || row.description || 'Unknown');
  const merchant = cleanText(row.display_name || row.merchant_name || row.description || 'Unknown');
  if (
    direction === 'income' &&
    documents.payer &&
    (isMasked(sourceMerchant) || documents.receiverName === merchant)
  ) {
    return `${documents.payer.type}: ${documents.payer.value}`;
  }
  if (!isMasked(merchant)) return merchant;
  if (direction === 'expense' && documents.receiverName) return documents.receiverName;
  const document = direction === 'expense' ? documents.receiver : documents.payer;
  return document ? `${document.type}: ${document.value}` : merchant;
}

function resolveDetail(
  raw: string | null,
  party: string,
  installment: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  let value = cleanText(raw);
  if (installment)
    value = value.replace(new RegExp(`0?${installment.replace('/', '\\/')}$`, 'u'), '');
  const normalized = normalizeCompare(value);
  const partyNormalized = normalizeCompare(party);
  return !normalized || normalized === partyNormalized ? undefined : value;
}

function isMasked(value: string): boolean {
  return /\*{2,}|(?:cpf|cnpj)\s*:\s*[*x]/iu.test(value);
}
