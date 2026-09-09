import type { DatabaseSync } from 'node:sqlite';
import { VISIBLE_ACCOUNT_TRANSACTIONS_WHERE } from '../db/account-links.js';
import { normalizeTransactionAmountInAccountCurrencyCents } from '../db/transaction-foreign-amount.js';
import { type AnnotationAssistProposal, coerceAssistProposal } from '../scoring/providers.js';
import { resolveLocalTimeZone, toLocalDateKey } from '../utils/local-date.js';
import type {
  AnnotationAssistExample,
  AnnotationAssistResult,
  AnnotationAssistStatus,
} from './assist-contract.js';
import { sanitizeAssistNotes } from './assist-proposal.js';
import {
  listPendingAssistSuggestionRows,
  type PendingAssistSuggestionRow,
  parseAssistExamples,
} from './pending-assist-suggestions.js';

export type AssistSuggestionReviewStatus = 'pending' | 'applied' | 'dismissed';

export const ASSIST_SUGGESTION_ALGORITHM_VERSION = 2;

export type StoredAssistSuggestion = {
  readonly entryType: 'transaction';
  readonly entryId: string;
  readonly status: AnnotationAssistStatus;
  readonly proposal: AnnotationAssistProposal | null;
  readonly examples: readonly AnnotationAssistExample[];
  readonly confidence: number | null;
  readonly usedClassifier: boolean;
  readonly embeddingModel: string | null;
  readonly classifierModel: string | null;
  readonly algorithmVersion: number;
  readonly computedAt: string;
  readonly reviewStatus: AssistSuggestionReviewStatus;
  readonly reviewedAt: string | null;
};

export type TriageQueueItem = StoredAssistSuggestion & {
  readonly accountId: string;
  readonly occurredAt: string;
  readonly localDate: string;
  readonly merchantName: string | null;
  readonly description: string | null;
  readonly amountCents: number;
  readonly currency: string;
  readonly accountCurrency: string;
  readonly amountInAccountCurrencyCents: number;
  readonly categoryId: string | null;
  readonly categoryOverrideId: string | null;
};

export function clearUnannotatedAssistSuggestions(db: DatabaseSync): number {
  const result = db
    .prepare(
      `DELETE FROM annotation_assist_suggestions
       WHERE entry_type = 'transaction'
         AND review_status = 'pending'
         AND entry_id IN (
           SELECT t.id
           FROM transactions t
           LEFT JOIN entry_annotations ea
             ON ea.entry_type = 'transaction' AND ea.entry_id = t.id
           WHERE ea.id IS NULL
             AND ${VISIBLE_ACCOUNT_TRANSACTIONS_WHERE}
         )`,
    )
    .run();
  return Number(result.changes);
}

export function upsertAssistSuggestion(db: DatabaseSync, suggestion: StoredAssistSuggestion): void {
  db.prepare(
    `INSERT INTO annotation_assist_suggestions (
      entry_type, entry_id, status, proposal_json, examples_json, confidence,
      used_classifier, embedding_model, classifier_model, computed_at,
      review_status, reviewed_at, algorithm_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_type, entry_id) DO UPDATE SET
      status = excluded.status,
      proposal_json = excluded.proposal_json,
      examples_json = excluded.examples_json,
      confidence = excluded.confidence,
      used_classifier = excluded.used_classifier,
      embedding_model = excluded.embedding_model,
      classifier_model = excluded.classifier_model,
      computed_at = excluded.computed_at,
      algorithm_version = excluded.algorithm_version,
      review_status = CASE
        WHEN annotation_assist_suggestions.review_status IN ('applied', 'dismissed')
        THEN annotation_assist_suggestions.review_status
        ELSE excluded.review_status
      END,
      reviewed_at = CASE
        WHEN annotation_assist_suggestions.review_status IN ('applied', 'dismissed')
        THEN annotation_assist_suggestions.reviewed_at
        ELSE excluded.reviewed_at
      END`,
  ).run(
    suggestion.entryType,
    suggestion.entryId,
    suggestion.status,
    suggestion.proposal ? JSON.stringify(suggestion.proposal) : null,
    JSON.stringify(suggestion.examples),
    suggestion.confidence,
    suggestion.usedClassifier ? 1 : 0,
    suggestion.embeddingModel,
    suggestion.classifierModel,
    suggestion.computedAt,
    suggestion.reviewStatus,
    suggestion.reviewedAt,
    suggestion.algorithmVersion,
  );
}

export function markAssistSuggestionReviewed(
  db: DatabaseSync,
  entryId: string,
  reviewStatus: Exclude<AssistSuggestionReviewStatus, 'pending'>,
): void {
  db.prepare(
    `UPDATE annotation_assist_suggestions
     SET review_status = ?, reviewed_at = ?
     WHERE entry_type = 'transaction' AND entry_id = ?`,
  ).run(reviewStatus, new Date().toISOString(), entryId);
}

export function listTriageQueue(
  db: DatabaseSync,
  options: { readonly limit: number; readonly offset: number },
): TriageQueueItem[] {
  const rows = listPendingAssistSuggestionRows(db, options);

  return rows.map(parseTriageRow);
}

export function loadAssistSuggestion(
  db: DatabaseSync,
  entryId: string,
): StoredAssistSuggestion | null {
  const row = db
    .prepare(
      `SELECT entry_type, entry_id, status, proposal_json, examples_json, confidence,
              used_classifier, embedding_model, classifier_model, computed_at,
              review_status, reviewed_at, algorithm_version
       FROM annotation_assist_suggestions
       WHERE entry_type = 'transaction' AND entry_id = ?`,
    )
    .get(entryId) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  return parseStoredSuggestion(row);
}

export function loadAssistSuggestions(
  db: DatabaseSync,
  entryIds: readonly string[],
): ReadonlyMap<string, StoredAssistSuggestion> {
  if (entryIds.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT entry_type, entry_id, status, proposal_json, examples_json, confidence,
              used_classifier, embedding_model, classifier_model, computed_at,
              review_status, reviewed_at, algorithm_version
       FROM annotation_assist_suggestions
       WHERE entry_type = 'transaction'
         AND entry_id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(entryIds)) as readonly Record<string, unknown>[];
  return new Map(
    rows.map((row) => {
      const suggestion = parseStoredSuggestion(row);
      return [suggestion.entryId, suggestion];
    }),
  );
}

export function presentStoredAssistSuggestion(
  suggestion: StoredAssistSuggestion,
  notesContext?: {
    readonly description: string | null;
    readonly merchantName: string | null;
  },
): AnnotationAssistResult {
  const proposal = suggestion.proposal
    ? {
        ...suggestion.proposal,
        notes: sanitizeAssistNotes(
          suggestion.proposal.notes,
          notesContext,
          suggestion.examples.map((example) => ({
            categoryOverrideId: example.categoryOverrideId,
            effectiveCategoryId: example.effectiveCategoryId,
            notes: example.notes,
            merchantName: example.merchantName,
            description: example.description,
            matchKind: example.matchKind,
          })),
        ),
      }
    : null;

  return {
    status: suggestion.status as AnnotationAssistStatus,
    examples: suggestion.examples,
    proposal,
    usedClassifier: suggestion.usedClassifier,
    confidence: suggestion.confidence,
  };
}

function parseTriageRow(row: PendingAssistSuggestionRow): TriageQueueItem {
  if (row.proposal.kind === 'invalid') {
    throw new Error(row.proposal.reason);
  }

  const base: StoredAssistSuggestion = {
    entryType: row.entryType,
    entryId: row.entryId,
    status: row.status,
    proposal: row.proposal.value,
    examples: row.examples,
    confidence: row.confidence,
    usedClassifier: row.usedClassifier,
    embeddingModel: row.embeddingModel,
    classifierModel: row.classifierModel,
    algorithmVersion: row.algorithmVersion,
    computedAt: row.computedAt,
    reviewStatus: row.reviewStatus,
    reviewedAt: row.reviewedAt,
  };
  const merchantName = row.merchantName;
  const description = row.description;
  const notesContext = { description, merchantName };
  const amountInAccountCurrencyCents = normalizeTransactionAmountInAccountCurrencyCents(
    row.amountInAccountCurrencyCents,
    row.amountCents,
  );
  const currency = row.currency;
  const accountCurrency = row.accountCurrency || currency;

  return {
    ...base,
    accountId: row.accountId,
    occurredAt: row.occurredAt,
    localDate: toLocalDateKey(row.occurredAt, resolveLocalTimeZone()),
    merchantName,
    description,
    amountCents: row.amountCents,
    currency,
    accountCurrency,
    amountInAccountCurrencyCents,
    categoryId: row.categoryId,
    categoryOverrideId: row.categoryOverrideId,
    proposal: base.proposal
      ? {
          ...base.proposal,
          notes: sanitizeAssistNotes(
            base.proposal.notes,
            notesContext,
            base.examples.map((example) => ({
              categoryOverrideId: example.categoryOverrideId,
              effectiveCategoryId: example.effectiveCategoryId,
              notes: example.notes,
              merchantName: example.merchantName,
              description: example.description,
              matchKind: example.matchKind,
            })),
          ),
        }
      : null,
  };
}

function parseStoredSuggestion(row: Record<string, unknown>): StoredAssistSuggestion {
  const proposalRaw = row['proposal_json'];
  const examplesRaw = row['examples_json'];
  return {
    entryType: 'transaction',
    entryId: String(row['entry_id']),
    status: String(row['status']) as AnnotationAssistStatus,
    proposal:
      typeof proposalRaw === 'string' && proposalRaw.trim()
        ? coerceAssistProposal(JSON.parse(proposalRaw))
        : null,
    examples: parseAssistExamples(examplesRaw, String(row['entry_id'])),
    confidence: typeof row['confidence'] === 'number' ? row['confidence'] : null,
    usedClassifier: Number(row['used_classifier']) === 1,
    embeddingModel: typeof row['embedding_model'] === 'string' ? row['embedding_model'] : null,
    classifierModel: typeof row['classifier_model'] === 'string' ? row['classifier_model'] : null,
    algorithmVersion: Number(row['algorithm_version']),
    computedAt: String(row['computed_at']),
    reviewStatus: String(row['review_status']) as AssistSuggestionReviewStatus,
    reviewedAt: typeof row['reviewed_at'] === 'string' ? row['reviewed_at'] : null,
  };
}
