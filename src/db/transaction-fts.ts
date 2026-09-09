const FTS_TOKEN_SPLIT = /\s+/u;

export type TransactionFtsColumn = 'description' | 'merchant_name' | 'all';

export function buildTransactionFtsMatch(
  rawQuery: string,
  column: TransactionFtsColumn = 'all',
): string | null {
  const tokens = tokenizeFtsQuery(rawQuery);
  if (tokens.length === 0) {
    return null;
  }

  const tokenClause = tokens.map((token) => `"${escapeFtsToken(token)}"*`).join(' AND ');
  if (column === 'all') {
    return tokenClause;
  }

  return `${column} : (${tokenClause})`;
}

export function combineFtsMatches(matches: readonly (string | null)[]): string | null {
  const active = matches.filter((match): match is string => Boolean(match?.trim()));
  if (active.length === 0) {
    return null;
  }
  return active.join(' AND ');
}

function tokenizeFtsQuery(rawQuery: string): string[] {
  return rawQuery
    .trim()
    .split(FTS_TOKEN_SPLIT)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function escapeFtsToken(token: string): string {
  return token.replace(/"/g, '""');
}
