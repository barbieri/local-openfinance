import type { DatabaseSync } from 'node:sqlite';
import type { TriageQueueItem } from '../../annotation/assist-suggestions.js';
import type { CategoryPresentation } from '../../db/category-display.js';
import { buildCategoryIndex } from '../../db/category-display.js';
import { getInstallmentPlanInfo } from '../../db/installment-siblings.js';
import { enrichTransactionRow, loadTransactionRowById } from '../../db/transaction-details.js';

export type WebTriageQueueItem = TriageQueueItem & {
  readonly rawJson: string;
  readonly displayName: string;
  readonly originalCategoryPresentation: CategoryPresentation | null;
  readonly installmentNumber: number | null;
  readonly totalInstallments: number | null;
};

export function presentTriageQueueForWeb(
  db: DatabaseSync,
  items: readonly TriageQueueItem[],
): WebTriageQueueItem[] {
  const categoryIndex = buildCategoryIndex(db);

  return items.map((item) => {
    const row = loadTransactionRowById(db, item.entryId);
    if (!row) {
      return {
        ...item,
        rawJson: '{}',
        displayName: item.merchantName ?? item.description ?? item.entryId,
        originalCategoryPresentation: null,
        installmentNumber: null,
        totalInstallments: null,
      };
    }

    const enriched = enrichTransactionRow(db, row, undefined, categoryIndex);
    const installmentPlan = getInstallmentPlanInfo(db, item.entryId);
    return {
      ...item,
      merchantName: enriched.merchant_name,
      description: enriched.description,
      displayDescription: enriched.display_description,
      displayName: enriched.display_name,
      rawJson: enriched.raw_json,
      originalCategoryPresentation: enriched.original_category_presentation,
      installmentNumber: installmentPlan?.installmentNumber ?? enriched.installment_number,
      totalInstallments: installmentPlan?.totalInstallments ?? enriched.total_installments,
    };
  });
}
