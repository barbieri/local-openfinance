import type { DatabaseSync } from 'node:sqlite';
import { normalizeMerchantText } from '../annotation/merchant-match.js';
import { readRecord } from '../openfinance/money.js';
import {
  parseCreditCardInstallmentMetadata,
  resolveTransactionMerchantAndDescription,
  stripCreditCardInstallmentSuffix,
} from '../openfinance/transaction-merchant.js';

type TransactionInstallmentRow = {
  readonly id: string;
  readonly account_id: string;
  readonly amount_cents: number;
  readonly merchant_name: string | null;
  readonly description: string | null;
  readonly raw_json: string;
};

export const INSTALLMENT_AMOUNT_MATCH_TOLERANCE_CENTS = 1;

export type InstallmentPlanInfo = {
  readonly installmentNumber: number;
  readonly totalInstallments: number;
  readonly purchaseKey: string;
  readonly siblingIds: readonly string[];
};

function readCreditCardMetadata(rawJson: string): Record<string, unknown> | null {
  try {
    const record = readRecord(JSON.parse(rawJson));
    return readRecord(record?.['creditCardMetadata']);
  } catch {
    return null;
  }
}

function resolveInstallmentRowText(
  row: Pick<TransactionInstallmentRow, 'merchant_name' | 'description' | 'raw_json'>,
): { readonly merchantName: string | null; readonly description: string | null } {
  try {
    const resolved = resolveTransactionMerchantAndDescription(JSON.parse(row.raw_json));
    return {
      merchantName: resolved.merchantName ?? row.merchant_name,
      description: resolved.description ?? row.description,
    };
  } catch {
    return {
      merchantName: row.merchant_name,
      description: row.description,
    };
  }
}

export function buildInstallmentPurchaseKey(
  merchantName: string | null,
  description: string | null,
  rawJson: string,
): { readonly totalInstallments: number; readonly purchaseKey: string } | null {
  const metadata = parseCreditCardInstallmentMetadata(rawJson);
  if (metadata.installmentNumber === null || metadata.totalInstallments === null) {
    return null;
  }

  const creditCardMetadata = readCreditCardMetadata(rawJson);
  const baseMerchant = merchantName
    ? stripCreditCardInstallmentSuffix(merchantName, creditCardMetadata ?? {})
    : '';
  const baseDescription = description
    ? stripCreditCardInstallmentSuffix(description, creditCardMetadata ?? {})
    : '';
  const normalized = normalizeMerchantText(baseMerchant || baseDescription);
  if (!normalized) {
    return null;
  }

  return {
    totalInstallments: metadata.totalInstallments,
    purchaseKey: normalized,
  };
}

export function installmentAmountsMatch(
  leftAmountCents: number,
  rightAmountCents: number,
  toleranceCents = INSTALLMENT_AMOUNT_MATCH_TOLERANCE_CENTS,
): boolean {
  return Math.abs(leftAmountCents - rightAmountCents) <= toleranceCents;
}

export function installmentPlansMatch(
  left: Pick<
    TransactionInstallmentRow,
    'amount_cents' | 'merchant_name' | 'description' | 'raw_json'
  >,
  right: Pick<
    TransactionInstallmentRow,
    'amount_cents' | 'merchant_name' | 'description' | 'raw_json'
  >,
): boolean {
  const leftText = resolveInstallmentRowText(left);
  const rightText = resolveInstallmentRowText(right);
  const leftKey = buildInstallmentPurchaseKey(
    leftText.merchantName,
    leftText.description,
    left.raw_json,
  );
  const rightKey = buildInstallmentPurchaseKey(
    rightText.merchantName,
    rightText.description,
    right.raw_json,
  );
  if (!leftKey || !rightKey) {
    return false;
  }

  return (
    leftKey.totalInstallments === rightKey.totalInstallments &&
    leftKey.purchaseKey === rightKey.purchaseKey &&
    installmentAmountsMatch(left.amount_cents, right.amount_cents)
  );
}

function loadInstallmentTransactionRow(
  db: DatabaseSync,
  transactionId: string,
): TransactionInstallmentRow | null {
  const row = db
    .prepare(
      `SELECT id, account_id, amount_cents, merchant_name, description, raw_json
       FROM transactions
       WHERE id = ?`,
    )
    .get(transactionId) as TransactionInstallmentRow | undefined;
  return row ?? null;
}

export function getInstallmentPlanInfo(
  db: DatabaseSync,
  transactionId: string,
): InstallmentPlanInfo | null {
  const anchor = loadInstallmentTransactionRow(db, transactionId);
  if (!anchor) {
    return null;
  }

  const anchorText = resolveInstallmentRowText(anchor);
  const planKey = buildInstallmentPurchaseKey(
    anchorText.merchantName,
    anchorText.description,
    anchor.raw_json,
  );
  if (!planKey) {
    return null;
  }

  const metadata = parseCreditCardInstallmentMetadata(anchor.raw_json);
  if (metadata.installmentNumber === null) {
    return null;
  }

  const candidates = db
    .prepare(
      `SELECT id, amount_cents, merchant_name, description, raw_json
       FROM transactions
       WHERE account_id = ?
         AND id != ?`,
    )
    .all(anchor.account_id, transactionId) as Array<
    Pick<
      TransactionInstallmentRow,
      'id' | 'amount_cents' | 'merchant_name' | 'description' | 'raw_json'
    >
  >;

  const siblingIds: string[] = [];
  for (const row of candidates) {
    if (installmentPlansMatch(anchor, row)) {
      siblingIds.push(row.id);
    }
  }

  return {
    installmentNumber: metadata.installmentNumber,
    totalInstallments: planKey.totalInstallments,
    purchaseKey: planKey.purchaseKey,
    siblingIds,
  };
}

export function listInstallmentSiblingTransactionIds(
  db: DatabaseSync,
  transactionId: string,
): readonly string[] {
  return getInstallmentPlanInfo(db, transactionId)?.siblingIds ?? [];
}

export function findFirstInstallmentTransactionId(
  db: DatabaseSync,
  transactionId: string,
): string | null {
  const plan = getInstallmentPlanInfo(db, transactionId);
  if (!plan) {
    return null;
  }
  if (plan.installmentNumber === 1) {
    return transactionId;
  }

  const anchor = loadInstallmentTransactionRow(db, transactionId);
  if (!anchor) {
    return null;
  }

  for (const id of [transactionId, ...plan.siblingIds]) {
    const row = loadInstallmentTransactionRow(db, id);
    if (!row) {
      continue;
    }
    const metadata = parseCreditCardInstallmentMetadata(row.raw_json);
    if (metadata.installmentNumber === 1 && installmentPlansMatch(anchor, row)) {
      return id;
    }
  }

  return null;
}
