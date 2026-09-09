import chalk from 'chalk';
import type {
  CreditCardBillGroupByField,
  EnrichedCreditCardBill,
} from '../credit-card-bill-details.js';
import { resolveCreditCardBillGroupKey } from '../credit-card-bill-details.js';
import { renderGroupedList } from '../grouped-list.js';
import { formatCurrency, formatShortDate } from '../terminal-format.js';

export function renderCreditCardBillsTree(
  bills: readonly EnrichedCreditCardBill[],
  groupBy: readonly CreditCardBillGroupByField[],
): string {
  const includesAccount = groupBy.includes('account');
  const includesPaymentStatus = groupBy.includes('payment_status');

  return renderGroupedList({
    items: bills,
    groupBy,
    resolveGroupKey: (bill, field) =>
      resolveCreditCardBillGroupKey(bill, field as CreditCardBillGroupByField),
    formatLabel: formatCreditCardBillLabel,
    formatLine: (bill, nameWidth) =>
      formatCreditCardBillLine(bill, nameWidth, includesAccount, includesPaymentStatus),
    emptyMessage: chalk.dim('No credit card bills matched the current filters.'),
  });
}

function formatCreditCardBillLabel(bill: EnrichedCreditCardBill): string {
  return bill.bill_label;
}

function formatCreditCardBillLine(
  bill: EnrichedCreditCardBill,
  nameWidth: number,
  includesAccount: boolean,
  includesPaymentStatus: boolean,
): string {
  const dueDate = formatDueDateLabel(bill.due_date).padEnd(nameWidth, ' ');
  const total = formatBillAmount(bill.total_amount_cents, bill.currency);
  const minimum = formatMinimumPayment(bill.minimum_payment_cents, bill.currency);
  const status = includesPaymentStatus ? '' : formatPaymentStatus(bill.payment_status);
  const accountSuffix = includesAccount ? '' : chalk.dim(` · ${bill.account_display_name}`);

  const parts = [dueDate, total, minimum, status, accountSuffix].filter((part) => part.length > 0);

  return parts.join('  ');
}

function formatDueDateLabel(dueDate: string | null): string {
  if (dueDate) {
    return chalk.yellow.bold(`due ${formatShortDate(dueDate)}`);
  }

  return chalk.dim('due n/a');
}

function formatBillAmount(amountCents: number | null, currency: string): string {
  if (amountCents === null) {
    return chalk.dim('total n/a');
  }

  const formatted = formatCurrency(amountCents, currency);
  return chalk.red.bold(`total ${formatted}`);
}

function formatMinimumPayment(amountCents: number | null, currency: string): string {
  if (amountCents === null) {
    return chalk.dim('min n/a');
  }

  return chalk.dim(`min ${formatCurrency(amountCents, currency)}`);
}

function formatPaymentStatus(status: string | null): string {
  if (!status) {
    return chalk.dim('—');
  }

  const normalized = status.toUpperCase();
  if (normalized === 'PAID' || normalized === 'CLOSED' || normalized === 'SETTLED') {
    return chalk.green.bold(status);
  }

  if (normalized.includes('OVERDUE') || normalized === 'LATE') {
    return chalk.red.bold(status);
  }

  return chalk.yellow.bold(status);
}

export function serializeCreditCardBillForJson(
  bill: EnrichedCreditCardBill,
): Record<string, unknown> {
  const rawRecord = JSON.parse(bill.raw_json) as Record<string, unknown>;

  return {
    db: {
      id: bill.id,
      account_id: bill.account_id,
      due_date: bill.due_date,
      total_amount_cents: bill.total_amount_cents,
      minimum_payment_cents: bill.minimum_payment_cents,
      payment_status: bill.payment_status,
      currency: bill.currency,
      synced_at: bill.synced_at,
    },
    parsed: {
      bill_label: bill.bill_label,
      account_display_name: bill.account_display_name,
      connection_display_name: bill.connection_display_name,
      account_group_label: bill.account_group_label,
    },
    raw_json: rawRecord,
  };
}
