export type ColumnBadgeDisplay = 'icon' | 'short' | 'full';

export type TableDisplayOptions = {
  readonly category?: ColumnBadgeDisplay;
  readonly labels?: ColumnBadgeDisplay;
};

export function resolveColumnBadgeDisplay(
  value: string | undefined,
  fallback: ColumnBadgeDisplay = 'icon',
): ColumnBadgeDisplay {
  if (value === 'short' || value === 'full') {
    return value;
  }
  return fallback;
}
