import { categoriesEntity } from '../db/list/entities.js';
import { createListCommand } from './list-shared.js';

export const listCategoriesCommand = createListCommand(
  'list-categories',
  'list synced Open Finance categories from the local database',
  categoriesEntity,
);
