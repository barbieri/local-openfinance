import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { resolveCategoryTranslationEnabled } from '../utils/locale-resolve.js';
import { VISIBLE_ACCOUNT_TRANSACTIONS_WHERE } from './account-links.js';
import {
  buildCategoryIndex,
  type CategoryIndexEntry,
  categoryMatchesParentFilter,
} from './category-display.js';
import { loadCreditCardBillLinksForTransactions } from './credit-card-bill-links.js';
import {
  appendDeletedVisibilityPredicate,
  DELETED_VISIBILITIES,
  type DeletedVisibility,
} from './entry-deletion.js';
import { resolveTransactionLocalDate } from './transaction-date-basis.js';
import {
  type EnrichedTransaction,
  enrichTransactionRow,
  loadTransactionRowById,
  type TransactionListFilters,
  type TransactionRow,
} from './transaction-details.js';
import {
  appendAccountFilter,
  appendTransactionCommonFilters,
  appendTransactionDateBounds,
  TRANSACTION_FILTERED_FROM_SQL,
  type TransactionClassificationFilter,
  type TransactionCommonSqlFilters,
  transactionOccurredAtSql,
} from './transaction-filter-sql.js';
import {
  TRANSACTION_ACCOUNTING_AMOUNT_CENTS_SQL,
  type TransactionSummary,
} from './transaction-foreign-amount.js';
import { buildTransactionFtsMatch, type TransactionFtsColumn } from './transaction-fts.js';

export type {
  TransactionClassificationFilter,
  TransactionCommonSqlFilters,
} from './transaction-filter-sql.js';
export {
  buildTransactionCommonWhere,
  resolveTransactionLocalDateEndIso,
  resolveTransactionLocalDateStartIso,
  resolveTransactionOccurredAtLowerBound,
  resolveTransactionOccurredAtUpperBound,
  TRANSACTION_CREDIT_PURCHASE_DATE_SQL,
  transactionOccurredAtSql,
} from './transaction-filter-sql.js';

export type TransactionInstallmentsFilter = 'all' | 'hide' | 'only';

export type TransactionWebListFilters = TransactionListFilters &
  TransactionCommonSqlFilters & {
    readonly labelIds: readonly string[] | 'all';
    readonly transfers: 'all' | 'hide' | 'only';
    readonly installments: TransactionInstallmentsFilter;
    readonly classification: TransactionClassificationFilter;
    readonly searchQuery: string | null;
    readonly merchantQuery: string | null;
    readonly descriptionQuery: string | null;
    readonly billId: string | null;
    readonly useCreditPurchaseDate: boolean;
    readonly minAbsoluteAmountCents: number | null;
    readonly deletedVisibility: DeletedVisibility;
  };

export function createTransactionWebListFilters(
  overrides: Partial<TransactionWebListFilters> = {},
): TransactionWebListFilters {
  return {
    status: 'all',
    transactionIds: 'all',
    accountIds: 'all',
    categoryIds: 'all',
    merchantPattern: null,
    merchantQuery: null,
    descriptionQuery: null,
    paymentTypes: 'all',
    labelIds: 'all',
    transfers: 'all',
    installments: 'all',
    classification: 'all',
    searchQuery: null,
    startDate: null,
    endDate: null,
    billId: null,
    useCreditPurchaseDate: false,
    minAbsoluteAmountCents: null,
    deletedVisibility: 'hide',
    ...overrides,
  };
}

export type TransactionSortSpec = {
  readonly column: string;
  readonly descending: boolean;
};

export type TransactionListPageOptions = {
  readonly limit: number;
  readonly offset: number;
  readonly sort: TransactionSortSpec;
  readonly groupByDate?: boolean | undefined;
  readonly timeZone?: string | undefined;
  readonly locale?: string | undefined;
};

export type TransactionListPageResult = {
  readonly rows: readonly EnrichedTransaction[];
  readonly total: number;
  readonly summary: readonly TransactionSummary[];
  readonly pageCount: number;
  readonly limit: number;
  readonly offset: number;
};

const DEFAULT_SORT: TransactionSortSpec = { column: 'date', descending: true };

const SORTABLE_COLUMN_BUILDERS: Record<string, (filters: TransactionWebListFilters) => string> = {
  date: (filters) => transactionOccurredAtSql(filters.useCreditPurchaseDate),
  account: () => 't.account_id',
  merchant: () => 't.merchant_name',
  description: () => `COALESCE(
    (SELECT NULLIF(TRIM(ea.notes), '')
     FROM entry_annotations ea
     WHERE ea.entry_type = 'transaction' AND ea.entry_id = t.id
     LIMIT 1),
    t.description
  )`,
  amount: () => TRANSACTION_ACCOUNTING_AMOUNT_CENTS_SQL,
  category: () => 'COALESCE(tco.category_id, t.category_id)',
};

export function parseTransactionSort(value: string | undefined): TransactionSortSpec {
  if (!value || value.trim().length === 0) {
    return DEFAULT_SORT;
  }

  const [columnRaw, directionRaw] = value.split(':');
  const column = columnRaw?.trim() ?? 'date';
  const descending = (directionRaw?.trim().toLowerCase() ?? 'desc') !== 'asc';
  if (!SORTABLE_COLUMN_BUILDERS[column]) {
    return DEFAULT_SORT;
  }

  return { column, descending };
}

export function listEnrichedTransactionsPage(
  db: DatabaseSync,
  filters: TransactionWebListFilters,
  options: TransactionListPageOptions,
): TransactionListPageResult {
  const timeZone = options.timeZone ?? 'UTC';
  const categoryIndex = buildCategoryIndex(db, {
    translateNames: resolveCategoryTranslationEnabled(options.locale),
  });
  const where = buildTransactionListWhere(filters, categoryIndex, timeZone);
  const orderBy = buildTransactionOrderBy(options.sort, filters);

  return queryTransactionPage(db, where, orderBy, options, timeZone, categoryIndex, filters);
}

export function listFilteredTransactionIds(
  db: DatabaseSync,
  filters: TransactionWebListFilters,
  timeZone = 'UTC',
): readonly string[] {
  const categoryIndex = buildCategoryIndex(db);
  const where = buildTransactionListWhere(filters, categoryIndex, timeZone);
  const fromSql = `
    ${TRANSACTION_FILTERED_FROM_SQL}
    WHERE ${VISIBLE_ACCOUNT_TRANSACTIONS_WHERE}
      ${where.sql}`;

  return db
    .prepare(`SELECT t.id ${fromSql} ORDER BY t.occurred_at ASC`)
    .all(...where.params)
    .map((row) => String((row as Record<string, unknown>)['id']));
}

function queryTransactionPage(
  db: DatabaseSync,
  where: { readonly sql: string; readonly params: SQLInputValue[] },
  orderBy: string,
  options: TransactionListPageOptions,
  timeZone: string,
  categoryIndex: ReadonlyMap<string, CategoryIndexEntry>,
  filters: TransactionWebListFilters,
): TransactionListPageResult {
  const fromSql = `
    ${TRANSACTION_FILTERED_FROM_SQL}
    WHERE ${VISIBLE_ACCOUNT_TRANSACTIONS_WHERE}
      ${where.sql}`;

  const countSql = `SELECT COUNT(*) AS total ${fromSql}`;
  const total = Number(
    (db.prepare(countSql).get(...where.params) as { readonly total: number }).total,
  );

  const summary = db
    .prepare(`
    SELECT a.currency AS currency, COUNT(*) AS total,
      SUM(CASE WHEN ${TRANSACTION_ACCOUNTING_AMOUNT_CENTS_SQL} < 0 THEN 1 ELSE 0 END) AS debitCount,
      SUM(CASE WHEN ${TRANSACTION_ACCOUNTING_AMOUNT_CENTS_SQL} > 0 THEN 1 ELSE 0 END) AS creditCount,
      SUM(MIN(${TRANSACTION_ACCOUNTING_AMOUNT_CENTS_SQL}, 0)) AS debitCents,
      SUM(MAX(${TRANSACTION_ACCOUNTING_AMOUNT_CENTS_SQL}, 0)) AS creditCents,
      SUM(${TRANSACTION_ACCOUNTING_AMOUNT_CENTS_SQL}) AS balanceCents
    ${fromSql} GROUP BY a.currency ORDER BY a.currency
  `)
    .all(...where.params) as TransactionSummary[];

  let actualOffset = options.offset;
  let pageCount = Math.ceil(total / options.limit);
  let pageWhere = '';
  let pageOrderBy = orderBy;
  let pageParams: SQLInputValue[] = [options.limit, options.offset];
  let paginationSql = 'LIMIT ? OFFSET ?';
  if (options.groupByDate) {
    db.function('lof_transaction_local_date', { deterministic: true }, (value, zone) =>
      resolveTransactionLocalDate(String(value), String(zone)),
    );
    const dateSql = `lof_transaction_local_date(${transactionOccurredAtSql(filters.useCreditPurchaseDate)}, ?)`;
    const direction = options.sort.column === 'date' && !options.sort.descending ? 'ASC' : 'DESC';
    const days = db
      .prepare(`SELECT ${dateSql} AS day, COUNT(*) AS count
      ${fromSql} GROUP BY day ORDER BY day ${direction}`)
      .all(timeZone, ...where.params) as { day: string; count: number }[];
    const pages = packTransactionDatePages(days, options.limit);
    pageCount = pages.length;
    const requestedPage = Math.floor(options.offset / options.limit);
    const selectedDays = pages[requestedPage] ?? [];
    const previousDays = new Set(pages.slice(0, requestedPage).flat());
    actualOffset = days.reduce(
      (count, day) => count + (previousDays.has(day.day) ? day.count : 0),
      0,
    );
    const chronologicalDays = selectedDays.toSorted();
    const dateParts: string[] = [];
    pageParams = [];
    appendTransactionDateBounds(
      dateParts,
      pageParams,
      {
        startDate: chronologicalDays[0] ?? null,
        endDate: chronologicalDays.at(-1) ?? null,
        useCreditPurchaseDate: filters.useCreditPurchaseDate,
      },
      timeZone,
    );
    pageWhere = selectedDays.length > 0 ? `AND ${dateParts.join(' AND ')}` : 'AND 0';
    pageOrderBy = `${dateSql} ${direction}, ${orderBy}`;
    pageParams.push(timeZone);
    paginationSql = '';
  }
  const ids = db
    .prepare(`SELECT t.id ${fromSql} ${pageWhere}
    ORDER BY ${pageOrderBy} ${paginationSql}`)
    .all(...where.params, ...pageParams)
    .map((row) => String(row['id']));

  const categoryIndexReadonly: ReadonlyMap<string, CategoryIndexEntry> = categoryIndex;
  const billLinks = loadCreditCardBillLinksForTransactions(db, ids);
  const rows = ids
    .map((id) => loadTransactionRowById(db, id))
    .filter((row): row is TransactionRow => row !== null)
    .map((row) =>
      enrichTransactionRow(db, row, timeZone, categoryIndexReadonly, {
        useCreditPurchaseDate: filters.useCreditPurchaseDate,
        billLink: billLinks.get(row.id) ?? null,
        locale: options.locale,
      }),
    );

  return {
    rows,
    total,
    summary,
    pageCount,
    limit: options.limit,
    offset: actualOffset,
  };
}

function packTransactionDatePages(
  days: readonly { readonly day: string; readonly count: number }[],
  targetSize: number,
): string[][] {
  const pages: string[][] = [];
  let currentDays: string[] = [];
  let currentCount = 0;
  for (const day of days) {
    currentDays.push(day.day);
    currentCount += day.count;
    if (currentCount >= targetSize) {
      pages.push(currentDays);
      currentDays = [];
      currentCount = 0;
    }
  }
  if (currentDays.length > 0) pages.push(currentDays);
  return pages;
}

export function buildTransactionBalanceScopeWhere(
  filters: Pick<TransactionWebListFilters, 'accountIds' | 'deletedVisibility'>,
  accountIdColumn = 't.account_id',
  includeDeletedVisibility = true,
): { readonly sql: string; readonly params: SQLInputValue[] } {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  appendAccountFilter(parts, params, filters.accountIds, accountIdColumn);
  if (includeDeletedVisibility) {
    appendDeletedVisibilityPredicate(parts, 't.deleted_at', filters.deletedVisibility);
  }
  return {
    sql: parts.length > 0 ? `AND ${parts.join(' AND ')}` : '',
    params,
  };
}

export function buildTransactionListWhere(
  filters: TransactionWebListFilters,
  categoryIndex: ReadonlyMap<string, CategoryIndexEntry>,
  timeZone: string,
): { readonly sql: string; readonly params: SQLInputValue[] } {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];

  appendTransactionCommonFilters(parts, params, filters, timeZone);
  appendCategoryFilter(parts, params, filters.categoryIds, categoryIndex);
  appendStatusFilter(parts, params, filters.status);
  appendPaymentTypeFilter(parts, params, filters.paymentTypes);
  appendLabelFilter(parts, params, filters.labelIds);
  appendInstallmentsFilter(parts, filters.installments);
  appendBillFilter(parts, params, filters.billId);
  appendTransactionFtsFilters(parts, params, filters);

  return {
    sql: parts.length > 0 ? `AND ${parts.join(' AND ')}` : '',
    params,
  };
}

function appendTransactionFtsFilters(
  parts: string[],
  params: SQLInputValue[],
  filters: TransactionWebListFilters,
): void {
  const merchantMatch = buildTransactionFtsMatch(filters.merchantQuery ?? '', 'merchant_name');
  if (merchantMatch) {
    parts.push(
      `EXISTS (
        SELECT 1
        FROM transactions_fts
        WHERE transactions_fts.rowid = t.rowid
          AND transactions_fts MATCH ?
      )`,
    );
    params.push(merchantMatch);
  }

  appendTransactionOrAnnotationNotesFilter(parts, params, filters.descriptionQuery, 'description');
  appendTransactionOrAnnotationNotesFilter(parts, params, filters.searchQuery, 'all');
}

function appendTransactionOrAnnotationNotesFilter(
  parts: string[],
  params: SQLInputValue[],
  rawQuery: string | null,
  transactionColumn: TransactionFtsColumn,
): void {
  if (!rawQuery?.trim()) {
    return;
  }

  const transactionMatch = buildTransactionFtsMatch(rawQuery, transactionColumn);
  const notesMatch = buildTransactionFtsMatch(rawQuery, 'all');
  if (!transactionMatch || !notesMatch) {
    return;
  }

  parts.push(
    `(
      EXISTS (
        SELECT 1
        FROM transactions_fts
        WHERE transactions_fts.rowid = t.rowid
          AND transactions_fts MATCH ?
      )
      OR EXISTS (
        SELECT 1
        FROM entry_annotations ea
        INNER JOIN annotation_notes_fts ON annotation_notes_fts.rowid = ea.rowid
        WHERE ea.entry_type = 'transaction'
          AND ea.entry_id = t.id
          AND annotation_notes_fts MATCH ?
      )
    )`,
  );
  params.push(transactionMatch, notesMatch);
}

function appendCategoryFilter(
  parts: string[],
  params: SQLInputValue[],
  categoryIds: readonly string[] | 'all',
  categoryIndex: ReadonlyMap<string, CategoryIndexEntry>,
): void {
  if (categoryIds === 'all' || categoryIds.length === 0) {
    return;
  }

  const effectiveIds = expandCategoryFilterIds(categoryIds, categoryIndex);
  if (effectiveIds.length === 0) {
    parts.push('1 = 0');
    return;
  }

  parts.push(
    `COALESCE(tco.category_id, t.category_id) IN (${effectiveIds.map(() => '?').join(', ')})`,
  );
  params.push(...effectiveIds);
}

function expandCategoryFilterIds(
  categoryIds: readonly string[],
  categoryIndex: ReadonlyMap<string, CategoryIndexEntry>,
): string[] {
  const result = new Set<string>();
  for (const entry of categoryIndex.values()) {
    for (const filterId of categoryIds) {
      if (filterId.startsWith('only:')) {
        if (entry.id === filterId.slice('only:'.length)) {
          result.add(entry.id);
        }
        continue;
      }
      if (categoryMatchesParentFilter(entry.id, filterId, categoryIndex)) {
        result.add(entry.id);
      }
    }
  }
  return [...result];
}

function appendStatusFilter(
  parts: string[],
  params: SQLInputValue[],
  status: readonly string[] | 'all',
): void {
  if (status === 'all' || status.length === 0) {
    return;
  }
  const normalized = status.map((value) => value.toUpperCase());
  parts.push(`UPPER(COALESCE(t.status, 'UNKNOWN')) IN (${normalized.map(() => '?').join(', ')})`);
  params.push(...normalized);
}

function appendPaymentTypeFilter(
  parts: string[],
  params: SQLInputValue[],
  paymentTypes: readonly string[] | 'all',
): void {
  if (paymentTypes === 'all' || paymentTypes.length === 0) {
    return;
  }
  const normalized = paymentTypes.map((value) => value.toUpperCase());
  parts.push(
    `UPPER(COALESCE(t.payment_type, 'UNKNOWN')) IN (${normalized.map(() => '?').join(', ')})`,
  );
  params.push(...normalized);
}

function appendLabelFilter(
  parts: string[],
  params: SQLInputValue[],
  labelIds: readonly string[] | 'all',
): void {
  if (labelIds === 'all' || labelIds.length === 0) {
    return;
  }
  parts.push(
    `EXISTS (
      SELECT 1
      FROM entry_annotations ea
      JOIN entry_annotation_labels eal ON eal.annotation_id = ea.id
      WHERE ea.entry_type = 'transaction'
        AND ea.entry_id = t.id
        AND eal.label_id IN (${labelIds.map(() => '?').join(', ')})
    )`,
  );
  params.push(...labelIds);
}

export const TRANSACTION_HAS_INSTALLMENTS_WHERE = `
  json_extract(t.raw_json, '$.creditCardMetadata.installmentNumber') IS NOT NULL
  AND json_extract(t.raw_json, '$.creditCardMetadata.totalInstallments') IS NOT NULL
`;

function appendInstallmentsFilter(
  parts: string[],
  installments: TransactionInstallmentsFilter,
): void {
  if (installments === 'all') {
    return;
  }
  parts.push(
    installments === 'only'
      ? TRANSACTION_HAS_INSTALLMENTS_WHERE
      : `NOT (${TRANSACTION_HAS_INSTALLMENTS_WHERE})`,
  );
}

function appendBillFilter(parts: string[], params: SQLInputValue[], billId: string | null): void {
  if (!billId?.trim()) {
    return;
  }
  parts.push(
    `(
      EXISTS (
        SELECT 1
        FROM credit_card_bill_transactions cbt
        WHERE cbt.transaction_id = t.id
          AND cbt.bill_id = ?
      )
      OR json_extract(t.raw_json, '$.creditCardMetadata.billId') = ?
    )`,
  );
  params.push(billId, billId);
}

function buildTransactionOrderBy(
  sort: TransactionSortSpec,
  filters: TransactionWebListFilters,
): string {
  const builder = SORTABLE_COLUMN_BUILDERS[sort.column] ?? SORTABLE_COLUMN_BUILDERS['date'];
  const columnSql = builder ? builder(filters) : 't.occurred_at';
  const direction = sort.descending ? 'DESC' : 'ASC';
  return `${columnSql} ${direction}, t.id ${direction}`;
}

export function parseTransactionBillIdFilter(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function parseTransactionUseCreditPurchaseDate(value: string | undefined): boolean {
  return value === 'credit-purchase' || value === '1' || value === 'true';
}

export function parseTransactionLabelFilter(value: string | undefined): readonly string[] | 'all' {
  if (!value || value.trim().length === 0) {
    return 'all';
  }
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function parseTransactionClassificationFilter(
  value: string | undefined,
): TransactionClassificationFilter {
  if (value === 'classified' || value === 'unclassified') {
    return value;
  }
  return 'all';
}

export function parseTransactionTransfersFilter(
  value: string | undefined,
): 'all' | 'hide' | 'only' {
  if (value === 'hide' || value === 'only') {
    return value;
  }
  return 'all';
}

export function parseTransactionInstallmentsFilter(
  value: string | undefined,
): TransactionInstallmentsFilter {
  if (value === 'hide' || value === 'only') {
    return value;
  }
  return 'all';
}

export function parseTransactionDeletedVisibility(value: string | undefined): DeletedVisibility {
  return DELETED_VISIBILITIES.includes(value as DeletedVisibility)
    ? (value as DeletedVisibility)
    : 'hide';
}
