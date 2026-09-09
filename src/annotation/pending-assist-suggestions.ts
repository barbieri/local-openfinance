import type { DatabaseSync } from 'node:sqlite';
import { VISIBLE_ACCOUNT_TRANSACTIONS_WHERE } from '../db/account-links.js';
import { type AnnotationAssistProposal, coerceAssistProposal } from '../scoring/providers.js';
import {
  type AnnotationAssistExample,
  type AnnotationAssistStatus,
  annotationAssistExampleSchema,
} from './assist-contract.js';

export type PendingAssistSuggestionRow = {
  readonly entryType: 'transaction';
  readonly entryId: string;
  readonly status: AnnotationAssistStatus;
  readonly proposal: PendingAssistProposalParseResult;
  readonly examples: readonly AnnotationAssistExample[];
  readonly usedClassifier: boolean;
  readonly embeddingModel: string | null;
  readonly classifierModel: string | null;
  readonly reviewStatus: 'pending';
  readonly reviewedAt: string | null;
  readonly algorithmVersion: number;
  readonly occurredAt: string;
  readonly accountId: string;
  readonly description: string | null;
  readonly merchantName: string | null;
  readonly amountCents: number;
  readonly amountInAccountCurrencyCents: number | null;
  readonly currency: string;
  readonly accountCurrency: string;
  readonly categoryId: string | null;
  readonly categoryOverrideId: string | null;
  readonly confidence: number | null;
  readonly computedAt: string;
};

export type PendingAssistSuggestionDigestRow = {
  readonly entryId: string;
  readonly annotationId: string | null;
  readonly proposal: PendingAssistProposalParseResult;
  readonly occurredAt: string;
  readonly description: string | null;
  readonly merchantName: string | null;
  readonly amountCents: number;
  readonly amountInAccountCurrencyCents: number | null;
  readonly accountCurrency: string;
  readonly categoryId: string | null;
  readonly categoryOverrideId: string | null;
  readonly confidence: number | null;
};

export type PendingAssistProposalParseResult =
  | { readonly kind: 'valid'; readonly value: AnnotationAssistProposal }
  | { readonly kind: 'invalid'; readonly reason: string };

const PENDING_ASSIST_SUGGESTIONS_FROM = `
  FROM annotation_assist_suggestions s
  JOIN transactions t ON t.id = s.entry_id
  JOIN accounts a ON a.id = t.account_id
`;

const PENDING_ASSIST_SUGGESTIONS_WHERE = `
  WHERE s.entry_type = 'transaction'
    AND s.review_status = 'pending'
    AND s.status = 'ok'
    AND s.proposal_json IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM entry_annotations ea
      WHERE ea.entry_type = 'transaction' AND ea.entry_id = t.id
    )
    AND ${VISIBLE_ACCOUNT_TRANSACTIONS_WHERE}`;

const PENDING_ASSIST_SUGGESTIONS_CTE = `
WITH pending_assist_suggestions AS (
  SELECT s.entry_type, s.entry_id, s.status, s.proposal_json, s.examples_json,
         s.used_classifier, s.embedding_model, s.classifier_model,
         s.review_status, s.reviewed_at, s.algorithm_version,
         t.occurred_at, t.account_id, t.description, t.merchant_name,
         t.amount_cents, t.amount_in_account_currency_cents, t.currency,
         a.currency AS account_currency,
         t.category_id AS category_id,
         tco.category_id AS category_override_id,
         s.confidence, s.computed_at
  ${PENDING_ASSIST_SUGGESTIONS_FROM}
  LEFT JOIN transaction_category_overrides tco ON tco.transaction_id = t.id
  ${PENDING_ASSIST_SUGGESTIONS_WHERE}
)`;

export function listPendingAssistSuggestionEntryIds(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      `SELECT s.entry_id AS entry_id
       ${PENDING_ASSIST_SUGGESTIONS_FROM}
       ${PENDING_ASSIST_SUGGESTIONS_WHERE}
       ORDER BY t.occurred_at DESC, s.entry_id ASC`,
    )
    .all() as { readonly entry_id: string }[];
  return rows.map((row) => row.entry_id);
}

export function listPendingAssistSuggestionDigestRows(
  db: DatabaseSync,
): PendingAssistSuggestionDigestRow[] {
  const rows = db
    .prepare(
      `SELECT s.entry_id AS entry_id, ea.id AS annotation_id, s.proposal_json AS proposal_json,
              t.occurred_at, t.description, t.merchant_name,
              t.amount_cents, t.amount_in_account_currency_cents,
              a.currency AS account_currency,
              t.category_id AS category_id,
              tco.category_id AS category_override_id,
              s.confidence
       ${PENDING_ASSIST_SUGGESTIONS_FROM}
       LEFT JOIN entry_annotations ea ON ea.entry_type = 'transaction' AND ea.entry_id = t.id
       LEFT JOIN transaction_category_overrides tco ON tco.transaction_id = t.id
       ${PENDING_ASSIST_SUGGESTIONS_WHERE}
       ORDER BY t.occurred_at DESC, s.entry_id ASC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(mapPendingAssistSuggestionDigestRow);
}

function mapPendingAssistSuggestionDigestRow(
  row: Record<string, unknown>,
): PendingAssistSuggestionDigestRow {
  const entryId = String(row['entry_id']);
  return {
    entryId,
    annotationId: typeof row['annotation_id'] === 'string' ? row['annotation_id'] : null,
    proposal: parsePendingAssistProposal(row['proposal_json'], entryId),
    occurredAt: String(row['occurred_at']),
    description: nullableString(row['description']),
    merchantName: nullableString(row['merchant_name']),
    amountCents: Number(row['amount_cents']),
    amountInAccountCurrencyCents: nullableNumber(row['amount_in_account_currency_cents']),
    accountCurrency: String(row['account_currency']),
    categoryId: nullableString(row['category_id']),
    categoryOverrideId: nullableString(row['category_override_id']),
    confidence: nullableNumber(row['confidence']),
  };
}

export function listPendingAssistSuggestionRows(
  db: DatabaseSync,
  options: { readonly limit?: number; readonly offset?: number } = {},
): PendingAssistSuggestionRow[] {
  const rows = db
    .prepare(
      `${PENDING_ASSIST_SUGGESTIONS_CTE}
       SELECT * FROM pending_assist_suggestions
       ORDER BY occurred_at DESC, entry_id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(options.limit ?? -1, options.offset ?? 0) as Record<string, unknown>[];
  return rows.map(mapPendingAssistSuggestionRow);
}

export function countPendingAssistSuggestions(db: DatabaseSync): number {
  const row = db
    .prepare(
      `${PENDING_ASSIST_SUGGESTIONS_CTE}
       SELECT COUNT(*) AS count FROM pending_assist_suggestions`,
    )
    .get() as { readonly count: number };
  return row.count;
}

function mapPendingAssistSuggestionRow(row: Record<string, unknown>): PendingAssistSuggestionRow {
  const entryId = String(row['entry_id']);
  return {
    entryType: 'transaction',
    entryId,
    status: String(row['status']) as AnnotationAssistStatus,
    proposal: parsePendingAssistProposal(row['proposal_json'], entryId),
    examples: parseAssistExamples(row['examples_json'], entryId),
    usedClassifier: Number(row['used_classifier']) === 1,
    embeddingModel: nullableString(row['embedding_model']),
    classifierModel: nullableString(row['classifier_model']),
    reviewStatus: 'pending',
    reviewedAt: nullableString(row['reviewed_at']),
    algorithmVersion: Number(row['algorithm_version']),
    occurredAt: String(row['occurred_at']),
    accountId: String(row['account_id']),
    description: nullableString(row['description']),
    merchantName: nullableString(row['merchant_name']),
    amountCents: Number(row['amount_cents']),
    amountInAccountCurrencyCents: nullableNumber(row['amount_in_account_currency_cents']),
    currency: String(row['currency']),
    accountCurrency: String(row['account_currency']),
    categoryId: nullableString(row['category_id']),
    categoryOverrideId: nullableString(row['category_override_id']),
    confidence: nullableNumber(row['confidence']),
    computedAt: String(row['computed_at']),
  };
}

function parsePendingAssistProposal(
  value: unknown,
  entryId: string,
): PendingAssistProposalParseResult {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return {
      kind: 'invalid',
      reason: `Pending assist suggestion ${entryId} has no proposal JSON`,
    };
  }

  try {
    const proposal = coerceAssistProposal(JSON.parse(value));
    return proposal
      ? { kind: 'valid', value: proposal }
      : {
          kind: 'invalid',
          reason: `Pending assist suggestion ${entryId} contains an invalid proposal`,
        };
  } catch (error) {
    return {
      kind: 'invalid',
      reason: `Pending assist suggestion ${entryId} contains malformed proposal JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export function parseAssistExamples(value: unknown, entryId: string): AnnotationAssistExample[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Pending assist suggestion ${entryId} contains malformed examples JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Pending assist suggestion ${entryId} examples must be an array`);
  }
  const result = annotationAssistExampleSchema.array().safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Pending assist suggestion ${entryId} contains invalid examples: ${result.error.message}`,
    );
  }
  return result.data;
}
