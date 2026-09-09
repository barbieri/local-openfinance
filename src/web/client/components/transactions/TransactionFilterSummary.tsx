import { clsx } from 'clsx';
import {
  buildAccountFilterItems,
  buildCategoryFilterItems,
  type FilterMultiSelectItem,
  toLabelPresentation,
} from '../../lib/filter-multi-select-items.js';
import type { TransactionFilterSummaryPart } from '../../lib/transaction-filters.js';
import { LabelBadgeList, type LabelPresentation } from '../labels/LabelBadge.js';

const EMPTY_LABEL_BY_ID: Readonly<Record<string, LabelPresentation>> = {};
const EMPTY_CATEGORY_BY_ID: Readonly<Record<string, Record<string, unknown>>> = {};
const EMPTY_ACCOUNTS: readonly Record<string, unknown>[] = [];

function renderFilterPartValue(
  part: TransactionFilterSummaryPart,
  labelById: Readonly<Record<string, LabelPresentation>>,
  categoryItemById: ReadonlyMap<string, FilterMultiSelectItem>,
  accountItemById: ReadonlyMap<string, FilterMultiSelectItem>,
) {
  if (part.accountIds && part.accountIds.length > 0) {
    return (
      <LabelBadgeList
        variant="icon"
        labels={part.accountIds
          .map((id) => accountItemById.get(id))
          .filter((item) => item !== undefined)
          .map((item) => toLabelPresentation(item))}
      />
    );
  }

  if (part.labelIds && part.labelIds.length > 0) {
    return (
      <LabelBadgeList
        variant="icon"
        labels={part.labelIds
          .map((id) => labelById[id])
          .filter((label): label is LabelPresentation => label !== undefined)}
      />
    );
  }

  if (part.categoryIds && part.categoryIds.length > 0) {
    return (
      <LabelBadgeList
        variant="icon"
        labels={part.categoryIds
          .map((id) => categoryItemById.get(id))
          .filter((item) => item !== undefined)
          .map((item) => toLabelPresentation(item))}
      />
    );
  }

  if (part.value) {
    return <span className="min-w-0">{part.value}</span>;
  }

  return null;
}

export function TransactionFilterSummaryParts({
  parts,
  labelById = EMPTY_LABEL_BY_ID,
  categoryById = EMPTY_CATEGORY_BY_ID,
  accounts = EMPTY_ACCOUNTS,
  onClearPart,
}: {
  readonly parts: readonly TransactionFilterSummaryPart[];
  readonly labelById?: Readonly<Record<string, LabelPresentation>>;
  readonly categoryById?: Readonly<Record<string, Record<string, unknown>>>;
  readonly accounts?: readonly Record<string, unknown>[];
  readonly onClearPart?: (partId: string) => void;
}) {
  if (parts.length === 0) {
    return null;
  }

  const categoryItems = buildCategoryFilterItems(categoryById);
  const categoryItemById = new Map(categoryItems.map((item) => [item.id, item]));
  const accountItems = buildAccountFilterItems(accounts);
  const accountItemById = new Map(accountItems.map((item) => [item.id, item]));

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {parts.map((part) => {
        const value = renderFilterPartValue(part, labelById, categoryItemById, accountItemById);
        const className = clsx(
          'inline-flex max-w-full items-center rounded border border-border bg-background px-1.5 py-0.5 text-xs',
          onClearPart && 'cursor-pointer hover:bg-accent',
        );

        if (onClearPart) {
          return (
            <button
              key={part.id}
              type="button"
              className={className}
              onClick={() => onClearPart(part.id)}
            >
              <span className="shrink-0 font-medium text-muted-foreground">{part.label}:</span>
              {value}
            </button>
          );
        }

        return (
          <span key={part.id} className={className}>
            <span className="shrink-0 font-medium text-muted-foreground">{part.label}:</span>
            {value}
          </span>
        );
      })}
    </span>
  );
}
