import chalk from 'chalk';
import { extractCardLastFourDigits, formatCreditCardAccountDetails } from '../account-details.js';
import type { AccountGroupByField, EnrichedAccount } from '../account-list-details.js';
import { resolveAccountGroupKey } from '../account-list-details.js';
import { renderGroupedList } from '../grouped-list.js';
import { formatCurrency } from '../terminal-format.js';

export function formatAccountDetailsPlain(account: EnrichedAccount): string {
  if (account.type === 'BANK') {
    return formatBankAccountDetailsPlain(account);
  }

  if (account.type === 'CREDIT') {
    return formatCreditCardAccountDetails(account.number, account.credit_data);
  }

  return '—';
}

function formatBankAccountDetailsPlain(account: EnrichedAccount): string {
  const parts: string[] = [];
  if (account.branch) {
    parts.push(`ag ${account.branch}`);
  }
  if (account.account) {
    parts.push(`cc ${account.account}`);
  }
  if (parts.length > 0) {
    return parts.join(' · ');
  }

  if (account.transfer_number) {
    return account.transfer_number;
  }

  return '—';
}

export function renderAccountsTree(
  accounts: readonly EnrichedAccount[],
  groupBy: readonly AccountGroupByField[],
): string {
  return renderGroupedList({
    items: accounts,
    groupBy,
    resolveGroupKey: (account, field) =>
      resolveAccountGroupKey(account, field as AccountGroupByField),
    formatLabel: formatAccountLabel,
    formatLine: formatAccountLine,
    emptyMessage: chalk.dim('No accounts matched the current filters.'),
  });
}

function formatAccountLabel(account: EnrichedAccount): string {
  return account.display_name;
}

function formatAccountLine(account: EnrichedAccount, nameWidth: number): string {
  const displayName = chalk.bold.white(formatAccountLabel(account).padEnd(nameWidth, ' '));
  const typeSubtype = formatTypeSubtype(account.type, account.subtype);
  const branchAccount = formatBranchAccount(account);
  const balance = formatAccountBalance(account.balance_cents, account.currency);
  const merged = formatMergedSuffix(account.merged_account_ids);

  return `${displayName}  ${typeSubtype}  ${branchAccount}  ${balance}${merged}`;
}

function formatTypeSubtype(type: string, subtype: string | null): string {
  const typeLabel = chalk.cyan.bold(type);
  if (!subtype) {
    return typeLabel;
  }

  return `${typeLabel}${chalk.dim('/')}${chalk.cyan(subtype)}`;
}

function formatBranchAccount(account: EnrichedAccount): string {
  if (account.type === 'BANK') {
    const parts: string[] = [];
    if (account.branch) {
      parts.push(chalk.yellow(`ag ${account.branch}`));
    }
    if (account.account) {
      parts.push(chalk.yellow(`cc ${account.account}`));
    }
    if (parts.length > 0) {
      return parts.join(chalk.dim(' · '));
    }

    if (account.transfer_number) {
      return chalk.yellow(account.transfer_number);
    }

    return chalk.dim('—');
  }

  if (account.type === 'CREDIT') {
    const lastFour = extractCardLastFourDigits(account.number);
    if (lastFour) {
      return chalk.yellow(`card ****${lastFour}`);
    }
  }

  return chalk.dim('—');
}

function formatAccountBalance(balanceCents: number | null, currency: string): string {
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

function formatMergedSuffix(mergedAccountIds: readonly string[]): string {
  if (mergedAccountIds.length === 0) {
    return '';
  }

  const countLabel =
    mergedAccountIds.length === 1 ? '1 merged alias' : `${mergedAccountIds.length} merged aliases`;
  return chalk.dim(` · +${countLabel}`);
}

export function serializeAccountForJson(account: EnrichedAccount): Record<string, unknown> {
  const rawRecord = JSON.parse(account.raw_json) as Record<string, unknown>;

  return {
    db: {
      id: account.id,
      connection_item_id: account.connection_item_id,
      connector_name: account.connector_name,
      type: account.type,
      subtype: account.subtype,
      name: account.name,
      number: account.number,
      owner: account.owner,
      balance_cents: account.balance_cents,
      currency: account.currency,
      synced_at: account.synced_at,
    },
    parsed: {
      display_name: account.display_name,
      connection_display_name: account.connection_display_name,
      account_group_label: account.account_group_label,
      branch: account.branch,
      account: account.account,
      transfer_number: account.transfer_number,
      credit_data: account.credit_data,
      merged_account_ids: account.merged_account_ids,
    },
    raw_json: rawRecord,
  };
}
