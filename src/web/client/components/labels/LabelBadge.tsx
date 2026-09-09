import { MaterialIcon } from '../ui/IconPicker.js';
import { Tooltip } from '../ui/Tooltip.js';

export type LabelPresentation = {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly path: string;
};

export type LabelBadgeVariant = 'icon' | 'short' | 'full';

export function LabelBadge({
  label,
  variant = 'full',
  onRemove,
}: {
  readonly label: LabelPresentation;
  readonly variant?: LabelBadgeVariant;
  readonly onRemove?: (labelId: string) => void;
}) {
  const chipStyle = {
    color: label.color,
    backgroundColor: `${label.color}20`,
  };
  const textLabel = variant === 'short' ? label.name : label.path;

  if (variant === 'icon') {
    const iconChip = (
      <span
        className={`inline-flex size-7 items-center justify-center rounded-md ${onRemove ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
        style={chipStyle}
      >
        <MaterialIcon name={label.icon} size={18} />
      </span>
    );
    if (onRemove) {
      return (
        <Tooltip content={`${label.path} — click to remove`}>
          <button
            type="button"
            className="border-0 bg-transparent p-0"
            onClick={() => onRemove(label.id)}
          >
            {iconChip}
          </button>
        </Tooltip>
      );
    }
    return <Tooltip content={label.path}>{iconChip}</Tooltip>;
  }

  const chip = (
    <span
      className={`flex w-full max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${onRemove ? 'cursor-pointer hover:opacity-80' : ''}`}
      style={chipStyle}
      title={onRemove ? `${label.path} — click to remove` : label.path}
    >
      <MaterialIcon name={label.icon} size={14} className="shrink-0" />
      <span className="truncate">{textLabel}</span>
    </span>
  );

  if (onRemove) {
    return (
      <button
        type="button"
        className="border-0 bg-transparent p-0"
        onClick={() => onRemove(label.id)}
      >
        {chip}
      </button>
    );
  }

  return chip;
}

export function LabelBadgeList({
  labels,
  variant = 'full',
  onRemove,
}: {
  readonly labels: readonly LabelPresentation[];
  readonly variant?: LabelBadgeVariant;
  readonly onRemove?: (labelId: string) => void;
}) {
  if (labels.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <LabelBadge key={label.id} label={label} variant={variant} onRemove={onRemove} />
      ))}
    </div>
  );
}
