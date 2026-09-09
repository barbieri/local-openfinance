import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import {
  createStrongPeerPolicy,
  type PeerDocumentKeys,
  readPeerDocumentField,
  resolveStrongSharedPeerDocumentKey,
  type StrongPeerAmountSign,
  type StrongPeerDocumentField,
} from '../peer-policy.js';
import { VISIBLE_ACCOUNT_TRANSACTIONS_WHERE } from './account-links.js';
import { buildCategoryIndex } from './category-display.js';
import { loadCreditCardBillLinksForTransactions } from './credit-card-bill-links.js';
import {
  type EnrichedTransaction,
  enrichTransactionRow,
  loadTransactionRowById,
  type TransactionRow,
} from './transaction-details.js';
import {
  buildTransactionCommonWhere,
  TRANSACTION_FILTERED_FROM_SQL,
  type TransactionCommonSqlFilters,
  transactionOccurredAtSql,
} from './transaction-filter-sql.js';
import { TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL } from './transaction-foreign-amount.js';

export const TRANSACTION_HISTORY_AGGREGATE_CAP = 50;

export type TransactionHistoryScope = TransactionCommonSqlFilters;

export type TransactionHistoryPageOptions = {
  readonly limit: number;
  readonly offset: number;
  readonly timeZone?: string | undefined;
  readonly locale?: string | undefined;
};

export type TransactionHistoryPageResult = {
  readonly rows: readonly EnrichedTransaction[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly anchorAccountId: string;
  readonly sharedCounterpartyIds: ReadonlySet<string>;
};

export type TransactionHistoryAggregateQuery = {
  readonly scope: TransactionHistoryScope;
  readonly dimension: 'category' | 'label';
  readonly anchor: TransactionHistoryAnchor;
};

export type TransactionHistoryAnchor = Pick<
  EnrichedTransaction,
  'id' | 'category_id' | 'category_override_id' | 'annotation'
>;

export type TransactionHistoryAggregate = {
  readonly key: string;
  readonly currency: string;
  readonly transactionCount: number;
  readonly totalCents: number;
  readonly firstDate: string | null;
  readonly lastDate: string | null;
};

export type TransactionHistoryAggregateResult = {
  readonly keys: readonly string[];
  readonly rows: readonly TransactionHistoryAggregate[];
  readonly cap: number;
  readonly truncated: boolean;
};

type StrongPeerSqlPredicate = {
  readonly sql: string;
  readonly params: readonly SQLInputValue[];
};

type EffectiveCategoryTerm =
  | {
      readonly source: 'annotation';
      readonly field: 'subCategoryId' | 'categoryId';
      readonly sql: string;
    }
  | {
      readonly source: 'transaction';
      readonly field: 'category_override_id' | 'category_id';
      readonly sql: string;
    };

const EFFECTIVE_CATEGORY_TERMS = [
  { source: 'annotation', field: 'subCategoryId', sql: 'ea.sub_category_id' },
  { source: 'annotation', field: 'categoryId', sql: 'ea.category_id' },
  { source: 'transaction', field: 'category_override_id', sql: 'tco.category_id' },
  { source: 'transaction', field: 'category_id', sql: 't.category_id' },
] as const satisfies readonly EffectiveCategoryTerm[];

const EFFECTIVE_CATEGORY_ID_SQL = `COALESCE(${EFFECTIVE_CATEGORY_TERMS.map((term) => term.sql).join(', ')})`;

function resolveAnchorDimensionKeys(
  anchor: TransactionHistoryAnchor,
  dimension: TransactionHistoryAggregateQuery['dimension'],
): readonly string[] {
  if (dimension === 'category') {
    const key = resolveEffectiveCategoryId(anchor);
    return key ? [key] : [];
  }
  return anchor.annotation?.labelIds ?? [];
}

function resolveEffectiveCategoryId(anchor: TransactionHistoryAnchor): string | null {
  for (const term of EFFECTIVE_CATEGORY_TERMS) {
    const key = term.source === 'annotation' ? anchor.annotation?.[term.field] : anchor[term.field];
    if (key !== null && key !== undefined) return key;
  }
  return null;
}

export function listEnrichedTransactionHistoryPage(
  db: DatabaseSync,
  scope: TransactionHistoryScope,
  options: TransactionHistoryPageOptions,
  anchorTransactionId: string,
): TransactionHistoryPageResult | null {
  const anchor = db
    .prepare(
      `SELECT account_id, amount_cents, payer_document_key, receiver_document_key,
              merchant_document_key,
              EXISTS (
                SELECT 1
                FROM transfer_group_members tgm
                WHERE tgm.entry_type = 'transaction' AND tgm.entry_id = transactions.id
              ) AS is_transfer_member
       FROM transactions WHERE id = ?`,
    )
    .get(anchorTransactionId) as
    | {
        readonly account_id: string;
        readonly amount_cents: number;
        readonly payer_document_key: string | null;
        readonly receiver_document_key: string | null;
        readonly merchant_document_key: string | null;
        readonly is_transfer_member: number;
      }
    | undefined;
  if (!anchor) {
    return null;
  }

  const timeZone = options.timeZone ?? 'UTC';
  const anchorKeys = transactionDocumentKeys(anchor);
  const strongPeer = buildStrongPeerSqlPredicate(anchorKeys, anchor.amount_cents, 't');
  const crossAccountPeerSql = anchor.is_transfer_member
    ? '0'
    : `(NOT EXISTS (
         SELECT 1
         FROM transfer_group_members tgm
         WHERE tgm.entry_type = 'transaction' AND tgm.entry_id = t.id
       ) AND ${strongPeer.sql})`;
  const baseWhere = buildTransactionHistoryWhere(scope, timeZone);
  const where = {
    sql: `${baseWhere.sql} AND t.id <> ? AND (t.account_id = ? OR ${crossAccountPeerSql})`,
    params: [
      ...baseWhere.params,
      anchorTransactionId,
      anchor.account_id,
      ...(anchor.is_transfer_member ? [] : strongPeer.params),
    ],
  };
  const fromSql = `
    ${TRANSACTION_FILTERED_FROM_SQL}
    WHERE ${VISIBLE_ACCOUNT_TRANSACTIONS_WHERE} ${where.sql}`;
  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS total ${fromSql}`).get(...where.params) as { total: number })
      .total,
  );
  const pageRows = db
    .prepare(
      `SELECT t.id, t.account_id, t.amount_cents, t.payer_document_key,
              t.receiver_document_key, t.merchant_document_key,
              EXISTS (
                SELECT 1
                FROM transfer_group_members tgm
                WHERE tgm.entry_type = 'transaction' AND tgm.entry_id = t.id
              ) AS is_transfer_member
       ${fromSql}
       ORDER BY ${transactionOccurredAtSql(scope.useCreditPurchaseDate)} DESC, t.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...where.params, options.limit, options.offset) as Array<{
    readonly id: string;
    readonly account_id: string;
    readonly amount_cents: number;
    readonly payer_document_key: string | null;
    readonly receiver_document_key: string | null;
    readonly merchant_document_key: string | null;
    readonly is_transfer_member: number;
  }>;

  const sharedCounterpartyIds = new Set<string>();
  for (const candidate of pageRows) {
    if (
      !anchor.is_transfer_member &&
      !candidate.is_transfer_member &&
      resolveStrongSharedPeerDocumentKey(
        anchorKeys,
        anchor.amount_cents,
        transactionDocumentKeys(candidate),
        candidate.amount_cents,
      ) !== null
    ) {
      sharedCounterpartyIds.add(candidate.id);
    }
  }

  const ids = pageRows.map((candidate) => candidate.id);
  const categoryIndex = buildCategoryIndex(db);
  const billLinks = loadCreditCardBillLinksForTransactions(db, ids);
  const rows = ids
    .map((id) => loadTransactionRowById(db, id))
    .filter((row): row is TransactionRow => row !== null)
    .map((row) =>
      enrichTransactionRow(db, row, timeZone, categoryIndex, {
        useCreditPurchaseDate: scope.useCreditPurchaseDate,
        billLink: billLinks.get(row.id) ?? null,
        locale: options.locale,
      }),
    );

  return {
    rows,
    total,
    limit: options.limit,
    offset: options.offset,
    anchorAccountId: anchor.account_id,
    sharedCounterpartyIds,
  };
}

export function aggregateTransactionHistory(
  db: DatabaseSync,
  query: TransactionHistoryAggregateQuery,
  timeZone: string,
): TransactionHistoryAggregateResult {
  const resolvedKeys = resolveAnchorDimensionKeys(query.anchor, query.dimension);
  const keys = resolvedKeys.slice(0, TRANSACTION_HISTORY_AGGREGATE_CAP);
  const truncatedByKeys = resolvedKeys.length > TRANSACTION_HISTORY_AGGREGATE_CAP;
  if (keys.length === 0) {
    return {
      keys,
      rows: [],
      cap: TRANSACTION_HISTORY_AGGREGATE_CAP,
      truncated: false,
    };
  }

  const where = buildTransactionHistoryWhere(query.scope, timeZone);
  const dimensionSql = query.dimension === 'category' ? EFFECTIVE_CATEGORY_ID_SQL : 'eal.label_id';
  const joins =
    query.dimension === 'label'
      ? "LEFT JOIN entry_annotations ea ON ea.entry_type = 'transaction' AND ea.entry_id = t.id JOIN entry_annotation_labels eal ON eal.annotation_id = ea.id"
      : "LEFT JOIN entry_annotations ea ON ea.entry_type = 'transaction' AND ea.entry_id = t.id";
  const occurredAtSql = transactionOccurredAtSql(query.scope.useCreditPurchaseDate);
  const rows = db
    .prepare(
      `SELECT ${dimensionSql} AS key, a.currency AS currency,
              COUNT(*) AS transaction_count,
              SUM(ABS(${TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL})) AS total_cents,
              MIN(${occurredAtSql}) AS first_date, MAX(${occurredAtSql}) AS last_date
       ${TRANSACTION_FILTERED_FROM_SQL}
       ${joins}
       WHERE ${VISIBLE_ACCOUNT_TRANSACTIONS_WHERE} ${where.sql}
         AND ${dimensionSql} IS NOT NULL
         AND ${dimensionSql} IN (${keys.map(() => '?').join(', ')})
       GROUP BY ${dimensionSql}, a.currency
       ORDER BY total_cents DESC, key ASC
       LIMIT ?`,
    )
    .all(...where.params, ...keys, TRANSACTION_HISTORY_AGGREGATE_CAP + 1) as Array<{
    readonly key: string;
    readonly currency: string;
    readonly transaction_count: number;
    readonly total_cents: number;
    readonly first_date: string | null;
    readonly last_date: string | null;
  }>;
  const truncated = truncatedByKeys || rows.length > TRANSACTION_HISTORY_AGGREGATE_CAP;
  return {
    keys,
    rows: rows.slice(0, TRANSACTION_HISTORY_AGGREGATE_CAP).map((row) => ({
      key: row.key,
      currency: row.currency,
      transactionCount: Number(row.transaction_count),
      totalCents: Number(row.total_cents),
      firstDate: row.first_date,
      lastDate: row.last_date,
    })),
    cap: TRANSACTION_HISTORY_AGGREGATE_CAP,
    truncated,
  };
}

function buildTransactionHistoryWhere(
  scope: TransactionHistoryScope,
  timeZone: string,
): { readonly sql: string; readonly params: SQLInputValue[] } {
  return buildTransactionCommonWhere(scope, timeZone);
}

export function buildStrongPeerSqlPredicate(
  targetKeys: PeerDocumentKeys,
  targetAmountCents: number,
  candidateTableAlias: 't',
): StrongPeerSqlPredicate {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  for (const term of createStrongPeerPolicy(targetAmountCents)) {
    const targetKey = readPeerDocumentField(targetKeys, term.targetField);
    if (!targetKey) {
      continue;
    }
    const signClause = amountSignSql(candidateTableAlias, term.candidateAmountSign);
    if (term.candidateField === 'counterpartyDocumentKey') {
      clauses.push(`(
        ((${candidateTableAlias}.amount_cents < 0 AND ${candidateTableAlias}.receiver_document_key = ?)
          OR (${candidateTableAlias}.amount_cents > 0 AND ${candidateTableAlias}.payer_document_key = ?))
        ${signClause}
      )`);
      params.push(targetKey, targetKey);
      continue;
    }
    clauses.push(
      `(${documentFieldColumn(candidateTableAlias, term.candidateField)} = ?${signClause})`,
    );
    params.push(targetKey);
  }
  return {
    sql: clauses.length > 0 ? `(${clauses.join(' OR ')})` : '0',
    params,
  };
}

function transactionDocumentKeys(row: {
  readonly payer_document_key: string | null;
  readonly receiver_document_key: string | null;
  readonly merchant_document_key: string | null;
}): PeerDocumentKeys {
  return {
    payerDocumentKey: row.payer_document_key,
    receiverDocumentKey: row.receiver_document_key,
    merchantDocumentKey: row.merchant_document_key,
  };
}

function documentFieldColumn(alias: 't', field: StrongPeerDocumentField): string {
  switch (field) {
    case 'payerDocumentKey':
      return `${alias}.payer_document_key`;
    case 'receiverDocumentKey':
      return `${alias}.receiver_document_key`;
    case 'merchantDocumentKey':
      return `${alias}.merchant_document_key`;
  }
}

function amountSignSql(alias: 't', sign: StrongPeerAmountSign): string {
  if (sign === 'negative') {
    return ` AND ${alias}.amount_cents < 0`;
  }
  if (sign === 'positive') {
    return ` AND ${alias}.amount_cents > 0`;
  }
  return '';
}
