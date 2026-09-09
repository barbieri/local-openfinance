import type { LabelPresentation } from '../components/labels/LabelBadge.js';

export type TransactionLabelDisplay = {
  readonly annotation: {
    readonly category: string | null;
    readonly subCategory: string | null;
    readonly labels: readonly string[];
    readonly labelPresentations?: readonly LabelPresentation[];
  } | null;
};

export function resolveLabelsDisplay(
  row: TransactionLabelDisplay,
  separator: string,
): readonly string[] {
  if (row.annotation?.labels && row.annotation.labels.length > 0) {
    return row.annotation.labels;
  }
  if (row.annotation?.category && row.annotation.subCategory) {
    return [`${row.annotation.category}${separator}${row.annotation.subCategory}`];
  }
  if (row.annotation?.category) {
    return [row.annotation.category];
  }
  return [];
}
