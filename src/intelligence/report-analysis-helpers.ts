import { getNumberFormat } from '../utils/intl-formatters.js';
import type { LocalDatePeriod } from './period.js';
import type { ReportFact } from './report-analysis-types.js';

export function within(
  facts: readonly ReportFact[],
  period: LocalDatePeriod,
): readonly ReportFact[] {
  return facts.filter((fact) => fact.date >= period.start && fact.date <= period.end);
}

export function sumCents(facts: readonly ReportFact[]): number {
  return facts.reduce((sum, fact) => sum + fact.cents, 0);
}

export function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = result.get(groupKey) ?? [];
    group.push(value);
    result.set(groupKey, group);
  }
  return result;
}

export function changeRatio(current: number, baseline: number): number | null {
  return baseline === 0 ? null : (current - baseline) / baseline;
}

export function formatMoney(cents: number, language: string, currency: string): string {
  return getNumberFormat(language, { style: 'currency', currency }).format(cents / 100);
}

export function formatSignedMoney(cents: number, language: string, currency: string): string {
  return getNumberFormat(language, { style: 'currency', currency, signDisplay: 'always' }).format(
    cents / 100,
  );
}

export function formatRatio(value: number | null, language: string): string | null {
  return value === null
    ? null
    : getNumberFormat(language, {
        style: 'percent',
        maximumFractionDigits: 2,
        signDisplay: 'always',
      }).format(value);
}

export function daysBetween(left: string, right: string): number {
  return Math.round(
    (Date.parse(`${right}T12:00:00.000Z`) - Date.parse(`${left}T12:00:00.000Z`)) / 86_400_000,
  );
}

export function monthsBetween(left: string, right: string): number {
  if (!left || !right) return 0;
  return (
    (Number(right.slice(0, 4)) - Number(left.slice(0, 4))) * 12 +
    Number(right.slice(5, 7)) -
    Number(left.slice(5, 7))
  );
}

export function cleanText(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim();
}

export function normalizeCompare(value: string): string {
  return value
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/gu, '')
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}
