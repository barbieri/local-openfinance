import chalk from 'chalk';
import { extractCardLastFourDigits } from '../account-details.js';
import type { CreditCardGroupByField, EnrichedAccount } from '../account-list-details.js';
import { resolveCreditCardGroupKey } from '../account-list-details.js';
import { renderGroupedList } from '../grouped-list.js';
import { formatCurrency, formatShortDate } from '../terminal-format.js';

export function renderCreditCardsTree(
  creditCards: readonly EnrichedAccount[],
  groupBy: readonly CreditCardGroupByField[],
): string {
  return renderGroupedList({
    items: creditCards,
    groupBy,
    resolveGroupKey: (creditCard, field) =>
      resolveCreditCardGroupKey(creditCard, field as CreditCardGroupByField),
    formatLabel: formatCreditCardLabel,
    formatLine: formatCreditCardLine,
    emptyMessage: chalk.dim('No credit cards matched the current filters.'),
  });
}

function formatCreditCardLabel(creditCard: EnrichedAccount): string {
  return creditCard.display_name;
}

function formatCreditCardLine(creditCard: EnrichedAccount, nameWidth: number): string {
  const displayName = chalk.bold.white(formatCreditCardLabel(creditCard).padEnd(nameWidth, ' '));
  const typeSubtype = formatTypeSubtype(creditCard.type, creditCard.subtype);
  const cardNumber = formatCardNumber(creditCard.number);
  const balance = formatCreditCardBalance(creditCard.balance_cents, creditCard.currency);
  const meta = formatCreditMeta(creditCard.credit_data, creditCard.currency);

  return `${displayName}  ${typeSubtype}  ${cardNumber}  ${balance}${meta}`;
}

function formatTypeSubtype(type: string, subtype: string | null): string {
  const typeLabel = chalk.cyan.bold(type);
  if (!subtype) {
    return typeLabel;
  }

  return `${typeLabel}${chalk.dim('/')}${chalk.cyan(subtype)}`;
}

function formatCardNumber(number: string | null): string {
  const lastFour = extractCardLastFourDigits(number);
  if (lastFour) {
    return chalk.yellow(`card ****${lastFour}`);
  }

  return chalk.dim('—');
}

function formatCreditCardBalance(balanceCents: number | null, currency: string): string {
  if (balanceCents === null) {
    return chalk.dim('n/a');
  }

  const formatted = formatCurrency(balanceCents, currency);
  if (balanceCents < 0) {
    return chalk.red.bold(formatted);
  }

  if (balanceCents > 0) {
    return chalk.green.bold(formatted);
  }

  return chalk.dim(formatted);
}

function formatCreditMeta(creditData: EnrichedAccount['credit_data'], currency: string): string {
  if (!creditData) {
    return '';
  }

  const parts: string[] = [];
  if (creditData.brand) {
    parts.push(chalk.magenta(creditData.brand));
  }
  if (creditData.level) {
    parts.push(chalk.magenta(creditData.level));
  }
  if (creditData.credit_limit_cents !== null) {
    parts.push(`limit ${formatCurrency(creditData.credit_limit_cents, currency)}`);
  }
  if (creditData.available_credit_limit_cents !== null) {
    parts.push(`available ${formatCurrency(creditData.available_credit_limit_cents, currency)}`);
  }
  if (creditData.balance_close_date) {
    parts.push(chalk.yellow(`close ${formatShortDate(creditData.balance_close_date)}`));
  }
  if (creditData.balance_due_date) {
    parts.push(chalk.yellow(`due ${formatShortDate(creditData.balance_due_date)}`));
  }
  if (creditData.minimum_payment_cents !== null) {
    parts.push(`min ${formatCurrency(creditData.minimum_payment_cents, currency)}`);
  }
  if (creditData.status && creditData.status !== 'ACTIVE') {
    parts.push(creditData.status);
  }

  if (parts.length === 0) {
    return '';
  }

  return chalk.dim(` (${parts.join(' · ')})`);
}

export function serializeCreditCardForJson(creditCard: EnrichedAccount): Record<string, unknown> {
  const rawRecord = JSON.parse(creditCard.raw_json) as Record<string, unknown>;

  return {
    db: {
      id: creditCard.id,
      connection_item_id: creditCard.connection_item_id,
      connector_name: creditCard.connector_name,
      type: creditCard.type,
      subtype: creditCard.subtype,
      name: creditCard.name,
      number: creditCard.number,
      balance_cents: creditCard.balance_cents,
      currency: creditCard.currency,
      synced_at: creditCard.synced_at,
    },
    parsed: {
      display_name: creditCard.display_name,
      connection_display_name: creditCard.connection_display_name,
      account_group_label: creditCard.account_group_label,
      credit_data: creditCard.credit_data,
    },
    raw_json: rawRecord,
  };
}
