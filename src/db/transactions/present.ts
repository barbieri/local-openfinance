import chalk from 'chalk';
import { resolveUpstreamCategoryDisplayName } from '../category-display.js';
import { renderGroupedList } from '../grouped-list.js';
import {
  formatAmountRollup,
  formatCurrency,
  formatGroupHeading,
  summarizeAmountCents,
} from '../terminal-format.js';
import type { EnrichedTransaction, TransactionGroupByField } from '../transaction-details.js';
import { resolveTransactionGroupKey } from '../transaction-details.js';
import { isForeignCurrencyTransaction } from '../transaction-foreign-amount.js';

export type RenderTransactionsOptions = {
  readonly translateCategory: boolean;
};

export function renderTransactionsTree(
  transactions: readonly EnrichedTransaction[],
  groupBy: readonly TransactionGroupByField[],
  options: RenderTransactionsOptions = { translateCategory: true },
): string {
  const includesAccount = groupBy.includes('account');

  return renderGroupedList({
    items: transactions,
    groupBy,
    resolveGroupKey: (transaction, field) =>
      resolveTransactionGroupKey(transaction, field as TransactionGroupByField),
    formatLabel: formatTransactionLabel,
    formatLine: (transaction, nameWidth) =>
      formatTransactionLine(transaction, nameWidth, includesAccount, options.translateCategory),
    formatGroupHeader: (field, label, items, depth) =>
      formatTransactionGroupHeader(field, label, items, depth),
    sortGroupChildren: (field, left, right) => {
      if (field === 'date') {
        return left.label.localeCompare(right.label);
      }

      return left.label.localeCompare(right.label);
    },
    emptyMessage: chalk.dim('No transactions matched the current filters.'),
  });
}

function formatTransactionGroupHeader(
  _field: string,
  label: string,
  items: readonly EnrichedTransaction[],
  depth: number,
): string {
  const currency = items[0]?.account_currency ?? 'BRL';
  const rollup = summarizeAmountCents(items.map((item) => item.amount_in_account_currency_cents));

  return `${formatGroupHeading(depth, label)}  ${formatAmountRollup(rollup, currency)}`;
}

function formatTransactionLabel(transaction: EnrichedTransaction): string {
  return transaction.display_name;
}

function formatTransactionLine(
  transaction: EnrichedTransaction,
  nameWidth: number,
  includesAccount: boolean,
  translateCategory: boolean,
): string {
  const label = formatTransactionLabel(transaction).padEnd(nameWidth, ' ');
  const amount = formatTransactionAmount(transaction);
  const category = formatUpstreamCategory(transaction, translateCategory);
  const annotation = formatAnnotationSuffix(transaction);
  const transfer = formatTransferSuffix(transaction);
  const installment = formatInstallmentSuffix(transaction);
  const paymentType = formatPaymentTypeSuffix(transaction.payment_type);
  const accountSuffix = includesAccount ? '' : chalk.dim(` · ${transaction.account_display_name}`);

  const suffix = [category, annotation, transfer, installment, paymentType, accountSuffix]
    .filter((part) => part.length > 0)
    .join('  ');

  return `${chalk.white(label)}  ${amount}${suffix.length > 0 ? `  ${suffix}` : ''}`;
}

function formatTransactionAmount(transaction: EnrichedTransaction): string {
  if (isForeignCurrencyTransaction(transaction.currency, transaction.account_currency)) {
    const primary = formatCurrency(transaction.amount_cents, transaction.currency);
    const secondary = formatCurrency(
      transaction.amount_in_account_currency_cents,
      transaction.account_currency,
    );
    const combined = `${primary} (${secondary})`;
    if (transaction.amount_in_account_currency_cents < 0) {
      return chalk.red.bold(combined);
    }
    if (transaction.amount_in_account_currency_cents > 0) {
      return chalk.green.bold(combined);
    }
    return chalk.dim(combined);
  }

  return formatTransactionAmountValue(
    transaction.amount_in_account_currency_cents,
    transaction.account_currency,
  );
}

function formatTransactionAmountValue(amountCents: number, currency: string): string {
  const formatted = formatCurrency(amountCents, currency);
  if (amountCents < 0) {
    return chalk.red.bold(formatted);
  }

  if (amountCents > 0) {
    return chalk.green.bold(formatted);
  }

  return chalk.dim(formatted);
}

function formatUpstreamCategory(
  transaction: EnrichedTransaction,
  translateCategory: boolean,
): string {
  const categoryName = resolveUpstreamCategoryDisplayName(
    transaction.category_original_name,
    transaction.category_translated_name,
    translateCategory,
  );
  if (!categoryName) {
    return '';
  }

  return chalk.cyan(categoryName);
}

function formatAnnotationSuffix(transaction: EnrichedTransaction): string {
  const annotation = transaction.annotation;
  if (!annotation) {
    return '';
  }

  const parts: string[] = [];
  if (annotation.category) {
    parts.push(annotation.category);
  }
  if (annotation.subCategory) {
    parts.push(annotation.subCategory);
  }

  const categoryText = parts.length > 0 ? parts.join(' / ') : null;
  const labelText = annotation.labels.length > 0 ? `[${annotation.labels.join(', ')}]` : null;

  if (categoryText && labelText) {
    return chalk.magenta(`→ ${categoryText} ${labelText}`);
  }

  if (categoryText) {
    return chalk.magenta(`→ ${categoryText}`);
  }

  if (labelText) {
    return chalk.magenta(`→ ${labelText}`);
  }

  return '';
}

function formatTransferSuffix(transaction: EnrichedTransaction): string {
  if (!transaction.transfer_group) {
    return '';
  }

  return chalk.blue('⇄');
}

function formatInstallmentSuffix(transaction: EnrichedTransaction): string {
  if (transaction.installment_number === null || transaction.total_installments === null) {
    return '';
  }

  return chalk.yellow(`${transaction.installment_number}/${transaction.total_installments}`);
}

function formatPaymentTypeSuffix(paymentType: string | null): string {
  if (!paymentType) {
    return '';
  }

  return chalk.dim(paymentType);
}

export function serializeTransactionForJson(
  transaction: EnrichedTransaction,
  translateCategory = true,
): Record<string, unknown> {
  const rawRecord = JSON.parse(transaction.raw_json) as Record<string, unknown>;

  return {
    db: {
      id: transaction.id,
      account_id: transaction.account_id,
      occurred_at: transaction.occurred_at,
      amount_cents: transaction.amount_cents,
      amount_in_account_currency_cents: transaction.amount_in_account_currency_cents,
      currency: transaction.currency,
      account_currency: transaction.account_currency,
      description: transaction.description,
      category_id: transaction.category_id,
      merchant_name: transaction.merchant_name,
      payment_type: transaction.payment_type,
      status: transaction.status,
      synced_at: transaction.synced_at,
      connection_item_id: transaction.connection_item_id,
      connector_name: transaction.connector_name,
    },
    parsed: {
      display_name: transaction.display_name,
      display_description: transaction.display_description,
      account_display_name: transaction.account_display_name,
      account_group_label: transaction.account_group_label,
      local_date: transaction.local_date,
      category_original_name: transaction.category_original_name,
      category_translated_name: transaction.category_translated_name,
      category_display_name: resolveUpstreamCategoryDisplayName(
        transaction.category_original_name,
        transaction.category_translated_name,
        translateCategory,
      ),
      installment_number: transaction.installment_number,
      total_installments: transaction.total_installments,
      annotation: transaction.annotation,
      transfer_group: transaction.transfer_group,
    },
    raw_json: rawRecord,
  };
}
