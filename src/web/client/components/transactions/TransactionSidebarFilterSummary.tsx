import { memo } from 'react';
import type { TransactionFilterSummaryPart } from '../../lib/transaction-filters.js';
import type { LabelRecord } from '../labels/LabelEditDialog.js';
import { TransactionFilterSummaryParts } from './TransactionFilterSummary.js';

function TransactionSidebarFilterSummary({
  filterSummaryParts,
  labelById,
  categoryById,
  accounts,
  onClearFilterPart,
}: {
  readonly filterSummaryParts: readonly TransactionFilterSummaryPart[];
  readonly labelById: Record<string, LabelRecord>;
  readonly categoryById: Record<string, Record<string, unknown>>;
  readonly accounts: readonly Record<string, unknown>[];
  readonly onClearFilterPart: (partId: string) => void;
}) {
  if (filterSummaryParts.length === 0) {
    return null;
  }

  return (
    <>
      <span className="text-muted-foreground">:</span>
      <TransactionFilterSummaryParts
        parts={filterSummaryParts}
        labelById={labelById}
        categoryById={categoryById}
        accounts={accounts}
        onClearPart={onClearFilterPart}
      />
    </>
  );
}

export const MemoTransactionSidebarFilterSummary = memo(TransactionSidebarFilterSummary);
