import process from 'node:process';
import chalk from 'chalk';

export type SyncPhase =
  | 'connections'
  | 'force-sync'
  | 'force-upsert'
  | 'categories'
  | 'accounts'
  | 'account'
  | 'investments'
  | 'loans'
  | 'transactions'
  | 'credit-card-bills'
  | 'investment-transactions';

const phaseLabels: Record<SyncPhase, string> = {
  connections: 'Connections',
  'force-sync': 'Force sync',
  'force-upsert': 'Full re-upsert',
  categories: 'Categories',
  accounts: 'Accounts',
  account: 'Account',
  investments: 'Investments',
  loans: 'Loans',
  transactions: 'Transactions',
  'credit-card-bills': 'Credit card bills',
  'investment-transactions': 'Investment transactions',
};

export type SyncItemCounts = {
  readonly connections?: number;
  readonly categories?: number;
  readonly accounts?: number;
  readonly investments?: number;
  readonly loans?: number;
  readonly transactions?: number;
  readonly creditCardBills?: number;
  readonly investmentTransactions?: number;
};

const countLabels: Record<keyof SyncItemCounts, string> = {
  connections: 'connections',
  categories: 'categories',
  accounts: 'accounts',
  investments: 'investments',
  loans: 'loans',
  transactions: 'transactions',
  creditCardBills: 'credit card bills',
  investmentTransactions: 'investment transactions',
};

export type SyncProgressReporter = {
  setPhase(phase: SyncPhase, detail?: string): void;
  setStep(current: number, total?: number, detail?: string): void;
  writeTrail(label: string, counts: SyncItemCounts, options?: { readonly indent?: number }): void;
  finish(): void;
};

export function buildSyncTrailSummary(counts: SyncItemCounts): string {
  const parts: string[] = [];
  for (const key of Object.keys(countLabels) as Array<keyof SyncItemCounts>) {
    const value = counts[key];
    if (value === undefined) {
      continue;
    }
    parts.push(`${value} ${countLabels[key]}`);
  }

  return parts.length > 0 ? parts.join(', ') : '0 items';
}

export function formatSyncTrail(label: string, counts: SyncItemCounts, indent = 0): string {
  const prefix = indent > 0 ? '  '.repeat(indent) : '';
  return `${prefix}${chalk.green('✓')} ${label}: ${chalk.dim(buildSyncTrailSummary(counts))}`;
}

export function createSyncProgress(quiet: boolean): SyncProgressReporter {
  if (quiet) {
    return {
      setPhase() {},
      setStep() {},
      writeTrail() {},
      finish() {},
    };
  }

  let phase: SyncPhase | null = null;
  let phaseDetail = '';
  let stepCurrent = 0;
  let stepTotal: number | undefined;
  let stepDetail = '';

  const tty = process.stderr.isTTY === true;

  const render = (): void => {
    if (!phase) {
      return;
    }

    const parts = [chalk.cyan(phaseLabels[phase])];
    if (phaseDetail) {
      parts.push(chalk.bold(phaseDetail));
    }
    if (stepCurrent > 0 || stepTotal !== undefined) {
      parts.push(chalk.yellow(formatStep(stepCurrent, stepTotal)));
    }
    if (stepDetail) {
      parts.push(chalk.dim(stepDetail));
    }

    const line = parts.join(' · ');
    if (tty) {
      process.stderr.write(`\r\x1b[K${line}`);
    } else {
      process.stderr.write(`${line}\n`);
    }
  };

  const clearLiveLine = (): void => {
    if (tty) {
      process.stderr.write('\r\x1b[K');
    }
  };

  return {
    setPhase(nextPhase, detail) {
      phase = nextPhase;
      phaseDetail = detail ?? '';
      stepCurrent = 0;
      stepTotal = undefined;
      stepDetail = '';
      render();
    },
    setStep(current, total, detail) {
      stepCurrent = current;
      stepTotal = total;
      stepDetail = detail ?? '';
      render();
    },
    writeTrail(label, counts, options) {
      clearLiveLine();
      process.stderr.write(`${formatSyncTrail(label, counts, options?.indent ?? 0)}\n`);
    },
    finish() {
      clearLiveLine();
      phase = null;
    },
  };
}

function formatStep(current: number, total?: number): string {
  if (total !== undefined && total > 0) {
    const pct = Math.min(100, Math.round((current / total) * 100));
    return `${current}/${total} (${pct}%)`;
  }
  return String(current);
}
