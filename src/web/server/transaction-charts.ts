import type { DatabaseSync } from 'node:sqlite';
import {
  loadTransactionChartSection,
  parseTransactionChartKind,
  type TransactionChartKind,
} from '../../db/transaction-charts.js';
import type { TransactionWebListFilters } from '../../db/transaction-query.js';
import { resolveLocalTimeZone } from '../../utils/local-date.js';

export function listTransactionChartsForWeb(
  db: DatabaseSync,
  filters: TransactionWebListFilters,
  chart: TransactionChartKind,
  options: { readonly timeZone?: string | undefined } = {},
) {
  return loadTransactionChartSection(
    db,
    filters,
    options.timeZone ?? resolveLocalTimeZone(),
    chart,
  );
}

export { parseTransactionChartKind };
