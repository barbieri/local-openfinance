import { CategoryBadge } from './CategoryBadge.js';
import type { CategoryPresentation } from './category-badge-presentation.js';

type TransactionCategoryCellProps = {
  readonly presentation: CategoryPresentation | null | undefined;
  readonly variant?: 'icon' | 'short' | 'full';
};

export function TransactionCategoryCell({
  presentation,
  variant = 'icon',
}: TransactionCategoryCellProps) {
  if (!presentation) {
    return <span className="text-muted-foreground">—</span>;
  }

  return <CategoryBadge presentation={presentation} variant={variant} />;
}
