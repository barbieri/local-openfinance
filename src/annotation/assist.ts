import type { DatabaseSync } from 'node:sqlite';
import { VISIBLE_ACCOUNT_TRANSACTIONS_WHERE } from '../db/account-links.js';
import { buildAnnotationLabelIndex } from '../db/annotation-labels.js';
import { buildCategoryIndex } from '../db/category-display.js';
import {
  collectCounterpartyDocumentKeys,
  extractTransactionDocumentKeysFromRawJson,
  normalizeStoredDocumentKey,
  resolveStrongSharedPeerDocumentKey,
  type TransactionDocumentKeys,
} from '../db/transaction-document-keys.js';
import { TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL } from '../db/transaction-foreign-amount.js';
import {
  type AnnotationAssistProposal,
  isAssistProposalEmpty,
  proposeAnnotationFromExamples,
} from '../scoring/providers.js';
import { blobToVector, cosineSimilarity } from '../scoring/vector.js';
import type { ScoringModelConfig } from '../types.js';
import {
  type AnnotationAssistExample,
  type AnnotationAssistResult,
  type AnnotationAssistStatus,
  type AssistMatchKind,
  annotationAssistExampleSchema,
  assistMatchKindSchema,
} from './assist-contract.js';
import { ASSISTABLE_CLASSIFICATION_WHERE } from './assist-criteria.js';
import {
  COPY_NOTES_EMBEDDING_THRESHOLD,
  COPY_NOTES_MERCHANT_THRESHOLD,
  enrichAssistProposal,
  MAX_ASSIST_PROPOSAL_LABELS,
  rankAssistPromptLabels,
} from './assist-proposal.js';
import {
  ASSIST_SUGGESTION_ALGORITHM_VERSION,
  loadAssistSuggestion,
  presentStoredAssistSuggestion,
  upsertAssistSuggestion,
} from './assist-suggestions.js';
import { ensureEntryEmbedding } from './entry-embeddings.js';
import { type AnnotatableEntry, buildEmbeddingFeatureText } from './feature-text.js';
import {
  loadAnnotationLabelIds,
  loadAnnotationLabelPaths,
  resolveAssistProposalLabelIds,
} from './label-resolve.js';
import {
  normalizeMerchantText,
  resolveMerchantComparableText,
  scoreMerchantSimilarity,
} from './merchant-match.js';
import {
  type AnnotationCategory,
  ensureAnnotationEmbedding,
  listAnnotationCategories,
  listAnnotationLabels,
  loadAnnotatableEntry,
} from './store.js';

export { ASSISTABLE_CLASSIFICATION_WHERE } from './assist-criteria.js';

/** Embedding neighbors: longer window, fewer samples than legacy 90d/150. */
export const DEFAULT_EMBEDDING_WINDOW_DAYS = 180;
export const DEFAULT_MERCHANT_WINDOW_DAYS = 730;
/** A shared counterparty document is a strong identity signal; retain two years of history. */
export const DEFAULT_PEER_WINDOW_DAYS = 730;
export const DEFAULT_MERCHANT_MATCH_THRESHOLD = 0.6;
export const DEFAULT_ASSIST_TOP_K = 6;
export const DEFAULT_ASSIST_CANDIDATE_LIMIT = 80;
export const DEFAULT_PEER_CANDIDATE_LIMIT = 30;
export const MAX_ON_DEMAND_EMBEDDINGS = 12;
export const EXAMPLE_EMBEDDING_THRESHOLD = 0.82;
export const EXAMPLE_MERCHANT_THRESHOLD = 0.6;
export {
  COPY_NOTES_EMBEDDING_THRESHOLD,
  COPY_NOTES_MERCHANT_THRESHOLD,
} from './assist-proposal.js';
export type {
  AnnotationAssistExample,
  AnnotationAssistResult,
  AnnotationAssistStatus,
  AssistMatchKind,
};
export { annotationAssistExampleSchema, assistMatchKindSchema };

export type AnnotationAssistCurrentState = {
  readonly categoryOverrideId?: string | null | undefined;
  readonly categoryId?: string | null | undefined;
  readonly subCategoryId?: string | null | undefined;
  readonly labelIds?: readonly string[] | undefined;
  readonly labelNames?: readonly string[] | undefined;
  readonly notes?: string | null | undefined;
};

type AssistCandidateRow = {
  readonly entry_id: string;
  readonly account_id: string;
  readonly occurred_at: string;
  readonly amount_cents: number;
  readonly merchant_name: string | null;
  readonly description: string | null;
  readonly synced_category_id: string | null;
  readonly category_override_id: string | null;
  readonly annotation_id: string | null;
  readonly category_id: string | null;
  readonly sub_category_id: string | null;
  readonly notes: string | null;
  readonly vector: Buffer | null;
  readonly dimensions: number | null;
  readonly model: string | null;
  readonly payer_document_key: string | null;
  readonly receiver_document_key: string | null;
  readonly merchant_document_key: string | null;
};

type RankedCandidate = {
  readonly row: AssistCandidateRow;
  readonly merchantSimilarity: number;
  readonly embeddingSimilarity: number | null;
  readonly matchKind: AssistMatchKind;
  readonly peerDocumentKey: string | null;
  readonly sameAccount: boolean;
  readonly score: number;
};

const MATCH_KIND_RANK: Record<AssistMatchKind, number> = {
  peer_account: 0,
  peer: 1,
  merchant: 2,
  embedding: 3,
};

export async function suggestAnnotationAssist(
  db: DatabaseSync,
  entry: AnnotatableEntry,
  options: {
    readonly embedding?: ScoringModelConfig | undefined;
    readonly classifier?: ScoringModelConfig | undefined;
    readonly embeddingWindowDays?: number | undefined;
    readonly merchantWindowDays?: number | undefined;
    readonly peerWindowDays?: number | undefined;
    readonly merchantMatchThreshold?: number | undefined;
    readonly topK?: number | undefined;
    readonly currentState?: AnnotationAssistCurrentState | undefined;
  },
): Promise<AnnotationAssistResult> {
  const topK = options.topK ?? DEFAULT_ASSIST_TOP_K;

  if (!options.embedding) {
    return {
      status: 'missing_embedding_config',
      examples: [],
      proposal: null,
      usedClassifier: false,
      confidence: null,
    };
  }
  if (!entry.accountId) {
    return {
      status: 'no_candidates',
      examples: [],
      proposal: null,
      usedClassifier: false,
      confidence: null,
    };
  }

  const categories = listAnnotationCategories(db);
  const labelIndex = buildAnnotationLabelIndex(db);
  const labels = listAnnotationLabels(db).map((label) => ({
    ...label,
    name: labelIndex.get(label.id)?.path ?? label.name,
  }));
  const openFinanceCategories = [...buildCategoryIndex(db).values()].map((item) => ({
    id: item.id,
    name: item.presentation.name,
    path: item.path,
  }));

  const peerKeys = resolveEntryPeerDocumentKeys(entry);
  const peerCandidates = listPeerAssistCandidates(db, entry, peerKeys, {
    peerWindowDays: options.peerWindowDays ?? DEFAULT_PEER_WINDOW_DAYS,
    limit: DEFAULT_PEER_CANDIDATE_LIMIT,
  });
  const merchantCandidates = listMerchantAssistCandidates(db, entry, {
    merchantWindowDays: options.merchantWindowDays ?? DEFAULT_MERCHANT_WINDOW_DAYS,
    merchantMatchThreshold: options.merchantMatchThreshold ?? DEFAULT_MERCHANT_MATCH_THRESHOLD,
  });
  const baseCandidates = listAssistCandidates(db, entry);
  const candidates = mergeAssistCandidateRows(peerCandidates, merchantCandidates, baseCandidates);
  if (candidates.length === 0) {
    return {
      status: 'no_candidates',
      examples: [],
      proposal: null,
      usedClassifier: false,
      confidence: null,
    };
  }

  const rankedResult = await rankAssistCandidates(db, entry, candidates, options.embedding, {
    embeddingWindowDays: options.embeddingWindowDays ?? DEFAULT_EMBEDDING_WINDOW_DAYS,
    merchantWindowDays: options.merchantWindowDays ?? DEFAULT_MERCHANT_WINDOW_DAYS,
    peerWindowDays: options.peerWindowDays ?? DEFAULT_PEER_WINDOW_DAYS,
    merchantMatchThreshold: options.merchantMatchThreshold ?? DEFAULT_MERCHANT_MATCH_THRESHOLD,
    topK,
  });
  const examples = buildAssistExamples(db, categories, rankedResult.ranked);
  const tiered = await resolveTieredAssistProposal({
    classifier: options.classifier,
    featureText: buildEmbeddingFeatureText(entry),
    entry,
    examples,
    openFinanceCategories,
    categories,
    labels,
    currentState: options.currentState,
    merchantClassificationsAmbiguous: rankedResult.merchantClassificationsAmbiguous,
  });

  const confidence = examples[0] ? confidenceFromExample(examples[0]) : null;

  const rawProposal = tiered.proposal;
  if (!rawProposal || isAssistProposalEmpty(rawProposal)) {
    return {
      status: 'no_suggestion',
      examples,
      proposal: null,
      usedClassifier: tiered.usedClassifier,
      confidence,
    };
  }

  const proposal = normalizeAssistProposal(db, rawProposal);

  return {
    status: 'ok',
    examples,
    proposal,
    usedClassifier: tiered.usedClassifier,
    confidence,
  };
}

function confidenceFromExample(example: AnnotationAssistExample): number {
  if (example.matchKind === 'peer_account' || example.matchKind === 'peer') {
    return 1;
  }
  if (example.matchKind === 'merchant') {
    return example.merchantSimilarity;
  }
  return example.similarity;
}

function normalizeAssistProposal(
  db: DatabaseSync,
  proposal: AnnotationAssistProposal,
): AnnotationAssistProposal {
  return {
    ...proposal,
    labelIds: resolveAssistProposalLabelIds(db, proposal),
  };
}

export async function computeAnnotationAssist(
  db: DatabaseSync,
  entry: AnnotatableEntry,
  options: {
    readonly embedding: ScoringModelConfig;
    readonly classifier?: ScoringModelConfig | undefined;
    readonly embeddingWindowDays?: number | undefined;
    readonly merchantWindowDays?: number | undefined;
    readonly peerWindowDays?: number | undefined;
    readonly merchantMatchThreshold?: number | undefined;
    readonly topK?: number | undefined;
  },
): Promise<AnnotationAssistResult> {
  return suggestAnnotationAssist(db, entry, options);
}

export async function resolveTransactionAssist(
  db: DatabaseSync,
  entry: AnnotatableEntry,
  options: {
    readonly embedding?: ScoringModelConfig | undefined;
    readonly classifier?: ScoringModelConfig | undefined;
    readonly embeddingWindowDays?: number | undefined;
    readonly topK?: number | undefined;
    readonly currentState?: AnnotationAssistCurrentState | undefined;
    readonly force?: boolean | undefined;
  },
): Promise<AnnotationAssistResult> {
  if (!options.force) {
    const stored = loadAssistSuggestion(db, entry.entryId);
    if (
      stored?.proposal &&
      (stored.reviewStatus !== 'pending' ||
        stored.algorithmVersion === ASSIST_SUGGESTION_ALGORITHM_VERSION)
    ) {
      return {
        ...presentStoredAssistSuggestion(stored, {
          description: entry.description,
          merchantName: entry.merchantName,
        }),
        fromCache: true,
      };
    }
  }

  const result = await suggestAnnotationAssist(db, entry, options);
  const embedding = options.embedding;
  if (embedding && entry.entryType === 'transaction') {
    upsertAssistSuggestion(db, {
      entryType: 'transaction',
      entryId: entry.entryId,
      status: result.status,
      proposal: result.proposal,
      examples: result.examples,
      confidence: result.confidence,
      usedClassifier: result.usedClassifier,
      embeddingModel: embedding.model,
      classifierModel: options.classifier?.model ?? null,
      algorithmVersion: ASSIST_SUGGESTION_ALGORITHM_VERSION,
      computedAt: new Date().toISOString(),
      reviewStatus: 'pending',
      reviewedAt: null,
    });
  }
  return result;
}

async function resolveTieredAssistProposal(input: {
  readonly classifier?: ScoringModelConfig | undefined;
  readonly featureText: string;
  readonly entry: AnnotatableEntry;
  readonly examples: readonly AnnotationAssistExample[];
  readonly openFinanceCategories: readonly {
    readonly id: string;
    readonly name: string;
    readonly path: string;
  }[];
  readonly categories: readonly AnnotationCategory[];
  readonly labels: ReturnType<typeof listAnnotationLabels>;
  readonly currentState?: AnnotationAssistCurrentState | undefined;
  readonly merchantClassificationsAmbiguous: boolean;
}): Promise<{
  readonly proposal: AnnotationAssistProposal | null;
  readonly usedClassifier: boolean;
}> {
  let usedClassifier = false;
  let proposal = buildHeuristicProposal(input.examples, input.merchantClassificationsAmbiguous);
  if (isAssistProposalEmpty(proposal)) {
    proposal = buildExampleProposal(input.examples, input.merchantClassificationsAmbiguous);
  }
  if (isAssistProposalEmpty(proposal) && input.classifier) {
    usedClassifier = true;
    const promptLabels = rankAssistPromptLabels(input.examples, input.labels);
    proposal = await proposeAnnotationFromExamples(input.classifier, {
      targetFeatureText: input.featureText,
      currentState: {
        categoryOverrideId: input.currentState?.categoryOverrideId ?? null,
        categoryId: input.currentState?.categoryId ?? null,
        subCategoryId: input.currentState?.subCategoryId ?? null,
        labelIds: input.currentState?.labelIds ?? [],
        labelNames: input.currentState?.labelNames ?? [],
        notes: input.currentState?.notes ?? null,
      },
      examples: input.examples.map((example) => ({
        featureText: example.featureText,
        categoryOverrideId: example.categoryOverrideId,
        effectiveCategoryId: example.effectiveCategoryId,
        categoryId: example.categoryId,
        subCategoryId: example.subCategoryId,
        labelIds: example.labelIds.slice(0, MAX_ASSIST_PROPOSAL_LABELS),
        labelNames: example.labelNames.slice(0, MAX_ASSIST_PROPOSAL_LABELS),
        notes: example.notes,
        matchKind: example.matchKind,
        merchantSimilarity: example.merchantSimilarity,
        similarity: example.similarity,
        peerDocumentKey: example.peerDocumentKey,
        sameAccount: example.sameAccount,
      })),
      openFinanceCategories: input.openFinanceCategories,
      categories: input.categories,
      labels: promptLabels,
    });
  }

  if (!proposal || isAssistProposalEmpty(proposal)) {
    return { proposal: null, usedClassifier };
  }

  const notesContext = {
    description: input.entry.description,
    merchantName: input.entry.merchantName,
  };
  const exampleNotesHints = input.examples.map((example) => ({
    categoryOverrideId: example.categoryOverrideId,
    effectiveCategoryId: example.effectiveCategoryId,
    notes: example.notes,
    merchantName: example.merchantName,
    description: example.description,
    matchKind: example.matchKind,
  }));

  return {
    proposal: enrichAssistProposal(
      proposal,
      exampleNotesHints,
      input.entry.categoryId,
      notesContext,
    ),
    usedClassifier,
  };
}

function resolveEntryPeerDocumentKeys(entry: AnnotatableEntry): readonly string[] {
  // Recall only on counterparty-side keys. Including the account-holder payer CPF (present on
  // almost every debit) floods the peer LIMIT with unrelated neighbors and drops true peers.
  // All keys remain stored on transactions; scoring still requires a strong share on both sides.
  return collectCounterpartyDocumentKeys(
    extractTransactionDocumentKeysFromRawJson(entry.rawJson),
    entry.amountCents,
  );
}

function readCandidateDocumentKeys(row: AssistCandidateRow): TransactionDocumentKeys {
  return {
    payerDocumentKey: normalizeStoredDocumentKey(row.payer_document_key),
    receiverDocumentKey: normalizeStoredDocumentKey(row.receiver_document_key),
    merchantDocumentKey: normalizeStoredDocumentKey(row.merchant_document_key),
  };
}

function listPeerAssistCandidates(
  db: DatabaseSync,
  entry: AnnotatableEntry,
  peerKeys: readonly string[],
  options: { readonly peerWindowDays: number; readonly limit: number },
): AssistCandidateRow[] {
  if (peerKeys.length === 0 || !entry.accountId) {
    return [];
  }

  const center = Date.parse(entry.occurredAt);
  const minIso = new Date(center - options.peerWindowDays * 86_400_000).toISOString();
  const maxIso = new Date(center + options.peerWindowDays * 86_400_000).toISOString();
  const placeholders = peerKeys.map(() => '?').join(', ');

  return db
    .prepare(
      `SELECT t.id AS entry_id, t.account_id, t.occurred_at,
              ${TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL} AS amount_cents,
              t.merchant_name, t.description,
              t.category_id AS synced_category_id, tco.category_id AS category_override_id,
              ea.id AS annotation_id, ea.category_id, ea.sub_category_id, ea.notes,
              ae.vector, ae.dimensions, ae.model,
              t.payer_document_key, t.receiver_document_key, t.merchant_document_key
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN entry_annotations ea ON ea.entry_type = 'transaction' AND ea.entry_id = t.id
       LEFT JOIN transaction_category_overrides tco ON tco.transaction_id = t.id
       LEFT JOIN annotation_embeddings ae ON ae.annotation_id = ea.id
       WHERE t.id != ?
         AND t.occurred_at BETWEEN ? AND ?
         AND (
           t.payer_document_key IN (${placeholders})
           OR t.receiver_document_key IN (${placeholders})
           OR t.merchant_document_key IN (${placeholders})
         )
         AND ${VISIBLE_ACCOUNT_TRANSACTIONS_WHERE}
         AND ${ASSISTABLE_CLASSIFICATION_WHERE}
       ORDER BY
         CASE WHEN t.account_id = ? THEN 0 ELSE 1 END,
         t.occurred_at DESC
       LIMIT ?`,
    )
    .all(
      entry.entryId,
      minIso,
      maxIso,
      ...peerKeys,
      ...peerKeys,
      ...peerKeys,
      entry.accountId,
      options.limit,
    ) as AssistCandidateRow[];
}

function listAssistCandidates(db: DatabaseSync, entry: AnnotatableEntry): AssistCandidateRow[] {
  return db
    .prepare(
      `SELECT t.id AS entry_id, t.account_id, t.occurred_at,
              ${TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL} AS amount_cents,
              t.merchant_name, t.description,
              t.category_id AS synced_category_id, tco.category_id AS category_override_id,
              ea.id AS annotation_id, ea.category_id, ea.sub_category_id, ea.notes,
              ae.vector, ae.dimensions, ae.model,
              t.payer_document_key, t.receiver_document_key, t.merchant_document_key
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN entry_annotations ea ON ea.entry_type = 'transaction' AND ea.entry_id = t.id
       LEFT JOIN transaction_category_overrides tco ON tco.transaction_id = t.id
       LEFT JOIN annotation_embeddings ae ON ae.annotation_id = ea.id
       WHERE t.id != ?
         AND t.account_id = ?
         AND ${VISIBLE_ACCOUNT_TRANSACTIONS_WHERE}
         AND ${ASSISTABLE_CLASSIFICATION_WHERE}
       ORDER BY t.occurred_at DESC
       LIMIT ?`,
    )
    .all(entry.entryId, entry.accountId, DEFAULT_ASSIST_CANDIDATE_LIMIT) as AssistCandidateRow[];
}

function listMerchantAssistCandidates(
  db: DatabaseSync,
  entry: AnnotatableEntry,
  options: { readonly merchantWindowDays: number; readonly merchantMatchThreshold: number },
): AssistCandidateRow[] {
  const merchantName = entry.merchantName?.trim() ?? '';
  const description = entry.description?.trim() ?? '';
  const ftsQuery = buildMerchantFtsQuery(entry);
  if (!merchantName && !description) {
    return [];
  }
  const center = Date.parse(entry.occurredAt);
  const minIso = new Date(center - options.merchantWindowDays * 86_400_000).toISOString();
  const maxIso = new Date(center + options.merchantWindowDays * 86_400_000).toISOString();
  const merchantPredicate = ftsQuery
    ? `(
         t.merchant_name = ?
         OR t.description = ?
         OR t.rowid IN (
           SELECT rowid FROM transactions_fts WHERE transactions_fts MATCH ?
         )
       )`
    : '(t.merchant_name = ? OR t.description = ?)';
  const rows = db
    .prepare(
      `SELECT t.id AS entry_id, t.account_id, t.occurred_at,
              ${TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL} AS amount_cents,
              t.merchant_name, t.description,
              t.category_id AS synced_category_id, tco.category_id AS category_override_id,
              ea.id AS annotation_id, ea.category_id, ea.sub_category_id, ea.notes,
              ae.vector, ae.dimensions, ae.model,
              t.payer_document_key, t.receiver_document_key, t.merchant_document_key
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN entry_annotations ea ON ea.entry_type = 'transaction' AND ea.entry_id = t.id
       LEFT JOIN transaction_category_overrides tco ON tco.transaction_id = t.id
       LEFT JOIN annotation_embeddings ae ON ae.annotation_id = ea.id
       WHERE t.id != ?
         AND t.account_id = ?
         AND t.occurred_at BETWEEN ? AND ?
         AND ${merchantPredicate}
         AND ${VISIBLE_ACCOUNT_TRANSACTIONS_WHERE}
         AND ${ASSISTABLE_CLASSIFICATION_WHERE}`,
    )
    .all(
      entry.entryId,
      entry.accountId,
      minIso,
      maxIso,
      merchantName,
      description,
      ...(ftsQuery ? [ftsQuery] : []),
    ) as AssistCandidateRow[];

  const matches: { readonly row: AssistCandidateRow; readonly merchantSimilarity: number }[] = [];
  for (const row of rows) {
    const merchantSimilarity = scoreMerchantSimilarity(
      entry.merchantName,
      entry.description,
      row.merchant_name,
      row.description,
    );
    if (merchantSimilarity >= options.merchantMatchThreshold) {
      matches.push({ row, merchantSimilarity });
    }
  }
  return matches
    .toSorted((left, right) => {
      if (right.merchantSimilarity !== left.merchantSimilarity) {
        return right.merchantSimilarity - left.merchantSimilarity;
      }
      return right.row.occurred_at.localeCompare(left.row.occurred_at);
    })
    .slice(0, DEFAULT_ASSIST_CANDIDATE_LIMIT)
    .map((candidate) => candidate.row);
}

function buildMerchantFtsQuery(entry: AnnotatableEntry): string | null {
  const text = normalizeMerchantText(
    resolveMerchantComparableText(entry.merchantName, entry.description),
  );
  const tokens = text.split(' ').flatMap((token) => {
    const suffixMatch = /^([a-z]+)\d+$/u.exec(token);
    return suffixMatch?.[1] ? [token, suffixMatch[1]] : [token];
  });
  const uniqueTokens = [...new Set(tokens.filter((token) => token.length > 1))].slice(0, 6);
  return uniqueTokens.length > 0 ? uniqueTokens.map((token) => `"${token}"`).join(' OR ') : null;
}

function mergeAssistCandidateRows(
  ...candidateGroups: readonly (readonly AssistCandidateRow[])[]
): AssistCandidateRow[] {
  const seen = new Set<string>();
  const merged: AssistCandidateRow[] = [];
  for (const candidates of candidateGroups) {
    for (const row of candidates) {
      if (seen.has(row.entry_id)) {
        continue;
      }
      seen.add(row.entry_id);
      merged.push(row);
    }
  }
  return merged;
}

async function rankAssistCandidates(
  db: DatabaseSync,
  entry: AnnotatableEntry,
  candidates: readonly AssistCandidateRow[],
  embedding: ScoringModelConfig,
  options: {
    readonly embeddingWindowDays: number;
    readonly merchantWindowDays: number;
    readonly peerWindowDays: number;
    readonly merchantMatchThreshold: number;
    readonly topK: number;
  },
): Promise<{
  readonly ranked: RankedCandidate[];
  readonly merchantClassificationsAmbiguous: boolean;
}> {
  const direct = candidates
    .map((row) => scoreDirectAssistCandidate(entry, row, options))
    .filter((candidate): candidate is RankedCandidate => candidate !== null);
  if (direct.length > 0) {
    const conflictingMerchantKeys = findConflictingMerchantClassificationKeys(db, direct);
    const merchantClassificationsAmbiguous = conflictingMerchantKeys.size > 0;
    const selectedDirect = merchantClassificationsAmbiguous
      ? selectTopRankedCandidatesWithMerchantConflict(
          db,
          direct,
          options.topK,
          conflictingMerchantKeys,
        )
      : selectTopRankedCandidates(direct, options.topK);
    // An exact merchant name is more specific than a document shared by different payment flows
    // (for example, salary and dividend payments from the same company).
    const exactMerchantMatches = direct.filter(
      (candidate) =>
        candidate.matchKind === 'merchant' &&
        hasExactMerchantName(entry.merchantName, candidate.row.merchant_name),
    );
    if (exactMerchantMatches.length > 0) {
      return {
        ranked: merchantClassificationsAmbiguous
          ? selectTopRankedCandidatesWithMerchantConflict(
              db,
              exactMerchantMatches,
              options.topK,
              conflictingMerchantKeys,
            )
          : selectTopRankedCandidates(exactMerchantMatches, options.topK),
        merchantClassificationsAmbiguous,
      };
    }
    return {
      ranked: selectedDirect,
      merchantClassificationsAmbiguous,
    };
  }

  const queryVector = await ensureEntryEmbedding(db, entry, embedding);
  const ranked: RankedCandidate[] = [];
  let computedEmbeddings = 0;

  for (const row of candidates) {
    const candidate = await scoreAssistCandidate(
      db,
      entry,
      row,
      queryVector,
      embedding,
      options,
      computedEmbeddings,
    );
    if (candidate) {
      if (candidate.computedEmbedding) {
        computedEmbeddings += 1;
      }
      ranked.push(candidate.ranked);
    }
  }

  return {
    ranked: selectTopRankedCandidates(ranked, options.topK),
    merchantClassificationsAmbiguous:
      findConflictingMerchantClassificationKeys(db, ranked).size > 0,
  };
}

function scoreDirectAssistCandidate(
  entry: AnnotatableEntry,
  row: AssistCandidateRow,
  options: {
    readonly merchantWindowDays: number;
    readonly peerWindowDays: number;
    readonly merchantMatchThreshold: number;
  },
): RankedCandidate | null {
  const center = Date.parse(entry.occurredAt);
  const ageMs = Math.abs(Date.parse(row.occurred_at) - center);
  const sameAccount = row.account_id === entry.accountId;
  const peerDocumentKey = resolveSharedPeerDocumentKey(entry, row);
  const isPeerMatch = peerDocumentKey !== null && ageMs <= options.peerWindowDays * 86_400_000;
  const merchantSimilarity = scoreMerchantSimilarity(
    entry.merchantName,
    entry.description,
    row.merchant_name,
    row.description,
  );
  const isMerchantMatch =
    sameAccount &&
    merchantSimilarity >= options.merchantMatchThreshold &&
    ageMs <= options.merchantWindowDays * 86_400_000;
  if (!isPeerMatch && !isMerchantMatch) {
    return null;
  }

  const matchKind: AssistMatchKind =
    isMerchantMatch && hasExactMerchantName(entry.merchantName, row.merchant_name)
      ? 'merchant'
      : isPeerMatch
        ? sameAccount
          ? 'peer_account'
          : 'peer'
        : 'merchant';
  return {
    row,
    merchantSimilarity,
    embeddingSimilarity: null,
    matchKind,
    peerDocumentKey,
    sameAccount,
    score: scoreForMatchKind(matchKind, merchantSimilarity, null),
  };
}

function hasExactMerchantName(
  leftMerchantName: string | null | undefined,
  rightMerchantName: string | null | undefined,
): boolean {
  const left = normalizeMerchantText(leftMerchantName);
  const right = normalizeMerchantText(rightMerchantName);
  return Boolean(left) && left === right;
}

async function scoreAssistCandidate(
  db: DatabaseSync,
  entry: AnnotatableEntry,
  row: AssistCandidateRow,
  queryVector: readonly number[],
  embedding: ScoringModelConfig,
  options: {
    readonly embeddingWindowDays: number;
    readonly merchantWindowDays: number;
    readonly peerWindowDays: number;
    readonly merchantMatchThreshold: number;
  },
  computedEmbeddings: number,
): Promise<{ readonly ranked: RankedCandidate; readonly computedEmbedding: boolean } | null> {
  const center = Date.parse(entry.occurredAt);
  const occurredAtMs = Date.parse(row.occurred_at);
  const ageMs = Math.abs(occurredAtMs - center);
  const sameAccount = row.account_id === entry.accountId;
  const peerDocumentKey = resolveSharedPeerDocumentKey(entry, row);
  const isPeerMatch = peerDocumentKey !== null && ageMs <= options.peerWindowDays * 86_400_000;
  const merchantSimilarity = scoreMerchantSimilarity(
    entry.merchantName,
    entry.description,
    row.merchant_name,
    row.description,
  );
  const isMerchantMatch =
    sameAccount &&
    merchantSimilarity >= options.merchantMatchThreshold &&
    ageMs <= options.merchantWindowDays * 86_400_000;
  const inEmbeddingWindow = sameAccount && ageMs <= options.embeddingWindowDays * 86_400_000;

  if (!isPeerMatch && !isMerchantMatch && !inEmbeddingWindow) {
    return null;
  }

  const embeddingResult = inEmbeddingWindow
    ? await resolveEmbeddingSimilarity(db, row, queryVector, embedding, computedEmbeddings)
    : { similarity: null, computedEmbedding: false };
  if (!isPeerMatch && !isMerchantMatch && embeddingResult.similarity === null) {
    return null;
  }

  const matchKind: AssistMatchKind = isPeerMatch
    ? sameAccount
      ? 'peer_account'
      : 'peer'
    : isMerchantMatch
      ? 'merchant'
      : 'embedding';
  const score = scoreForMatchKind(matchKind, merchantSimilarity, embeddingResult.similarity);

  return {
    ranked: {
      row,
      merchantSimilarity,
      embeddingSimilarity: embeddingResult.similarity,
      matchKind,
      peerDocumentKey,
      sameAccount,
      score,
    },
    computedEmbedding: embeddingResult.computedEmbedding,
  };
}

function scoreForMatchKind(
  matchKind: AssistMatchKind,
  merchantSimilarity: number,
  embeddingSimilarity: number | null,
): number {
  if (matchKind === 'peer_account') {
    return 3 + (embeddingSimilarity ?? 0) * 0.05;
  }
  if (matchKind === 'peer') {
    return 2 + (embeddingSimilarity ?? 0) * 0.05;
  }
  if (matchKind === 'merchant') {
    return 1 + merchantSimilarity + (embeddingSimilarity ?? 0) * 0.15;
  }
  return embeddingSimilarity ?? 0;
}

function resolveSharedPeerDocumentKey(
  entry: AnnotatableEntry,
  row: AssistCandidateRow,
): string | null {
  // All of payer/receiver/merchant may be present; only a shared key that is a counterparty
  // signal for at least one side counts (avoids "my CPF on every debit" false peers).
  return resolveStrongSharedPeerDocumentKey(
    extractTransactionDocumentKeysFromRawJson(entry.rawJson),
    entry.amountCents,
    readCandidateDocumentKeys(row),
    Number(row.amount_cents),
  );
}

async function resolveEmbeddingSimilarity(
  db: DatabaseSync,
  row: AssistCandidateRow,
  queryVector: readonly number[],
  embedding: ScoringModelConfig,
  computedEmbeddings: number,
): Promise<{ readonly similarity: number | null; readonly computedEmbedding: boolean }> {
  let similarity = scoreCandidateSimilarity(row, queryVector, embedding.provider);
  if (similarity !== null || !row.annotation_id || computedEmbeddings >= MAX_ON_DEMAND_EMBEDDINGS) {
    return { similarity, computedEmbedding: false };
  }

  const neighbor = loadAnnotatableEntry(db, 'transaction', row.entry_id);
  if (!neighbor) {
    return { similarity: null, computedEmbedding: false };
  }

  await ensureAnnotationEmbedding(db, row.annotation_id, neighbor, embedding);
  const refreshed = loadAssistCandidate(db, row.entry_id);
  similarity = refreshed
    ? scoreCandidateSimilarity(refreshed, queryVector, embedding.provider)
    : null;
  return { similarity, computedEmbedding: true };
}

function selectTopRankedCandidates(
  ranked: readonly RankedCandidate[],
  topK: number,
): RankedCandidate[] {
  const sorted = ranked.toSorted((left, right) => {
    const kindDelta = MATCH_KIND_RANK[left.matchKind] - MATCH_KIND_RANK[right.matchKind];
    if (kindDelta !== 0) {
      return kindDelta;
    }
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return right.row.occurred_at.localeCompare(left.row.occurred_at);
  });

  const selected: RankedCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of sorted) {
    if (seen.has(candidate.row.entry_id)) {
      continue;
    }
    seen.add(candidate.row.entry_id);
    selected.push(candidate);
    if (selected.length >= topK) {
      break;
    }
  }

  return selected;
}

function loadAssistCandidate(db: DatabaseSync, entryId: string): AssistCandidateRow | null {
  const row = db
    .prepare(
      `SELECT t.id AS entry_id, t.account_id, t.occurred_at,
              ${TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL} AS amount_cents,
              t.merchant_name, t.description,
              t.category_id AS synced_category_id, tco.category_id AS category_override_id,
              ea.id AS annotation_id, ea.category_id, ea.sub_category_id, ea.notes,
              ae.vector, ae.dimensions, ae.model,
              t.payer_document_key, t.receiver_document_key, t.merchant_document_key
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN entry_annotations ea ON ea.entry_type = 'transaction' AND ea.entry_id = t.id
       LEFT JOIN transaction_category_overrides tco ON tco.transaction_id = t.id
       LEFT JOIN annotation_embeddings ae ON ae.annotation_id = ea.id
       WHERE t.id = ?`,
    )
    .get(entryId) as AssistCandidateRow | undefined;
  return row ?? null;
}

function buildAssistExamples(
  db: DatabaseSync,
  categories: readonly AnnotationCategory[],
  ranked: readonly RankedCandidate[],
): AnnotationAssistExample[] {
  const examples: AnnotationAssistExample[] = [];

  for (const {
    row,
    merchantSimilarity,
    embeddingSimilarity,
    matchKind,
    peerDocumentKey,
    sameAccount,
  } of ranked) {
    const neighbor = loadAnnotatableEntry(db, 'transaction', row.entry_id);
    if (!neighbor) {
      continue;
    }

    const categoryOverrideId = row.category_override_id;
    const effectiveCategoryId = categoryOverrideId ?? row.synced_category_id;
    examples.push({
      entryId: row.entry_id,
      occurredAt: row.occurred_at,
      similarity: embeddingSimilarity ?? (matchKind.startsWith('peer') ? 1 : merchantSimilarity),
      merchantSimilarity,
      matchKind,
      peerDocumentKey,
      sameAccount,
      featureText: buildEmbeddingFeatureText(neighbor),
      categoryOverrideId,
      effectiveCategoryId,
      categoryId: row.category_id,
      subCategoryId: row.sub_category_id,
      categoryName: resolveCategoryName(categories, row.category_id),
      subCategoryName: resolveCategoryName(categories, row.sub_category_id),
      labelIds: row.annotation_id ? loadAnnotationLabelIds(db, row.annotation_id) : [],
      labelNames: row.annotation_id ? loadAnnotationLabelPaths(db, row.annotation_id) : [],
      notes: row.notes,
      merchantName: row.merchant_name,
      description: row.description,
    });
  }

  return examples;
}

function resolveNotesFromExample(example: AnnotationAssistExample): string | null {
  const strongPeer = example.matchKind === 'peer_account' || example.matchKind === 'peer';
  const strongMerchant =
    example.matchKind === 'merchant' && example.merchantSimilarity >= COPY_NOTES_MERCHANT_THRESHOLD;
  const strongEmbedding =
    example.matchKind === 'embedding' && example.similarity >= COPY_NOTES_EMBEDDING_THRESHOLD;
  if (!strongPeer && !strongMerchant && !strongEmbedding) {
    return null;
  }
  return example.notes;
}

function sliceProposalLabels(
  labelIds: readonly string[],
  labelNames: readonly string[],
): { readonly labelIds: readonly string[]; readonly labelNames: readonly string[] } {
  const ids = [...labelIds].slice(0, MAX_ASSIST_PROPOSAL_LABELS);
  return {
    labelIds: ids,
    labelNames: [...labelNames].slice(0, ids.length),
  };
}

function buildExampleProposal(
  examples: readonly AnnotationAssistExample[],
  merchantClassificationsAmbiguous: boolean,
): AnnotationAssistProposal | null {
  if (merchantClassificationsAmbiguous) {
    return null;
  }
  const top = examples[0];
  if (!top) {
    return null;
  }

  const strongPeer = top.matchKind === 'peer_account' || top.matchKind === 'peer';
  const strongMerchant =
    top.matchKind === 'merchant' && top.merchantSimilarity >= EXAMPLE_MERCHANT_THRESHOLD;
  const strongEmbedding =
    top.matchKind === 'embedding' && top.similarity >= EXAMPLE_EMBEDDING_THRESHOLD;
  if (!strongPeer && !strongMerchant && !strongEmbedding) {
    return null;
  }

  const labels = sliceProposalLabels(top.labelIds, top.labelNames);

  return {
    categoryOverrideId: top.categoryOverrideId ?? top.effectiveCategoryId ?? null,
    categoryId: top.categoryId,
    subCategoryId: top.subCategoryId,
    labelIds: [...labels.labelIds],
    labelNames: [...labels.labelNames],
    notes: resolveNotesFromExample(top),
    reasoning: reasoningForMatch(top),
  };
}

function buildHeuristicProposal(
  examples: readonly AnnotationAssistExample[],
  merchantClassificationsAmbiguous: boolean,
): AnnotationAssistProposal | null {
  const peerExample = examples.find(
    (example) => example.matchKind === 'peer_account' || example.matchKind === 'peer',
  );
  if (peerExample) {
    const labels = sliceProposalLabels(peerExample.labelIds, peerExample.labelNames);
    return {
      categoryOverrideId: peerExample.categoryOverrideId ?? peerExample.effectiveCategoryId ?? null,
      categoryId: peerExample.categoryId,
      subCategoryId: peerExample.subCategoryId,
      labelIds: [...labels.labelIds],
      labelNames: [...labels.labelNames],
      notes: resolveNotesFromExample(peerExample),
      reasoning: reasoningForMatch(peerExample),
    };
  }

  if (merchantClassificationsAmbiguous) {
    return null;
  }

  const merchantExample = examples.find(
    (example) => example.matchKind === 'merchant' && example.merchantSimilarity >= 0.75,
  );
  if (!merchantExample) {
    return null;
  }

  const labels = sliceProposalLabels(merchantExample.labelIds, merchantExample.labelNames);

  return {
    categoryOverrideId:
      merchantExample.categoryOverrideId ?? merchantExample.effectiveCategoryId ?? null,
    categoryId: merchantExample.categoryId,
    subCategoryId: merchantExample.subCategoryId,
    labelIds: [...labels.labelIds],
    labelNames: [...labels.labelNames],
    notes: resolveNotesFromExample(merchantExample),
    reasoning: 'Matched a recurring merchant on the same account.',
  };
}

/**
 * A name can identify a payment proxy rather than one business purpose.  Do not blindly copy
 * an arbitrary prior annotation when exact/similar same-account merchant rows disagree; let the
 * classifier inspect the examples instead, or abstain when no classifier can resolve it.
 */
function findConflictingMerchantClassificationKeys(
  db: DatabaseSync,
  candidates: readonly RankedCandidate[],
): ReadonlySet<string> {
  const signaturesByMerchant = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (candidate.matchKind !== 'merchant' || candidate.merchantSimilarity < 0.75) {
      continue;
    }
    const merchant = normalizeMerchantText(candidate.row.merchant_name);
    if (!merchant) {
      continue;
    }
    const signatures = signaturesByMerchant.get(merchant) ?? new Set<string>();
    signatures.add(candidateClassificationSignature(db, candidate));
    signaturesByMerchant.set(merchant, signatures);
  }
  return new Set(
    [...signaturesByMerchant].flatMap(([merchant, signatures]) =>
      signatures.size > 1 ? [merchant] : [],
    ),
  );
}

function selectTopRankedCandidatesWithMerchantConflict(
  db: DatabaseSync,
  candidates: readonly RankedCandidate[],
  topK: number,
  conflictingMerchantKeys: ReadonlySet<string>,
): RankedCandidate[] {
  const selected = selectTopRankedCandidates(candidates, topK);
  if (selected.length === 0 || selected.length >= candidates.length) {
    return selected;
  }
  const selectedSignaturesByMerchant = new Map<string, Set<string>>();
  for (const candidate of selected) {
    const merchant = normalizeMerchantText(candidate.row.merchant_name);
    if (!merchant) {
      continue;
    }
    const signatures = selectedSignaturesByMerchant.get(merchant) ?? new Set<string>();
    signatures.add(candidateClassificationSignature(db, candidate));
    selectedSignaturesByMerchant.set(merchant, signatures);
  }
  const conflict = candidates.find((candidate) => {
    const merchant = normalizeMerchantText(candidate.row.merchant_name);
    if (candidate.matchKind !== 'merchant' || !merchant || !conflictingMerchantKeys.has(merchant)) {
      return false;
    }
    return !selectedSignaturesByMerchant
      .get(merchant)
      ?.has(candidateClassificationSignature(db, candidate));
  });
  return conflict ? [...selected.slice(0, -1), conflict] : selected;
}

function candidateClassificationSignature(db: DatabaseSync, candidate: RankedCandidate): string {
  return JSON.stringify({
    categoryOverrideId: candidate.row.category_override_id ?? candidate.row.synced_category_id,
    categoryId: candidate.row.category_id,
    subCategoryId: candidate.row.sub_category_id,
    labelIds: candidate.row.annotation_id
      ? loadAnnotationLabelIds(db, candidate.row.annotation_id).toSorted()
      : [],
  });
}

function reasoningForMatch(example: AnnotationAssistExample): string {
  if (example.matchKind === 'peer_account') {
    return example.peerDocumentKey
      ? `Matched the same counterparty document (${example.peerDocumentKey}) on the same account.`
      : 'Matched the same counterparty document on the same account.';
  }
  if (example.matchKind === 'peer') {
    return example.peerDocumentKey
      ? `Matched the same counterparty document (${example.peerDocumentKey}) on another account.`
      : 'Matched the same counterparty document on another account.';
  }
  if (example.matchKind === 'merchant') {
    return 'Matched a recurring merchant on the same account.';
  }
  return 'Matched a similar classified transaction on the same account (embedding).';
}

function scoreCandidateSimilarity(
  candidate: AssistCandidateRow,
  queryVector: readonly number[],
  modelPrefix: string,
): number | null {
  if (!(candidate.vector instanceof Buffer) || candidate.dimensions === null) {
    return null;
  }
  if (candidate.model && !candidate.model.startsWith(modelPrefix)) {
    return null;
  }

  const vector = blobToVector(candidate.vector, candidate.dimensions);
  return cosineSimilarity(queryVector, vector);
}

function resolveCategoryName(
  categories: readonly AnnotationCategory[],
  categoryId: string | null,
): string | null {
  if (!categoryId) {
    return null;
  }
  return categories.find((category) => category.id === categoryId)?.name ?? null;
}
