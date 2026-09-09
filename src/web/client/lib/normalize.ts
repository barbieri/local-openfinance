/** Accent-insensitive, case-insensitive text normalization for client-side search. */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export function matchesSearch(haystack: string, needle: string): boolean {
  if (!needle.trim()) {
    return true;
  }
  return normalizeSearchText(haystack).includes(normalizeSearchText(needle));
}
