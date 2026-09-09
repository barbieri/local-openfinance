import chalk from 'chalk';
import { renderGroupedList } from '../grouped-list.js';
import type { EnrichedLoan, LoanGroupByField } from '../loan-details.js';
import { resolveLoanGroupKey } from '../loan-details.js';
import { formatCurrency, formatPlainAmount, formatShortDate } from '../terminal-format.js';

export function renderLoansTree(
  loans: readonly EnrichedLoan[],
  groupBy: readonly LoanGroupByField[],
): string {
  return renderGroupedList({
    items: loans,
    groupBy,
    resolveGroupKey: (loan, field) => resolveLoanGroupKey(loan, field as LoanGroupByField),
    formatLabel: formatLoanLabel,
    formatLine: formatLoanLine,
    hiddenHeaderFields: ['name'],
    emptyMessage: chalk.dim('No loans found.'),
  });
}

function formatLoanLabel(loan: EnrichedLoan): string {
  return loan.display_name;
}

function formatLoanLine(loan: EnrichedLoan, nameWidth: number): string {
  const label = formatLoanLabel(loan).padEnd(nameWidth, ' ');
  const contractAmount =
    loan.contract_amount_cents !== null
      ? chalk.green.bold(formatCurrency(loan.contract_amount_cents, loan.currency))
      : chalk.dim('n/a');
  const dueDate = loan.due_date
    ? chalk.yellow(`due ${formatShortDate(loan.due_date)}`)
    : chalk.dim('due n/a');

  const secondaryParts: string[] = [];
  if (loan.outstanding_balance_cents !== null) {
    secondaryParts.push(
      `balance: ${formatCurrency(loan.outstanding_balance_cents, loan.currency)}`,
    );
  }
  if (loan.paid_installments !== null && loan.total_installments !== null) {
    secondaryParts.push(`${loan.paid_installments}/${loan.total_installments} installments`);
  } else if (loan.installment_cents !== null) {
    secondaryParts.push(`installment: ${formatPlainAmount(loan.installment_cents)}`);
  }
  if (loan.creditor) {
    secondaryParts.push(loan.creditor);
  }

  const secondary = secondaryParts.length > 0 ? chalk.dim(` (${secondaryParts.join(', ')})`) : '';

  return `${chalk.white(label)}  ${contractAmount}  ${dueDate}${secondary}`;
}

export function serializeLoanForJson(loan: EnrichedLoan): Record<string, unknown> {
  const rawRecord = JSON.parse(loan.raw_json) as Record<string, unknown>;

  return {
    db: {
      id: loan.id,
      connection_item_id: loan.connection_item_id,
      connector_name: loan.connector_name,
      type: loan.type,
      contract_amount_cents: loan.contract_amount_cents,
      due_date: loan.due_date,
      contract_number: loan.contract_number,
      currency: loan.currency,
      synced_at: loan.synced_at,
    },
    parsed: {
      display_name: loan.display_name,
      connection_display_name: loan.connection_display_name,
      account_group_label: loan.account_group_label,
      contract_amount_cents: loan.contract_amount_cents,
      due_date: loan.due_date,
      name: loan.name,
      outstanding_balance_cents: loan.outstanding_balance_cents,
      installment_cents: loan.installment_cents,
      paid_installments: loan.paid_installments,
      total_installments: loan.total_installments,
      contracted_date: loan.contracted_date,
      interest_rate: loan.interest_rate,
      creditor: loan.creditor,
    },
    raw_json: rawRecord,
  };
}
