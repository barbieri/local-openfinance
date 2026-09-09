import { useTranslation } from 'react-i18next';
import { LabelBadgeList, type LabelBadgeVariant } from '../components/labels/LabelBadge.js';
import { resolveLabelsDisplay, type TransactionLabelDisplay } from './labels-display-utils.js';

export function LabelsCell({
  row,
  variant = 'icon',
}: {
  readonly row: TransactionLabelDisplay;
  readonly variant?: LabelBadgeVariant;
}) {
  const { t } = useTranslation();
  const presentations = row.annotation?.labelPresentations ?? [];

  if (presentations.length > 0) {
    return <LabelBadgeList labels={presentations} variant={variant} />;
  }

  const fallbackLabels = resolveLabelsDisplay(row, t('labels.separator'));
  if (fallbackLabels.length === 0) {
    return (
      <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
        {t('labels.unclassified')}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {fallbackLabels.map((label) => (
        <span
          key={label}
          className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
        >
          {label}
        </span>
      ))}
    </div>
  );
}
