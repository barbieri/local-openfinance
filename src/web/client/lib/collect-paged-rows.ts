export async function collectPagedRows<T>(
  fetchPage: (page: number) => Promise<{
    readonly rows: readonly T[];
    readonly total: number;
  }>,
): Promise<T[]> {
  const collected: T[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (collected.length < total) {
    const result = await fetchPage(page);
    total = result.total;
    if (result.rows.length === 0) {
      break;
    }
    collected.push(...result.rows);
    page += 1;
  }
  return collected;
}
