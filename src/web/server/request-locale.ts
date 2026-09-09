import type { DatabaseSync } from 'node:sqlite';
import { buildCategoryIndex } from '../../db/category-display.js';
import { resolveCategoryTranslationEnabled } from '../../utils/locale-resolve.js';

export { parseRequestLocale } from '../../utils/locale-resolve.js';

export function buildCategoryIndexForLocale(
  db: DatabaseSync,
  locale: string | undefined,
): ReturnType<typeof buildCategoryIndex> {
  return buildCategoryIndex(db, {
    translateNames: resolveCategoryTranslationEnabled(locale),
  });
}
