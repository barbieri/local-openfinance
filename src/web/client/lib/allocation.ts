export function computeAllocationPercents(
  rows: readonly Record<string, unknown>[],
  valueKey: string,
): Map<number, number> {
  const percents = new Map<number, number>();
  const total = rows.reduce((sum, row) => sum + Math.abs(Number(row[valueKey] ?? 0)), 0);
  if (total <= 0) {
    return percents;
  }
  rows.forEach((row, index) => {
    const value = Math.abs(Number(row[valueKey] ?? 0));
    percents.set(index, value / total);
  });
  return percents;
}
