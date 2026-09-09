import type { DatabaseSync } from 'node:sqlite';
import {
  resolveAccountDisplayName,
  resolveConnectionDisplayName,
} from '../db/connection-labels.js';
import { TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL } from '../db/transaction-foreign-amount.js';
import { readRecord } from '../openfinance/money.js';
import {
  collectPeerDocumentKeys,
  extractTransactionDocumentKeys,
  formatPaymentDocumentKey,
  readPaymentDocumentsFromRecord,
} from '../openfinance/payment-document.js';
import {
  parseTransactionCreditCardMetadata,
  parseTransactionMerchantDetail,
  resolvePayeeMccName,
} from '../openfinance/transaction-metadata.js';
import { getDateTimeFormat } from '../utils/intl-formatters.js';
import { resolveLocalTimeZone, toLocalDateKey } from '../utils/local-date.js';
import { resolveContentLocale } from '../utils/locale-resolve.js';

export type AnnotatableEntry = {
  readonly entryType: 'transaction' | 'investment_transaction';
  readonly entryId: string;
  readonly occurredAt: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly description: string | null;
  readonly merchantName: string | null;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly parentCategoryId: string | null;
  readonly parentCategoryName: string | null;
  readonly accountId: string | null;
  readonly accountName: string | null;
  readonly accountType: string | null;
  readonly accountSubtype: string | null;
  readonly connectionItemId: string | null;
  readonly connectionName: string | null;
  readonly rawJson: string;
};

/**
 * Compact, stable text for embedding similarity and classifier few-shots.
 *
 * Intentionally omits the full raw JSON dump and exact clock time so recurring
 * peers/merchants cluster together. Peer documents use normalized keys such as
 * `cnpj:11222333000181`.
 */
export function buildAnnotationFeatureText(entry: AnnotatableEntry): string {
  return buildEmbeddingFeatureText(entry);
}

export function buildEmbeddingFeatureText(entry: AnnotatableEntry): string {
  const raw = readRecord(JSON.parse(entry.rawJson)) ?? {};
  const paymentDocuments = readPaymentDocumentsFromRecord(raw);
  const documentKeys = extractTransactionDocumentKeys(raw);
  const merchantDetail = parseTransactionMerchantDetail(raw);
  const creditCard = parseTransactionCreditCardMetadata(raw);
  const mccName = resolvePayeeMccName(
    creditCard.payee_mcc,
    resolveContentLocale(),
    merchantDetail.category,
  );
  const timeZone = resolveLocalTimeZone();
  const localDate = toLocalDateKey(entry.occurredAt, timeZone);

  return [
    ...buildEmbeddingMerchantLines(entry, merchantDetail, creditCard, mccName, documentKeys),
    ...buildEmbeddingPaymentLines(paymentDocuments, documentKeys, readPaymentType(raw)),
    ...buildEmbeddingEntryContextLines(entry, localDate, paymentDocuments.receiverName, timeZone),
  ].join('\n');
}

function readPaymentType(raw: Record<string, unknown>): string {
  const operationType = raw['operationType'];
  if (typeof operationType === 'string') {
    return operationType;
  }
  const type = raw['type'];
  return typeof type === 'string' ? type : '';
}

function buildEmbeddingMerchantLines(
  entry: AnnotatableEntry,
  merchantDetail: ReturnType<typeof parseTransactionMerchantDetail>,
  creditCard: ReturnType<typeof parseTransactionCreditCardMetadata>,
  mccName: string | null,
  documentKeys: ReturnType<typeof extractTransactionDocumentKeys>,
): string[] {
  return [
    `type=${entry.entryType}`,
    `description=${entry.description ?? ''}`,
    `merchant=${entry.merchantName ?? ''}`,
    `merchant_business_name=${merchantDetail.business_name ?? ''}`,
    `merchant_document=${documentKeys.merchantDocumentKey ?? ''}`,
    `merchant_cnae=${merchantDetail.cnae ?? ''}`,
    `merchant_category=${merchantDetail.category ?? ''}`,
    `payee_mcc=${creditCard.payee_mcc ?? ''}`,
    `payee_mcc_name=${mccName ?? ''}`,
  ];
}

function buildEmbeddingPaymentLines(
  paymentDocuments: ReturnType<typeof readPaymentDocumentsFromRecord>,
  documentKeys: ReturnType<typeof extractTransactionDocumentKeys>,
  paymentType: string,
): string[] {
  return [
    `payment_type=${paymentType}`,
    `payment_receiver_name=${paymentDocuments.receiverName ?? ''}`,
    `payer_document=${documentKeys.payerDocumentKey ?? formatPaymentDocumentKey(paymentDocuments.payer) ?? ''}`,
    `receiver_document=${documentKeys.receiverDocumentKey ?? formatPaymentDocumentKey(paymentDocuments.receiver) ?? ''}`,
    // All document keys for context; peer *matching* still requires a strong counterparty share.
    `peer_documents=${collectPeerDocumentKeys(documentKeys).join(',')}`,
  ];
}

function buildEmbeddingEntryContextLines(
  entry: AnnotatableEntry,
  localDate: string,
  receiverName: string | null,
  timeZone: string,
): string[] {
  return [
    `amount_sign=${amountSign(entry.amountCents)}`,
    `amount_bucket=${amountBucket(entry.amountCents)}`,
    `currency=${entry.currency}`,
    `month=${localDate.slice(0, 7)}`,
    `weekday=${formatLocalWeekday(entry.occurredAt, timeZone)}`,
    `counterparty=${receiverName ?? entry.merchantName ?? ''}`,
    `connection=${entry.connectionName ?? ''}`,
    `account_type=${entry.accountType ?? ''}`,
    `account_subtype=${entry.accountSubtype ?? ''}`,
    `category_id=${entry.categoryId ?? ''}`,
    `category=${entry.categoryName ?? ''}`,
    `parent_category_id=${entry.parentCategoryId ?? ''}`,
    `parent_category=${entry.parentCategoryName ?? ''}`,
  ];
}

function amountSign(amountCents: number): 'debit' | 'credit' | 'zero' {
  if (amountCents < 0) {
    return 'debit';
  }
  if (amountCents > 0) {
    return 'credit';
  }
  return 'zero';
}

/** Coarse magnitude so similar recurring payments cluster despite price drift. */
function amountBucket(amountCents: number): string {
  const abs = Math.abs(amountCents);
  if (abs === 0) {
    return '0';
  }
  if (abs < 2_000) {
    return 'lt_20';
  }
  if (abs < 10_000) {
    return '20_100';
  }
  if (abs < 50_000) {
    return '100_500';
  }
  if (abs < 200_000) {
    return '500_2000';
  }
  if (abs < 1_000_000) {
    return '2000_10000';
  }
  return 'gte_10000';
}

function formatLocalWeekday(iso: string, timeZone: string): string {
  return getDateTimeFormat('en-US', {
    weekday: 'long',
    timeZone,
  }).format(new Date(iso));
}

export function loadTransactionEntry(db: DatabaseSync, entryId: string): AnnotatableEntry | null {
  const row = db
    .prepare(
      `SELECT t.id, t.account_id, t.occurred_at,
              ${TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL} AS amount_cents,
              a.currency AS currency, t.description, t.merchant_name,
              t.category_id, cat.name AS category_name, cat.parent_id AS parent_category_id,
              parent_cat.name AS parent_category_name,
              t.raw_json, a.name AS account_name, a.type AS account_type, a.subtype AS account_subtype,
              a.connection_item_id
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories cat ON cat.id = t.category_id
       LEFT JOIN categories parent_cat ON parent_cat.id = cat.parent_id
       WHERE t.id = ?`,
    )
    .get(entryId) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  const accountId = String(row['account_id']);
  const connectionItemId =
    typeof row['connection_item_id'] === 'string' ? row['connection_item_id'] : null;

  return {
    entryType: 'transaction',
    entryId: String(row['id']),
    occurredAt: String(row['occurred_at']),
    amountCents: Number(row['amount_cents']),
    currency: String(row['currency']),
    description: typeof row['description'] === 'string' ? row['description'] : null,
    merchantName: typeof row['merchant_name'] === 'string' ? row['merchant_name'] : null,
    categoryId: typeof row['category_id'] === 'string' ? row['category_id'] : null,
    categoryName: typeof row['category_name'] === 'string' ? row['category_name'] : null,
    parentCategoryId:
      typeof row['parent_category_id'] === 'string' ? row['parent_category_id'] : null,
    parentCategoryName:
      typeof row['parent_category_name'] === 'string' ? row['parent_category_name'] : null,
    accountId,
    accountName: resolveAccountDisplayName(db, accountId),
    accountType: typeof row['account_type'] === 'string' ? row['account_type'] : null,
    accountSubtype: typeof row['account_subtype'] === 'string' ? row['account_subtype'] : null,
    connectionItemId,
    connectionName: connectionItemId ? resolveConnectionDisplayName(db, connectionItemId) : null,
    rawJson: String(row['raw_json']),
  };
}

export function loadInvestmentTransactionEntry(
  db: DatabaseSync,
  entryId: string,
): AnnotatableEntry | null {
  const row = db
    .prepare(
      `SELECT it.id, it.occurred_at, it.amount_cents, it.currency, it.type, it.raw_json,
              i.name AS investment_name, i.connection_item_id
       FROM investment_transactions it
       JOIN investments i ON i.id = it.investment_id
       WHERE it.id = ?`,
    )
    .get(entryId) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  const connectionItemId =
    typeof row['connection_item_id'] === 'string' ? row['connection_item_id'] : null;

  return {
    entryType: 'investment_transaction',
    entryId: String(row['id']),
    occurredAt: String(row['occurred_at']),
    amountCents: Number(row['amount_cents']),
    currency: String(row['currency']),
    description: typeof row['type'] === 'string' ? row['type'] : null,
    merchantName: typeof row['investment_name'] === 'string' ? row['investment_name'] : null,
    categoryId: null,
    categoryName: null,
    parentCategoryId: null,
    parentCategoryName: null,
    accountId: null,
    accountName:
      resolveConnectionDisplayName(db, String(row['connection_item_id'])) ??
      (typeof row['investment_name'] === 'string' ? row['investment_name'] : null),
    accountType: null,
    accountSubtype: null,
    connectionItemId,
    connectionName: connectionItemId ? resolveConnectionDisplayName(db, connectionItemId) : null,
    rawJson: String(row['raw_json']),
  };
}
