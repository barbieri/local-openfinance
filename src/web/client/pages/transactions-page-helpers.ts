import type { TransactionChartsState } from '../components/charts/TransactionCharts.js';
import type { useTableUrlState } from '../hooks/use-table-url-state.js';
import { TRANSACTION_DATE_ALL } from '../lib/transaction-filters.js';

export function patchTransactionChartState(
  setUrlState: ReturnType<typeof useTableUrlState>[1],
  patch: Partial<TransactionChartsState>,
): void {
  setUrlState((prev) => ({
    ...prev,
    charts: { ...prev.charts, ...patch },
  }));
}

export function mergeTransactionFilterPatch(
  filters: Record<string, string | string[]>,
  patch: Record<string, string | undefined>,
): Record<string, string | string[]> {
  const next = { ...filters };
  for (const [key, value] of Object.entries(patch)) {
    if (!value) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  if (patch['d'] && patch['d'] !== 'custom') {
    delete next['start-date'];
    delete next['end-date'];
  }
  if (
    next['d'] !== 'custom' &&
    next['d'] !== TRANSACTION_DATE_ALL &&
    (patch['start-date'] !== undefined || patch['end-date'] !== undefined)
  ) {
    delete next['d'];
  }
  return next;
}

export async function invalidateTransactionQueries(
  queryClient: ReturnType<typeof import('@tanstack/react-query').useQueryClient>,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['transactions'] });
  await queryClient.invalidateQueries({ queryKey: ['transaction-charts'] });
}
