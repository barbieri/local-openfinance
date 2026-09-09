import { transferGroupsEntity } from '../db/list/entities.js';
import { createListCommand } from './list-shared.js';

export const listTransferGroupsCommand = createListCommand(
  'list-transfer-groups',
  'list linked transfer groups from the local database',
  transferGroupsEntity,
);
