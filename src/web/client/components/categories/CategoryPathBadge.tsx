import { MaterialIcon } from '../ui/IconPicker.js';
import type { CategoryPresentation } from './category-badge-presentation.js';

export function CategoryPathBadge({
  presentation,
}: {
  readonly presentation: CategoryPresentation | null | undefined;
}) {
  if (!presentation) {
    return <span className="text-muted-foreground">—</span>;
  }

  const chipStyle = {
    color: presentation.color,
    backgroundColor: `${presentation.color}20`,
  };
  const pathLabel = presentation.path ?? presentation.name;

  return (
    <span
      className="flex w-full max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={chipStyle}
    >
      <MaterialIcon name={presentation.icon} size={14} className="shrink-0" />
      <span className="min-w-0 truncate">{pathLabel}</span>
    </span>
  );
}
