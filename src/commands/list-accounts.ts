import process from 'node:process';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { listEnrichedAccounts, parseAccountGroupBy } from '../db/account-list-details.js';
import { renderAccountsTree, serializeAccountForJson } from '../db/accounts/present.js';
import { openDatabase } from '../db/connection.js';
import { parseFieldFiltersFromArgv } from '../db/list/filters.js';
import { type ListArgv, withListOptions } from './list-shared.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type ListAccountsArgv = ConfigArgv &
  ListArgv & {
    readonly 'group-by'?: string | undefined;
    readonly json?: boolean | undefined;
  };

export const listAccountsCommand: CommandModule<object, ListAccountsArgv> = {
  command: 'list-accounts',
  describe: 'list synced accounts grouped and formatted for the terminal',
  builder: (argv) =>
    withListOptions(
      withConfigOption(argv)
        .option('group-by', {
          type: 'string',
          describe:
            'Comma-separated grouping fields: account, type, subtype (default: account,type,subtype)',
        })
        .option('json', {
          type: 'boolean',
          default: false,
          describe: 'Print db columns, parsed fields, and raw_json (use to debug field mapping)',
        }),
    ) as Argv<ListAccountsArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db } = openDatabase(resolved);
    const groupBy = parseAccountGroupBy(argv['group-by']);
    const { query, accounts } = listEnrichedAccounts(db, {
      filters: parseFieldFiltersFromArgv(process.argv),
      limit: argv.limit,
      offset: argv.offset,
    });

    if (argv.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            total: query.total,
            limit: query.limit,
            offset: query.offset,
            group_by: groupBy,
            rows: accounts.map((row) => serializeAccountForJson(row)),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    process.stdout.write(renderAccountsTree(accounts, groupBy));
  },
};
