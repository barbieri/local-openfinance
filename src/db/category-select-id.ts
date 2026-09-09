const ONLY_CATEGORY_PREFIX = 'only:';

export function resolveStoredCategorySelectId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith(ONLY_CATEGORY_PREFIX)
    ? trimmed.slice(ONLY_CATEGORY_PREFIX.length)
    : trimmed;
}
