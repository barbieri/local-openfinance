import type { ChartBucket } from '../../../../chart/transaction-aggregates.js';
import { formatCurrencyAmount } from '../../lib/format.js';

export function useChartCurrencyFormatter(currency: string, locale: string) {
  return (value: number) => formatCurrencyAmount(value, currency, locale);
}

export function toPieData(buckets: readonly ChartBucket[]) {
  return buckets.map((bucket) => ({
    id: bucket.id,
    name: bucket.name,
    value: bucket.totalCents,
    color: bucket.color,
  }));
}

export function toBarData(buckets: readonly ChartBucket[]) {
  return buckets.map((bucket) => ({
    id: bucket.id,
    name: bucket.name,
    total: bucket.totalCents,
    color: bucket.color,
  }));
}
