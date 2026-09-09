import chalk from 'chalk';
import { getNumberFormat } from '../utils/intl-formatters.js';

const ptBrPlainAmountFormat = getNumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatGroupHeading(depth: number, label: string): string {
  if (depth === 0) {
    return chalk.bold(label);
  }

  return chalk.cyan(label);
}

export function formatStatusSuffix(status: string | null): string {
  if (!status || status === 'ACTIVE') {
    return '';
  }

  return chalk.yellow(` [${status}]`);
}

export function formatShortDate(value: string): string {
  if (value.length >= 10) {
    return value.slice(0, 10);
  }

  return value;
}

export function formatCurrency(amountCents: number | null, currency: string): string {
  if (amountCents === null) {
    return 'n/a';
  }

  return getNumberFormat('pt-BR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountCents / 100);
}

export function formatPlainAmount(amountCents: number): string {
  return ptBrPlainAmountFormat.format(amountCents / 100);
}

export type AmountRollup = {
  readonly creditsCents: number;
  readonly debitsCents: number;
  readonly balanceCents: number;
};

export function summarizeAmountCents(amounts: readonly number[]): AmountRollup {
  let creditsCents = 0;
  let debitsCents = 0;

  for (const amount of amounts) {
    if (amount > 0) {
      creditsCents += amount;
    } else if (amount < 0) {
      debitsCents += amount;
    }
  }

  return {
    creditsCents,
    debitsCents,
    balanceCents: creditsCents + debitsCents,
  };
}

export function formatAmountRollup(rollup: AmountRollup, currency: string): string {
  const credits = chalk.green(`+${formatCurrency(rollup.creditsCents, currency)}`);
  const debits = chalk.red(formatCurrency(rollup.debitsCents, currency));
  const balance =
    rollup.balanceCents > 0
      ? chalk.green.bold(formatCurrency(rollup.balanceCents, currency))
      : rollup.balanceCents < 0
        ? chalk.red.bold(formatCurrency(rollup.balanceCents, currency))
        : chalk.dim(formatCurrency(0, currency));

  return `${credits}  ${debits}  ${balance}`;
}
