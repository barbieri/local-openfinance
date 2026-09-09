import type { DatabaseSync } from 'node:sqlite';
import {
  parseCreditCardInstallmentMetadata,
  resolveTransactionMerchantAndDescription,
} from '../openfinance/transaction-merchant.js';
import {
  parseTransactionCreditCardMetadata,
  parseTransactionMerchantDetail,
  resolvePayeeMccName,
} from '../openfinance/transaction-metadata.js';
import { resolveLocalTimeZone, toLocalDateKey } from '../utils/local-date.js';
import { resolveFlexibleLocalDateRange } from '../utils/local-date-range.js';
import { VISIBLE_ACCOUNT_TRANSACTIONS_WHERE } from './account-links.js';
import {
  type AnnotationLabelPresentation,
  buildAnnotationLabelIndex,
} from './annotation-labels.js';
import {
  buildCategoryIndex,
  type CategoryIndexEntry,
  type CategoryPresentation,
  categoryMatchesParentFilter,
} from './category-display.js';
import { matchesListStatusFilter } from './connection-account-group.js';
import { resolveAccountDisplayName } from './connection-labels.js';
import {
  type CreditCardBillLink,
  canChangeCreditCardBillLink,
  loadCreditCardBillLink,
} from './credit-card-bill-links.js';
import { parseGroupByFields } from './grouped-list.js';
import { getTransactionCategoryOverride } from './transaction-category-overrides.js';
import {
  normalizeTransactionAmountInAccountCurrencyCents,
  resolveTransactionForeignAmountFields,
  TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL,
} from './transaction-foreign-amount.js';

export const DEFAULT_TRANSACTION_GROUP_BY = ['account', 'date'] as const;

export const TRANSACTION_GROUP_BY_FIELDS = ['account', 'date'] as const;

export type TransactionGroupByField = (typeof TRANSACTION_GROUP_BY_FIELDS)[number];

export type TransactionAnnotation = {
  readonly categoryId: string | null;
  readonly subCategoryId: string | null;
  readonly category: string | null;
  readonly subCategory: string | null;
  readonly labels: readonly string[];
  readonly labelIds: readonly string[];
  readonly labelPresentations: readonly AnnotationLabelPresentation[];
  readonly notes: string | null;
};

export type TransactionTransferGroup = {
  readonly id: string;
  readonly kind: string;
  readonly related: TransactionTransferRelatedLeg | null;
};

export type TransactionTransferRelatedLeg = {
  readonly transaction_id: string;
  readonly account_id: string;
  readonly account_display_name: string;
  readonly amount_cents: number;
  readonly amount_in_account_currency_cents: number;
  readonly currency: string;
  readonly account_currency: string;
  readonly occurred_at: string;
  readonly role: string;
  readonly description: string | null;
  readonly merchant_name: string | null;
  readonly display_name: string;
  readonly amount_difference_cents: number;
  readonly category_presentation: CategoryPresentation | null;
  readonly annotation: TransactionAnnotation | null;
};

export type TransactionMerchantDetail = {
  readonly business_name: string | null;
  readonly cnpj: string | null;
  readonly cnae: string | null;
  readonly category: string | null;
};

export type TransactionCreditCardInfo = {
  readonly bill_id: string | null;
  readonly bill_due_date: string | null;
  readonly bill_link_source: CreditCardBillLink['source'] | null;
  readonly bill_link_confidence: number | null;
  readonly purchase_date: string | null;
  readonly purchase_total_cents: number | null;
  readonly payee_mcc: number | null;
  readonly payee_mcc_name: string | null;
  readonly installment_number: number | null;
  readonly total_installments: number | null;
  readonly can_change_bill_link: boolean;
};

export type TransactionRow = {
  readonly id: string;
  readonly account_id: string;
  readonly occurred_at: string;
  readonly amount_cents: number;
  readonly amount_in_account_currency_cents: number | null;
  readonly currency: string;
  readonly account_currency: string;
  readonly description: string | null;
  readonly category_id: string | null;
  readonly category_original_name: string | null;
  readonly category_translated_name: string | null;
  readonly merchant_name: string | null;
  readonly payment_type: string | null;
  readonly status: string | null;
  readonly raw_json: string;
  readonly synced_at: string;
  readonly connection_item_id: string;
  readonly connector_name: string | null;
};

export type EnrichedTransaction = Omit<TransactionRow, 'amount_in_account_currency_cents'> & {
  readonly display_name: string;
  readonly display_description: string | null;
  readonly display_occurred_at: string;
  readonly account_display_name: string;
  readonly account_group_key: string;
  readonly account_group_label: string;
  readonly local_date: string;
  readonly installment_number: number | null;
  readonly total_installments: number | null;
  readonly category_override_id: string | null;
  readonly category_presentation: CategoryPresentation | null;
  readonly original_category_presentation: CategoryPresentation | null;
  readonly annotation: TransactionAnnotation | null;
  readonly transfer_group: TransactionTransferGroup | null;
  readonly merchant_detail: TransactionMerchantDetail | null;
  readonly credit_card: TransactionCreditCardInfo | null;
  readonly amount_in_account_currency_cents: number;
};

export type TransactionListFilters = {
  readonly status: readonly string[] | 'all';
  readonly categoryIds: readonly string[] | 'all';
  readonly accountIds: readonly string[] | 'all';
  readonly merchantPattern: RegExp | null;
  readonly paymentTypes: readonly string[] | 'all';
  readonly startDate: string | null;
  readonly endDate: string | null;
};

export function parseTransactionGroupBy(value: string | undefined): TransactionGroupByField[] {
  return parseGroupByFields(value, TRANSACTION_GROUP_BY_FIELDS, DEFAULT_TRANSACTION_GROUP_BY);
}

export function parseTransactionStatusFilter(value: string | undefined): readonly string[] | 'all' {
  if (!value || value.trim().length === 0) {
    return 'all';
  }

  if (value.trim().toLowerCase() === 'all') {
    return 'all';
  }

  return value
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);
}

export function parseTransactionCategoryFilter(
  value: string | undefined,
): readonly string[] | 'all' {
  if (!value || value.trim().length === 0) {
    return 'all';
  }

  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function resolveEffectiveCategoryId(transaction: {
  readonly category_id: string | null;
  readonly category_override_id?: string | null;
}): string | null {
  return transaction.category_override_id ?? transaction.category_id;
}

export function parseTransactionPaymentTypeFilter(
  value: string | undefined,
): readonly string[] | 'all' {
  if (!value || value.trim().length === 0) {
    return 'all';
  }

  return value
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);
}

export function parseTransactionMerchantPattern(value: string | undefined): RegExp | null {
  if (!value || value.trim().length === 0) {
    return null;
  }

  return new RegExp(value, 'i');
}

export function parseTransactionAccountFilter(
  value: string | undefined,
): readonly string[] | 'all' {
  if (!value || value.trim().length === 0) {
    return 'all';
  }

  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function resolveTransactionDateRange(
  argv: {
    readonly date?: string | undefined;
    readonly startDate?: string | undefined;
    readonly endDate?: string | undefined;
  },
  timeZone = resolveLocalTimeZone(),
): Pick<TransactionListFilters, 'startDate' | 'endDate'> {
  const resolved = resolveFlexibleLocalDateRange(argv, timeZone);
  if (!resolved) {
    return {
      startDate: null,
      endDate: null,
    };
  }

  return {
    startDate: resolved.startDate,
    endDate: resolved.endDate,
  };
}

export { resolveLocalTimeZone, toLocalDateKey } from '../utils/local-date.js';

const TRANSACTION_ROW_SELECT_SQL = `
  t.id, t.account_id, t.occurred_at, t.amount_cents, t.amount_in_account_currency_cents,
  t.currency, t.description,
  t.category_id, cat.name AS category_original_name,
  cat.name_translated AS category_translated_name,
  t.merchant_name, t.payment_type, t.status,
  t.raw_json, t.synced_at, a.connection_item_id, c.connector_name,
  a.currency AS account_currency`;

export function loadTransactions(db: DatabaseSync): TransactionRow[] {
  return db
    .prepare(
      `SELECT ${TRANSACTION_ROW_SELECT_SQL}
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       JOIN connections c ON c.item_id = a.connection_item_id
       LEFT JOIN categories cat ON cat.id = t.category_id
       WHERE ${VISIBLE_ACCOUNT_TRANSACTIONS_WHERE}
       ORDER BY t.occurred_at ASC, t.id ASC`,
    )
    .all()
    .map(mapTransactionRow);
}

export function resolveTransactionDisplayDescription(input: {
  readonly description: string | null;
  readonly annotation: Pick<TransactionAnnotation, 'notes'> | null;
}): string | null {
  const notes = input.annotation?.notes?.trim();
  if (notes) {
    return notes;
  }

  return input.description;
}

export function enrichTransactionRow(
  db: DatabaseSync,
  row: TransactionRow,
  timeZone = resolveLocalTimeZone(),
  categoryIndex: ReadonlyMap<string, CategoryIndexEntry> | null = null,
  options: {
    readonly useCreditPurchaseDate?: boolean | undefined;
    readonly locale?: string | undefined;
    readonly billLink?: CreditCardBillLink | null | undefined;
  } = {},
): EnrichedTransaction {
  const rawRecord = JSON.parse(row.raw_json) as Record<string, unknown>;
  const resolved = resolveTransactionMerchantAndDescription(rawRecord);
  const merchant_name = resolved.merchantName ?? row.merchant_name;
  const description = resolved.description ?? row.description;
  const installmentMetadata = parseCreditCardInstallmentMetadata(rawRecord);
  const creditCardParsed = parseTransactionCreditCardMetadata(rawRecord);
  const merchantDetail = parseTransactionMerchantDetail(rawRecord);
  const billLink =
    options.billLink === undefined ? loadCreditCardBillLink(db, row.id) : options.billLink;
  const useCreditPurchaseDate = options.useCreditPurchaseDate === true;
  const displayOccurredAt = resolveDisplayOccurredAt(
    row.occurred_at,
    creditCardParsed.purchase_date,
    useCreditPurchaseDate,
  );
  const payeeMccName = resolvePayeeMccName(
    creditCardParsed.payee_mcc,
    options.locale,
    merchantDetail.category,
  );
  const displayName = merchant_name ?? description ?? row.id;
  const accountDisplayName = resolveAccountDisplayName(db, row.account_id);
  const categoryOverrideId = getTransactionCategoryOverride(db, row.id);
  const originalCategoryEntry =
    row.category_id && categoryIndex ? categoryIndex.get(row.category_id) : null;
  const effectiveCategoryId = categoryOverrideId ?? row.category_id;
  const categoryEntry =
    effectiveCategoryId && categoryIndex ? categoryIndex.get(effectiveCategoryId) : null;
  const categoryPresentation = categoryEntry
    ? { ...categoryEntry.presentation, path: categoryEntry.path }
    : null;
  const originalCategoryPresentation = originalCategoryEntry
    ? { ...originalCategoryEntry.presentation, path: originalCategoryEntry.path }
    : null;
  const annotation = loadTransactionAnnotation(db, row.id);
  const amountInAccountCurrencyCents = normalizeTransactionAmountInAccountCurrencyCents(
    row.amount_in_account_currency_cents,
    row.amount_cents,
  );
  const foreignAmountFields = resolveTransactionForeignAmountFields({
    currency: row.currency,
    accountCurrency: row.account_currency,
    amountInAccountCurrencyCents,
  });
  const { amount_in_account_currency_cents: _rawAccountAmount, ...rowWithoutForeignAmount } = row;

  return {
    ...rowWithoutForeignAmount,
    ...foreignAmountFields,
    merchant_name,
    description,
    display_name: displayName,
    display_description: resolveTransactionDisplayDescription({ description, annotation }),
    account_display_name: accountDisplayName,
    account_group_key: row.account_id,
    account_group_label: accountDisplayName,
    local_date: toLocalDateKey(displayOccurredAt, timeZone),
    display_occurred_at: displayOccurredAt,
    installment_number: installmentMetadata.installmentNumber,
    total_installments: installmentMetadata.totalInstallments,
    merchant_detail: hasMerchantDetail(merchantDetail) ? merchantDetail : null,
    credit_card: buildCreditCardInfo(
      db,
      row.id,
      row.raw_json,
      creditCardParsed,
      billLink,
      payeeMccName,
    ),
    category_override_id: categoryOverrideId,
    category_presentation: categoryPresentation,
    original_category_presentation: originalCategoryPresentation,
    annotation,
    transfer_group: loadTransactionTransferGroup(
      db,
      row.id,
      amountInAccountCurrencyCents,
      categoryIndex,
    ),
  };
}

export function listEnrichedTransactions(
  db: DatabaseSync,
  filters: TransactionListFilters,
  timeZone = resolveLocalTimeZone(),
): EnrichedTransaction[] {
  const categoryIndex = buildCategoryIndex(db);

  const enriched: EnrichedTransaction[] = [];
  for (const row of loadTransactions(db)) {
    const item = enrichTransactionRow(db, row, timeZone, categoryIndex);
    if (matchesTransactionFilters(item, filters, categoryIndex)) {
      enriched.push(item);
    }
  }
  return enriched;
}

export function resolveTransactionGroupKey(
  transaction: EnrichedTransaction,
  field: TransactionGroupByField,
): { readonly key: string; readonly label: string } {
  switch (field) {
    case 'account':
      return {
        key: transaction.account_group_key,
        label: transaction.account_group_label,
      };
    case 'date':
      return {
        key: transaction.local_date,
        label: transaction.local_date,
      };
    default:
      return { key: 'UNKNOWN', label: 'UNKNOWN' };
  }
}

function matchesTransactionFilters(
  transaction: EnrichedTransaction,
  filters: TransactionListFilters,
  categoryIndex: ReadonlyMap<string, CategoryIndexEntry> | null = null,
): boolean {
  return (
    matchesListStatusFilter(transaction.status, filters.status) &&
    matchesTransactionAccountFilter(transaction, filters.accountIds) &&
    matchesTransactionCategoryFilter(transaction, filters.categoryIds, categoryIndex) &&
    matchesTransactionPaymentTypeFilter(transaction, filters.paymentTypes) &&
    matchesTransactionMerchantFilter(transaction, filters.merchantPattern) &&
    matchesTransactionDateFilter(transaction, filters)
  );
}

function matchesTransactionAccountFilter(
  transaction: EnrichedTransaction,
  accountIds: readonly string[] | 'all',
): boolean {
  if (accountIds === 'all') {
    return true;
  }

  return accountIds.includes(transaction.account_id);
}

function matchesTransactionCategoryFilter(
  transaction: EnrichedTransaction,
  categoryIds: readonly string[] | 'all',
  categoryIndex: ReadonlyMap<string, CategoryIndexEntry> | null = null,
): boolean {
  if (categoryIds === 'all') {
    return true;
  }

  const effectiveCategoryId = resolveEffectiveCategoryId(transaction);
  if (!effectiveCategoryId) {
    return false;
  }

  for (const filterId of categoryIds) {
    if (filterId.startsWith('only:')) {
      if (effectiveCategoryId === filterId.slice('only:'.length)) {
        return true;
      }
      continue;
    }

    if (
      categoryIndex &&
      categoryMatchesParentFilter(effectiveCategoryId, filterId, categoryIndex)
    ) {
      return true;
    }

    if (effectiveCategoryId === filterId) {
      return true;
    }
  }

  return false;
}

function matchesTransactionPaymentTypeFilter(
  transaction: EnrichedTransaction,
  paymentTypes: readonly string[] | 'all',
): boolean {
  if (paymentTypes === 'all') {
    return true;
  }

  return paymentTypes.includes((transaction.payment_type ?? 'UNKNOWN').toUpperCase());
}

function matchesTransactionMerchantFilter(
  transaction: EnrichedTransaction,
  merchantPattern: RegExp | null,
): boolean {
  if (!merchantPattern) {
    return true;
  }

  const merchant = transaction.merchant_name ?? transaction.display_name;
  return Boolean(merchant && merchantPattern.test(merchant));
}

function matchesTransactionDateFilter(
  transaction: EnrichedTransaction,
  filters: Pick<TransactionListFilters, 'startDate' | 'endDate'>,
): boolean {
  return (
    matchesTransactionLowerDateBound(transaction, filters.startDate) &&
    matchesTransactionUpperDateBound(transaction, filters.endDate)
  );
}

function matchesTransactionLowerDateBound(
  transaction: EnrichedTransaction,
  startDate: string | null,
): boolean {
  if (!startDate) {
    return true;
  }

  if (isDateTimeFilterValue(startDate)) {
    const boundary = parseDateTimeFilterBoundary(startDate);
    return boundary === null || Date.parse(transaction.occurred_at) >= boundary;
  }

  return transaction.local_date >= startDate;
}

function matchesTransactionUpperDateBound(
  transaction: EnrichedTransaction,
  endDate: string | null,
): boolean {
  if (!endDate) {
    return true;
  }

  if (isDateTimeFilterValue(endDate)) {
    const boundary = parseDateTimeFilterBoundary(endDate);
    return boundary === null || Date.parse(transaction.occurred_at) <= boundary;
  }

  return transaction.local_date <= endDate;
}

function isDateTimeFilterValue(value: string): boolean {
  return value.includes('T');
}

function parseDateTimeFilterBoundary(value: string): number | null {
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value) ? `${value}:00` : value;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function loadTransactionAnnotation(
  db: DatabaseSync,
  transactionId: string,
): TransactionAnnotation | null {
  const row = db
    .prepare(
      `SELECT ea.id, ea.category_id, ea.sub_category_id, ea.notes,
              c.name AS category_name, sc.name AS sub_category_name
       FROM entry_annotations ea
       LEFT JOIN annotation_categories c ON c.id = ea.category_id
       LEFT JOIN annotation_categories sc ON sc.id = ea.sub_category_id
       WHERE ea.entry_type = 'transaction' AND ea.entry_id = ?`,
    )
    .get(transactionId) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  const labelRows = db
    .prepare(
      `SELECT al.id, al.name, al.parent_id, al.icon, al.color
       FROM entry_annotation_labels eal
       JOIN annotation_labels al ON al.id = eal.label_id
       WHERE eal.annotation_id = ?
       ORDER BY al.name ASC`,
    )
    .all(String(row['id'])) as Record<string, unknown>[];

  const labelIndex = buildAnnotationLabelIndex(db);
  const labelPresentations = labelRows.map((labelRow) => {
    const id = String(labelRow['id']);
    return (
      labelIndex.get(id) ?? {
        id,
        name: String(labelRow['name']),
        icon: typeof labelRow['icon'] === 'string' ? labelRow['icon'] : 'MdLabel',
        color: typeof labelRow['color'] === 'string' ? labelRow['color'] : '#64748b',
        path: String(labelRow['name']),
        parentId: typeof labelRow['parent_id'] === 'string' ? labelRow['parent_id'] : null,
      }
    );
  });

  return {
    categoryId: typeof row['category_id'] === 'string' ? row['category_id'] : null,
    subCategoryId: typeof row['sub_category_id'] === 'string' ? row['sub_category_id'] : null,
    category: typeof row['category_name'] === 'string' ? row['category_name'] : null,
    subCategory: typeof row['sub_category_name'] === 'string' ? row['sub_category_name'] : null,
    labels: labelPresentations.map((label) => label.name),
    labelIds: labelPresentations.map((label) => label.id),
    labelPresentations,
    notes: typeof row['notes'] === 'string' ? row['notes'] : null,
  };
}

function loadTransactionTransferGroup(
  db: DatabaseSync,
  transactionId: string,
  currentAmountCents: number,
  categoryIndex: ReadonlyMap<string, CategoryIndexEntry> | null = null,
): TransactionTransferGroup | null {
  const groupRow = db
    .prepare(
      `SELECT tg.id, tg.kind
       FROM transfer_groups tg
       JOIN transfer_group_members tgm ON tgm.group_id = tg.id
       WHERE tgm.entry_type = 'transaction' AND tgm.entry_id = ?
       LIMIT 1`,
    )
    .get(transactionId) as Record<string, unknown> | undefined;

  if (!groupRow) {
    return null;
  }

  const groupId = String(groupRow['id']);
  const relatedRow = db
    .prepare(
      `SELECT other_tgm.entry_id AS related_transaction_id,
              other_tgm.role AS related_role,
              other_t.id AS related_id,
              other_t.account_id AS related_account_id,
              other_t.amount_cents AS related_amount_cents,
              ${TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL.replaceAll('t.', 'other_t.')} AS related_amount_in_account_currency_cents,
              other_t.currency AS related_currency,
              other_a.currency AS related_account_currency,
              other_t.occurred_at AS related_occurred_at,
              other_t.description AS related_description,
              other_t.merchant_name AS related_merchant_name,
              other_t.category_id AS related_category_id,
              other_t.raw_json AS related_raw_json
       FROM transfer_group_members other_tgm
       JOIN transactions other_t ON other_t.id = other_tgm.entry_id
       JOIN accounts other_a ON other_a.id = other_t.account_id
       WHERE other_tgm.group_id = ?
         AND other_tgm.entry_type = 'transaction'
         AND other_tgm.entry_id != ?
       LIMIT 1`,
    )
    .get(groupId, transactionId) as Record<string, unknown> | undefined;

  const relatedTransactionId =
    relatedRow && typeof relatedRow['related_transaction_id'] === 'string'
      ? relatedRow['related_transaction_id']
      : null;

  return {
    id: groupId,
    kind: String(groupRow['kind']),
    related:
      relatedRow && relatedTransactionId
        ? buildTransferRelatedLeg(db, relatedRow, currentAmountCents, categoryIndex)
        : null,
  };
}

function buildTransferRelatedLeg(
  db: DatabaseSync,
  relatedRow: Record<string, unknown>,
  currentAmountCents: number,
  categoryIndex: ReadonlyMap<string, CategoryIndexEntry> | null,
): TransactionTransferRelatedLeg {
  const transactionId = String(relatedRow['related_transaction_id']);
  const accountAmountCents = normalizeTransactionAmountInAccountCurrencyCents(
    relatedRow['related_amount_in_account_currency_cents'] === null ||
      relatedRow['related_amount_in_account_currency_cents'] === undefined
      ? null
      : Number(relatedRow['related_amount_in_account_currency_cents']),
    Number(relatedRow['related_amount_cents']),
  );
  const currency = String(relatedRow['related_currency'] ?? 'BRL');
  const accountCurrency = String(relatedRow['related_account_currency'] ?? currency);
  const rawRecord = JSON.parse(String(relatedRow['related_raw_json'])) as Record<string, unknown>;
  const resolved = resolveTransactionMerchantAndDescription(rawRecord);
  const merchantName =
    resolved.merchantName ??
    (typeof relatedRow['related_merchant_name'] === 'string'
      ? relatedRow['related_merchant_name']
      : null);
  const description =
    resolved.description ??
    (typeof relatedRow['related_description'] === 'string'
      ? relatedRow['related_description']
      : null);
  const categoryId =
    typeof relatedRow['related_category_id'] === 'string'
      ? relatedRow['related_category_id']
      : null;
  const categoryEntry = categoryId && categoryIndex ? categoryIndex.get(categoryId) : null;
  const displayName = merchantName ?? description ?? transactionId;

  return {
    transaction_id: transactionId,
    account_id: String(relatedRow['related_account_id']),
    account_display_name: resolveAccountDisplayName(db, String(relatedRow['related_account_id'])),
    amount_cents: Number(relatedRow['related_amount_cents']),
    amount_in_account_currency_cents: accountAmountCents,
    currency,
    account_currency: accountCurrency,
    occurred_at: String(relatedRow['related_occurred_at']),
    role: String(relatedRow['related_role']),
    description,
    merchant_name: merchantName,
    display_name: displayName,
    amount_difference_cents: Math.abs(Math.abs(currentAmountCents) - Math.abs(accountAmountCents)),
    category_presentation: categoryEntry
      ? { ...categoryEntry.presentation, path: categoryEntry.path }
      : null,
    annotation: loadTransactionAnnotation(db, transactionId),
  };
}

export function loadTransactionRowById(
  db: DatabaseSync,
  transactionId: string,
): TransactionRow | null {
  const row = db
    .prepare(
      `SELECT ${TRANSACTION_ROW_SELECT_SQL}
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       JOIN connections c ON c.item_id = a.connection_item_id
       LEFT JOIN categories cat ON cat.id = t.category_id
       WHERE t.id = ?`,
    )
    .get(transactionId) as Record<string, unknown> | undefined;

  return row ? mapTransactionRow(row) : null;
}

function resolveDisplayOccurredAt(
  occurredAt: string,
  purchaseDate: string | null,
  useCreditPurchaseDate: boolean,
): string {
  if (useCreditPurchaseDate && purchaseDate) {
    return purchaseDate;
  }
  return occurredAt;
}

function hasMerchantDetail(detail: TransactionMerchantDetail): boolean {
  return Object.values(detail).some((value) => value !== null && value !== '');
}

function buildCreditCardInfo(
  db: DatabaseSync,
  transactionId: string,
  rawJson: string,
  parsed: ReturnType<typeof parseTransactionCreditCardMetadata>,
  billLink: CreditCardBillLink | null,
  payeeMccName: string | null,
): TransactionCreditCardInfo | null {
  const hasCreditData =
    parsed.bill_id ||
    parsed.purchase_date ||
    parsed.purchase_total_cents !== null ||
    parsed.payee_mcc !== null ||
    parsed.installment_number !== null ||
    billLink;
  if (!hasCreditData) {
    return null;
  }

  return {
    bill_id: billLink?.bill_id ?? parsed.bill_id,
    bill_due_date: billLink?.bill_due_date ?? null,
    bill_link_source: billLink?.source ?? (parsed.bill_id ? 'transaction_metadata' : null),
    bill_link_confidence: billLink?.confidence ?? (parsed.bill_id ? 100 : null),
    purchase_date: parsed.purchase_date,
    purchase_total_cents: parsed.purchase_total_cents,
    payee_mcc: parsed.payee_mcc,
    payee_mcc_name: payeeMccName,
    installment_number: parsed.installment_number,
    total_installments: parsed.total_installments,
    can_change_bill_link: canChangeCreditCardBillLink(db, transactionId, rawJson),
  };
}

function mapTransactionRow(row: unknown): TransactionRow {
  const record = row as Record<string, unknown>;
  return {
    id: String(record['id']),
    account_id: String(record['account_id']),
    occurred_at: String(record['occurred_at']),
    amount_cents: Number(record['amount_cents']),
    amount_in_account_currency_cents:
      record['amount_in_account_currency_cents'] === null ||
      record['amount_in_account_currency_cents'] === undefined
        ? null
        : Number(record['amount_in_account_currency_cents']),
    currency: String(record['currency'] ?? 'BRL'),
    account_currency: String(record['account_currency'] ?? record['currency'] ?? 'BRL'),
    description: typeof record['description'] === 'string' ? record['description'] : null,
    category_id: typeof record['category_id'] === 'string' ? record['category_id'] : null,
    category_original_name:
      typeof record['category_original_name'] === 'string'
        ? record['category_original_name']
        : null,
    category_translated_name:
      typeof record['category_translated_name'] === 'string'
        ? record['category_translated_name']
        : null,
    merchant_name: typeof record['merchant_name'] === 'string' ? record['merchant_name'] : null,
    payment_type: typeof record['payment_type'] === 'string' ? record['payment_type'] : null,
    status: typeof record['status'] === 'string' ? record['status'] : null,
    raw_json: String(record['raw_json']),
    synced_at: String(record['synced_at']),
    connection_item_id: String(record['connection_item_id']),
    connector_name: typeof record['connector_name'] === 'string' ? record['connector_name'] : null,
  };
}
