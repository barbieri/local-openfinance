import { MaterialIcon } from '../ui/IconPicker.js';
import { Tooltip } from '../ui/Tooltip.js';
import type { CategoryPresentation } from './category-badge-presentation.js';

type CategoryBadgeVariant = 'icon' | 'short' | 'full';

type CategoryBadgeProps = {
  readonly presentation: CategoryPresentation;
  readonly variant?: CategoryBadgeVariant;
};

export function CategoryBadge({ presentation, variant = 'full' }: CategoryBadgeProps) {
  const chipStyle = {
    color: presentation.color,
    backgroundColor: `${presentation.color}20`,
  };
  const pathLabel = presentation.path ?? presentation.name;
  const tooltipLabel = pathLabel;
  const textLabel = variant === 'short' ? presentation.name : pathLabel;

  if (variant === 'icon') {
    return (
      <Tooltip content={tooltipLabel}>
        <span
          className="inline-flex size-7 cursor-default items-center justify-center rounded-md"
          style={chipStyle}
        >
          <MaterialIcon name={presentation.icon} size={18} />
        </span>
      </Tooltip>
    );
  }

  return (
    <span
      className="flex w-full max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={chipStyle}
      title={tooltipLabel}
    >
      <MaterialIcon name={presentation.icon} size={14} className="shrink-0" />
      <span className="truncate">{textLabel}</span>
    </span>
  );
}
