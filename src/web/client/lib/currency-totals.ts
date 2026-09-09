export function sumAmountsByCurrency<T>(
  rows: readonly T[],
  readAmountCents: (row: T) => number,
  readCurrency: (row: T) => string = () => 'BRL',
): Array<[string, number]> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const currency = readCurrency(row);
    totals.set(currency, (totals.get(currency) ?? 0) + readAmountCents(row));
  }
  const entries = [...totals.entries()];
  entries.sort(([left], [right]) => left.localeCompare(right));
  return entries;
}
